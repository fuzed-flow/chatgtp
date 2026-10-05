import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { getAllowedHelpLinks, isAllowedHelpLink, sanitizeHelpLinks } from '../../supabase/functions/_shared/helpLinks.js';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const article = { slug: 'verified-help', question: 'Verified guide', route: '/Quotes' };
const allowed = getAllowedHelpLinks({ articles: [article] });
const verifiedHref = '/HelpArticles?article=verified-help';
const generics = ['/HelpArticles', '/FAQ', '/Contact', '/Tutorials'];

test('help links are exact retrieved article targets or confirmed help destinations', () => {
  assert.deepEqual(allowed.map(link => link.href), [...generics, verifiedHref]);
  assert.equal(getAllowedHelpLinks({ articles: [article, article, null, { slug: '../../AdminSettings' }] }).length, 5);
  for (const target of [...generics, verifiedHref]) assert.equal(isAllowedHelpLink(target, allowed), target);
  const invalid = [
    '/Quotes', '/EmployeePortal?tab=tasks', '/HelpArticles?article=missing', '/HelpArticles?article=verified-help&extra=1',
    '/HelpArticles?article=verified-help#section', '/HelpArticles?article=%76erified-help', '/HelpArticles?article=../verified-help',
    '/HelpArticles/', '/Contact?next=bad', '/Contact#form', '//evil.example', 'https://evil.example', 'javascript:alert(1)',
    'mailto:fake@example.com', './HelpArticles?article=verified-help', '../HelpArticles?article=verified-help', '?article=verified-help',
    '/%48elpArticles', '/HelpArticles%3farticle=verified-help', '/HelpArticles?article=verified-help&article=other',
    '/HelpArticles?article=verified-help%00', ' /HelpArticles', '/HelpArticles ', '/HelpArticles\\evil', null,
  ];
  for (const href of invalid) assert.equal(isAllowedHelpLink(href, allowed), null, String(href));
  assert.equal(isAllowedHelpLink('/UnknownScreen', [...allowed, { href: '/UnknownScreen' }]), null, 'Metadata cannot authorize an unknown route.');
  assert.equal(isAllowedHelpLink('/HelpArticles?article=unretrieved', allowed), null);
  assert.equal(isAllowedHelpLink(verifiedHref), null, 'Article links require response metadata.');
  assert.equal(isAllowedHelpLink('/Contact'), '/Contact', 'The support fallback remains available without metadata.');
});

test('generic help destinations have explicit routes available to every signed-in account', async () => {
  const app = await fs.readFile(local('../../src/App.jsx'), 'utf8');
  for (const href of generics) {
    assert.match(app, new RegExp(`<Route path="${href}" element=\\{\\s*<LayoutWrapper`), `${href} has an unguarded help route inside AuthenticatedApp.`);
  }
});

test('sanitizer preserves valid inline, titled, angled, and multiline reference links', () => {
  const markdown = `1. Read [the guide](<${verifiedHref}> "Guide title").
2. Ask [support](\n    </Contact>\n    'Support title'\n   ).
3. Browse [FAQ](/FAQ (Short title)).

[Reference][verified]
[Collapsed][]
[Shortcut]

[verified]:
 <${verifiedHref}>
 "Helpful guide"
[Collapsed]: /Contact 'Email support'
[Shortcut]:
 /Tutorials
 (Videos)`;
  const clean = sanitizeHelpLinks(markdown, allowed);
  assert.match(clean, /\[the guide\]\(\/HelpArticles\?article=verified-help\)/);
  assert.match(clean, /\[support\]\(\/Contact\)/);
  assert.match(clean, /\[FAQ\]\(\/FAQ\)/);
  assert.match(clean, /\[Reference\]\(\/HelpArticles\?article=verified-help\)/);
  assert.match(clean, /\[Collapsed\]\(\/Contact\)/);
  assert.match(clean, /\[Shortcut\]\(\/Tutorials\)/);
  assert.doesNotMatch(clean, /\[verified\]:|Helpful guide|Email support/);
});

