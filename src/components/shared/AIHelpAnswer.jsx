import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import { isAllowedHelpLink, sanitizeHelpLinks } from "../../../supabase/functions/_shared/helpLinks.js";

const EMPTY_LINKS = Object.freeze([]);

function Heading({ children }) {
  return <h4 className="mb-2 mt-4 first:mt-0 font-semibold text-slate-900">{children}</h4>;
}

const components = {
  h1: Heading, h2: Heading, h3: Heading, h4: Heading, h5: Heading, h6: Heading,
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 last:mb-0 list-disc space-y-1.5 pl-5">{children}</ul>,
  ol: ({ children, start }) => <ol start={start} className="mb-3 last:mb-0 list-decimal space-y-1.5 pl-5">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-4 border-amber-400 pl-3 text-slate-600">{children}</blockquote>,
  pre: ({ children }) => <pre className="my-3 max-w-full overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs">{children}</pre>,
  code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">{children}</code>,
};

export default function AIHelpAnswer({ text, allowedLinks = EMPTY_LINKS, onLinkClick }) {
  const safeText = useMemo(() => sanitizeHelpLinks(text, allowedLinks), [text, allowedLinks]);
  const safeComponents = useMemo(() => ({
    ...components,
    a: ({ href, children }) => {
      const target = isAllowedHelpLink(href, allowedLinks);
      return target ? <Link to={target} onClick={onLinkClick} className="font-medium text-amber-800 underline underline-offset-2 hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">{children}</Link> : <span>{children}</span>;
    },
  }), [allowedLinks, onLinkClick]);
  return <ReactMarkdown skipHtml disallowedElements={["img"]} components={safeComponents}>{safeText}</ReactMarkdown>;
}
