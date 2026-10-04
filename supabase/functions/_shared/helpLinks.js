import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';

const GENERIC_HELP_LINKS = Object.freeze([
  { href: '/HelpArticles', label: 'Help Articles' },
  { href: '/FAQ', label: 'Quick answers & FAQ' },
  { href: '/Contact', label: 'Contact support' },
  { href: '/Tutorials', label: 'Video tutorials' },
]);
const GENERIC_TARGETS = new Set(GENERIC_HELP_LINKS.map(link => link.href));
const SAFE_SLUG = /^[a-zA-Z0-9_-]{1,160}$/;

function canonicalTarget(href) {
  if (typeof href !== 'string' || href.length > 300 || /[\\\s%#]/.test(href)) return null;
  if (GENERIC_TARGETS.has(href)) return href;
  const match = href.match(/^\/HelpArticles\?article=([a-zA-Z0-9_-]{1,160})$/);
  return match ? `/HelpArticles?article=${match[1]}` : null;
}

// These article records must come from the authenticated caller's RLS query.
// Feature-page URLs cannot establish that a record, permission, or module exists.
export function getAllowedHelpLinks({ articles = [] } = {}) {
  const links = GENERIC_HELP_LINKS.map(link => ({ ...link }));
  const seen = new Set(GENERIC_TARGETS);
  for (const article of Array.isArray(articles) ? articles : []) {
    if (!article || !SAFE_SLUG.test(article.slug || '')) continue;
    const href = `/HelpArticles?article=${article.slug}`;
    if (seen.has(href)) continue;
    links.push({ href, label: typeof article.question === 'string' ? article.question.slice(0, 250) : 'Read help article' });
    seen.add(href);
  }
  return links;
}

// Returns the exact confirmed target, rather than a truthy URL-shaped string.
export function isAllowedHelpLink(href, allowedLinks = []) {
  const target = canonicalTarget(href);
  if (!target) return null;
  if (GENERIC_TARGETS.has(target)) return target;
  return Array.isArray(allowedLinks) && allowedLinks.some(link => canonicalTarget(typeof link === 'string' ? link : link?.href) === target) ? target : null;
}

const referenceKey = label => String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();

function cleanUrlText(text, allowedLinks) {
  let output = String(text || '').replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:|tel:|javascript:|vbscript:|data:)[^\s<>"'`\]]+/gi, 'link unavailable');
  output = output.replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, 'link unavailable');
  return output.replace(/(^|[\s([{<'"])((?:\.{1,2}\/|\/\/|\/|[?#])[a-zA-Z%][^\s<>"'`\])]*)(?=$|[\s<>"'`\])])/g, (match, before, candidate) => {
    const punctuation = candidate.match(/[.,;:!?]+$/)?.[0] || '';
    const target = punctuation ? candidate.slice(0, -punctuation.length) : candidate;
    return `${before}${isAllowedHelpLink(target, allowedLinks) ? target : 'link unavailable'}${punctuation}`;
  });
}

// Resolve CommonMark references before deleting definitions. The first
// definition wins, including those nested inside lists and block quotes.
function collectDefinitions(node, definitions) {
  if (node.type === 'definition') {
    const key = referenceKey(node.identifier);
    if (!definitions.has(key)) definitions.set(key, node.url);
  }
  for (const child of node.children || []) collectDefinitions(child, definitions);
}

function cleanedChildren(node, allowedLinks, definitions) {
  return (node.children || []).flatMap(child => cleanNode(child, node, allowedLinks, definitions));
}

function cleanNode(node, parent, allowedLinks, definitions) {
  if (node.type === 'definition') return [];
  if (node.type === 'image' || node.type === 'imageReference') return [{ type: 'text', value: cleanUrlText(node.alt, allowedLinks) }];
  if (node.type === 'html') {
    const value = cleanUrlText(node.value.replace(/<[^>]*>/g, ''), allowedLinks);
    if (!value) return [];
    const plain = { type: 'text', value };
    return ['root', 'blockquote', 'listItem'].includes(parent?.type) ? [{ type: 'paragraph', children: [plain] }] : [plain];
  }
  if (node.type === 'link' || node.type === 'linkReference') {
    const children = cleanedChildren(node, allowedLinks, definitions);
    const href = node.type === 'link' ? node.url : definitions.get(referenceKey(node.identifier));
    const target = isAllowedHelpLink(href, allowedLinks);
    return target ? [{ type: 'link', url: target, title: null, children }] : children;
  }
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') return [{ ...node, value: cleanUrlText(node.value, allowedLinks) }];
  return [{ ...node, ...(node.children ? { children: cleanedChildren(node, allowedLinks, definitions) } : {}) }];
}

// A real CommonMark parse prevents references hidden in nested containers,
// continuations, escaped labels, or CRLF text from bypassing the allowlist.
// Serialization escapes malformed leftovers instead of creating new links.
export function sanitizeHelpLinks(markdown, allowedLinks = []) {
  try {
    let text = typeof markdown === 'string' ? markdown : '';
    // Retain the readable label of simple HTML anchors. The AST validation below
    // still decides whether the resulting Markdown target may be clickable.
    text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (match, attributes, label) => {
      const href = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const target = isAllowedHelpLink(href?.[1] ?? href?.[2] ?? href?.[3], allowedLinks);
      const readable = label.replace(/<[^>]*>/g, '') || 'link unavailable';
      return target ? `[${readable}](${target})` : readable;
    });
    const tree = fromMarkdown(text);
    const definitions = new Map();
    collectDefinitions(tree, definitions);
    const safeTree = { ...tree, children: cleanedChildren(tree, allowedLinks, definitions) };
    return toMarkdown(safeTree, { bullet: '-', emphasis: '*', strong: '*' });
  } catch {
    return 'I could not verify the links in that answer. Browse [Help Articles](/HelpArticles), or [contact support](/Contact) for help.';
  }
}