test('nested and escaped CommonMark references cannot restore unconfirmed targets after serialization', () => {
  const hrefs = markdown => {
    const targets = [];
    const walk = node => {
      if (node.type === 'link') targets.push(node.url);
      assert.notEqual(node.type, 'definition', 'Sanitized output has no reusable reference definitions.');
      assert.notEqual(node.type, 'html', 'Sanitized output has no raw HTML links.');
      for (const child of node.children || []) walk(child);
    };
    walk(fromMarkdown(markdown));
    return targets;
  };
  const targets = ['https://unverified.example/help', 'https&#58;&#47;&#47;unverified.example', '../WarrantyClaims', '?article=forged', './HelpArticles?article=forged', '&#x2f;WarrantyClaims'];
  const variants = target => [
    `[ref]\n\n[ref]: ${target}`,
    `[ref]\n\n[ref]:\n ${target}`,
    `[Readable label][ref]\n\n[ref]:\n    ${target}`,
    `[ref][]\n\n[ref]:\n     ${target}`,
    `> [ref]\n>\n> [ref]:\n>     ${target}`,
    `- [ref]\n\n  [ref]:\n      ${target}`,
    `[ref]\r\n\r\n[ref]:\r\n ${target}`,
    `[escaped\\] label][ref]\n\n[ref]:\n ${target}`,
    `[escaped\\] label]\n\n[escaped\\] label]:\n ${target}`,
  ];
  for (const target of targets) for (const markdown of variants(target)) {
    const clean = sanitizeHelpLinks(markdown, allowed);
    assert.deepEqual(hrefs(clean), [], markdown);
    assert.ok(!clean.includes(target), markdown);
  }
  const known = sanitizeHelpLinks(`[ref]\n\n[ref]: ${verifiedHref}\n[ref]: https://unverified.example`, allowed);
  assert.deepEqual(hrefs(known), [verifiedHref], 'The first approved definition wins.');
  const unknown = sanitizeHelpLinks(`[ref]\n\n[ref]: https://unverified.example\n[ref]: ${verifiedHref}`, allowed);
  assert.deepEqual(hrefs(unknown), [], 'A later valid definition cannot override the first unknown target.');
});

test('sanitizer removes unknown inline, image, raw HTML, autolink and reference targets', () => {
  const targets = ['https&#58;&#47;&#47;evil.example', '../WarrantyClaims', '?article=forged', './HelpArticles?article=forged', '&#x2f;WarrantyClaims'];
  for (const target of targets) {
    for (const label of ['[ref]', '[Readable label][ref]', '[ref][]']) {
      const clean = sanitizeHelpLinks(`${label}\n\n[ref]:\n ${target}`, allowed);
      assert.ok(!clean.includes(target), target);
      assert.ok(clean.includes(label === '[Readable label][ref]' ? 'Readable label' : 'ref'));
      assert.doesNotMatch(clean, /\]\(|\[ref\]:/);
    }
  }
  const markdown = `[Missing page](/NoSuchHelpPage) [Missing article](/HelpArticles?article=missing)
[External sample](https://unverified.example/help) [Javascript](javascript:alert(1))
![Image label](https://unverified.example/photo.png)
<a href="/NoSuchHelpPage">HTML label</a> <a href="/Contact">Support</a>
<https://unverified.example/help> <fake@unverified.example>
Bare https://unverified.example/help, //unverified.example/help and /NoSuchHelpPage.

[Nested **label**](https://unverified.example/a(b))`;
  const clean = sanitizeHelpLinks(markdown, allowed);
  for (const label of ['Missing page', 'Missing article', 'External sample', 'Javascript', 'Image label', 'HTML label', 'Nested **label**']) assert.ok(clean.includes(label), label);
  assert.doesNotMatch(clean, /NoSuchHelpPage|article=missing|unverified\.example|javascript:|<a\b|<img\b/);
  assert.match(clean, /\[Support\]\(\/Contact\)/);
});

const answerBundle = build({
  stdin: { resolveDir: local('../../'), sourcefile: 'help-answer-fixture.jsx', loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {BrowserRouter} from 'react-router-dom';
    import AIHelpAnswer from './src/components/shared/AIHelpAnswer.jsx';
    const root=createRoot(document.getElementById('root'));
    window.renderAnswer=(text,allowedLinks,version)=>root.render(<BrowserRouter><section data-version={version}><AIHelpAnswer text={text} allowedLinks={allowedLinks} onLinkClick={()=>window.answerLinkClicks=(window.answerLinkClicks||0)+1}/></section></BrowserRouter>);
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' },
});

async function browserDom(bundle) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { if (!error.message.includes('navigation')) errors.push(error.message); });
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.example/HelpArticles', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole });
  const window = dom.window;
  const document = window.document;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const wait = async predicate => {
    for (let attempt = 0; attempt < 200; attempt++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error(`Expected help link UI state: ${document.body.textContent}`);
  };
  const input = (element, value) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  window.eval((await bundle).outputFiles[0].text);
  return { dom, window, document, wait, input, errors };
}

test('the actual Markdown renderer makes only confirmed targets clickable and preserves answer formatting', async () => {
  const view = await browserDom(answerBundle);
  try {
    const markdown = `## Follow these steps
1. Open **Help** and [the verified guide](<${verifiedHref}>).
2. Read [FAQ](/FAQ), [tutorials](/Tutorials), or [contact support](/Contact).

[Invented page](/NoSuchHelpPage), [Unverified article](/HelpArticles?article=unretrieved), and [External sample](https://unverified.example).
<https://unverified.example> <a href="javascript:alert(1)">Unsafe HTML label</a>
[badref]

[badref]:
 https&#58;&#47;&#47;unverified.example`;
    view.window.renderAnswer(markdown, allowed, 1);
    await view.wait(() => view.document.querySelector('section[data-version="1"] ol'));
    const anchors = [...view.document.querySelectorAll('a')];
    assert.deepEqual(anchors.map(anchor => anchor.getAttribute('href')), [verifiedHref, '/FAQ', '/Tutorials', '/Contact']);
    assert.ok(view.document.querySelector('h4'));
    assert.ok(view.document.querySelector('ol strong'));
    assert.ok(view.document.body.textContent.includes('Invented page'));
    assert.ok(view.document.body.textContent.includes('Unverified article'));
    assert.doesNotMatch(view.document.body.textContent, /NoSuchHelpPage|article=unretrieved|unverified\.example|javascript:/);
    anchors[0].click();
    await view.wait(() => view.window.answerLinkClicks === 1);
    view.window.renderAnswer(`[Guide](${verifiedHref}) and [Support](/Contact)`, [], 2);
    await view.wait(() => view.document.querySelector('section[data-version="2"]'));
    assert.deepEqual([...view.document.querySelectorAll('a')].map(anchor => anchor.getAttribute('href')), ['/Contact']);
    assert.ok(view.document.body.textContent.includes('Guide'));
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

const widgetBundle = build({
  stdin: { resolveDir: local('../../'), sourcefile: 'help-widget-link-fixture.jsx', loader: 'jsx', contents: `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {BrowserRouter} from 'react-router-dom';
    import {Context} from 'test-help-auth';
    import AIHelpWidget from './src/components/shared/AIHelpWidget.jsx';
    function Fixture(){const [profile,setProfile]=useState({id:'first-user',role:'owner'});window.changeHelpProfile=setProfile;return <Context.Provider value={{profile}}><BrowserRouter><AIHelpWidget/></BrowserRouter></Context.Provider>;}
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' },
  alias: { '@': local('../../src') },
  plugins: [{ name: 'isolated-help-context', setup(builder) {
    builder.onResolve({ filter: /^(?:test-help-(?:auth|db)|@\/lib\/AuthContext|@\/api\/supabaseClient)$/ }, args => ({ path: args.path.includes('AuthContext') || args.path.endsWith('auth') ? 'test-help-auth' : 'test-help-db', namespace: 'isolated-help' }));
    builder.onLoad({ filter: /.*/, namespace: 'isolated-help' }, args => ({ loader: 'jsx', contents: args.path === 'test-help-auth'
      ? `import React,{createContext,useContext} from 'react';export const Context=createContext(null);export const useAuth=()=>useContext(Context);`
      : `export const supabase={functions:{invoke:async()=>{if(window.deferHelpResponse)await new Promise(resolve=>window.releaseHelpResponse=resolve);return {data:{reply:'Account-sensitive answer. Read [Verified guide](${verifiedHref}), [Forged guide](/HelpArticles?article=forged), or [Bad page](/MissingPage).',sources:[{slug:'verified-help',question:'Verified source'},{slug:'forged',question:'Forged source'}],allowedLinks:${JSON.stringify(allowed)}},error:null};}}};`, resolveDir: local('../../') }));
  } }],
});

test('AI source cards use response metadata, confirmed inline links close the dialog, and account changes clear old answers', async () => {
  const view = await browserDom(widgetBundle);
  try {
    const open = async () => { view.document.querySelector('[aria-label="Open AI help"]').click(); await view.wait(() => view.document.querySelector('[role="dialog"]')); };
    const send = async question => {
      view.input(view.document.querySelector('[aria-label="Your question"]'), question);
      view.document.querySelector('[role="dialog"] form').dispatchEvent(new view.window.Event('submit', { bubbles: true, cancelable: true }));
    };
    await view.wait(() => view.document.querySelector('[aria-label="Open AI help"]'));
    await open();
    await send('Show the verified instructions.');
    await view.wait(() => view.document.querySelector('[role="log"]')?.textContent.includes('Account-sensitive answer'));
    const links = [...view.document.querySelectorAll('[role="log"] a')];
    assert.equal(links.length, 2, 'The confirmed inline citation and confirmed source card are clickable.');
    assert.ok(links.every(link => link.getAttribute('href') === verifiedHref));
    assert.ok(!view.document.querySelector('[role="log"]').textContent.includes('Forged source'));
    assert.doesNotMatch(view.document.querySelector('[role="log"]').textContent, /article=forged|MissingPage/);
    links[0].click();
    await view.wait(() => !view.document.querySelector('[role="dialog"]'));
    assert.equal(view.window.location.search, '?article=verified-help');

    view.window.changeHelpProfile({ id: 'first-user', role: 'employee' });
    await new Promise(resolve => setTimeout(resolve, 30));
    await open();
    assert.ok(!view.document.querySelector('[role="log"]').textContent.includes('Account-sensitive answer'));
    assert.equal(view.document.querySelectorAll('[role="log"] a').length, 0);
    assert.equal(view.document.querySelector('[aria-label="Your question"]').value, '');

    view.window.deferHelpResponse = true;
    await send('A request started before changing account.');
    await view.wait(() => typeof view.window.releaseHelpResponse === 'function');
    view.window.changeHelpProfile({ id: 'second-user', role: 'employee' });
    await view.wait(() => !view.document.querySelector('[role="dialog"]'));
    view.window.releaseHelpResponse();
    await new Promise(resolve => setTimeout(resolve, 30));
    await open();
    assert.ok(!view.document.querySelector('[role="log"]').textContent.includes('Account-sensitive answer'));
    assert.ok(!view.document.querySelector('[role="log"]').textContent.includes('A request started before changing account'));
    assert.equal(view.document.querySelectorAll('[role="log"] a').length, 0);
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});

test('mobile AI Help opens on a tap and moves within the screen after a press and hold', async () => {
  const view = await browserDom(widgetBundle);
  try {
    Object.defineProperty(view.window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(view.window, 'innerHeight', { configurable: true, value: 780 });
    view.window.dispatchEvent(new view.window.Event('resize'));
    await view.wait(() => view.document.querySelector('[aria-label="Open AI help"]')?.getAttribute('aria-describedby'));

    const trigger = view.document.querySelector('[aria-label="Open AI help"]');
    trigger.getBoundingClientRect = () => ({ left: 280, top: 700, width: 102, height: 56, right: 382, bottom: 756 });
    let capturedPointer = null;
    trigger.setPointerCapture = pointerId => { capturedPointer = pointerId; };
    trigger.hasPointerCapture = pointerId => capturedPointer === pointerId;
    trigger.releasePointerCapture = pointerId => { if (capturedPointer === pointerId) capturedPointer = null; };
    const pointer = (type, clientX, clientY) => {
      const event = new view.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
      Object.defineProperties(event, {
        pointerId: { value: 7 },
        isPrimary: { value: true },
      });
      trigger.dispatchEvent(event);
    };

    pointer('pointerdown', 330, 730);
    await view.wait(() => trigger.dataset.dragging === 'true');
    pointer('pointermove', 20, 30);
    await view.wait(() => trigger.style.left === '8px' && trigger.style.top === '8px');
    pointer('pointerup', 20, 30);
    trigger.click();
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(view.document.querySelector('[role="dialog"]'), null, 'Releasing a drag does not open AI Help.');
    assert.equal(trigger.dataset.dragging, 'false');
    assert.deepEqual(JSON.parse(view.window.sessionStorage.getItem('fuzedflow.ai-help.mobile-position')), { x: 8, y: 8 });

    trigger.click();
    await view.wait(() => view.document.querySelector('[role="dialog"]'));
    assert.deepEqual(view.errors, []);
  } finally { view.dom.window.close(); }
});
