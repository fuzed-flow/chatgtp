import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import { helpPageRoute } from '@/lib/helpContent';

function readableHeading(children) {
  return <h3 className="mb-3 mt-7 text-lg font-bold tracking-tight text-slate-900 sm:text-xl">{children}</h3>;
}

export default function HelpArticleBody({ text, sections = [], role }) {
  const components = useMemo(() => ({
    h1: ({ children }) => readableHeading(children),
    h2: ({ node, children }) => {
      const section = sections.find(item => item.line === node?.position?.start?.line);
      return <h2 id={section?.id} tabIndex={-1} className="mb-4 mt-10 scroll-mt-28 border-t border-slate-100 pt-8 text-xl font-bold tracking-tight text-slate-900 outline-none first:mt-0 first:border-0 first:pt-0 sm:text-2xl">{children}</h2>;
    },
    h3: ({ children }) => readableHeading(children),
    h4: ({ children }) => <h4 className="mb-2 mt-6 text-base font-bold text-slate-900">{children}</h4>,
    h5: ({ children }) => <h5 className="mb-2 mt-5 font-semibold text-slate-900">{children}</h5>,
    h6: ({ children }) => <h6 className="mb-2 mt-5 font-semibold text-slate-900">{children}</h6>,
    p: ({ children }) => <p className="mb-5 leading-7 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="mb-6 list-disc space-y-3 pl-6 marker:text-amber-600 [&_p]:mb-0 [&_ul]:mt-3 [&_ul]:mb-0">{children}</ul>,
    ol: ({ children, start }) => <ol start={start} className="mb-6 list-decimal space-y-3 pl-6 marker:font-semibold marker:text-amber-700 [&_p]:mb-0 [&_ol]:mt-3 [&_ol]:mb-0">{children}</ol>,
    strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
    blockquote: ({ children }) => <blockquote className="my-6 rounded-r-xl border-l-4 border-amber-400 bg-amber-50 px-4 py-4 text-slate-700 [&_p]:mb-0">{children}</blockquote>,
    pre: ({ children }) => <pre className="my-6 max-w-full overflow-x-auto rounded-xl bg-slate-900 p-4 text-sm text-slate-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">{children}</pre>,
    code: ({ children }) => <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-800">{children}</code>,
    hr: () => <hr className="my-8 border-slate-200" />,
    a: ({ href, children }) => {
      const style = 'rounded-sm font-semibold text-amber-800 underline decoration-amber-300 underline-offset-4 hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500';
      if (!href || /[\\\s]/.test(href)) return <span>{children}</span>;
      if (/^#[a-zA-Z0-9_-]+$/.test(href)) return <a href={href} className={style}>{children}</a>;
      if (/^\/[a-zA-Z]/.test(href) && !href.startsWith('//')) {
        const route = /^\/(?:HelpArticles|FAQ)(?:\?|#|$)/.test(href) ? href : helpPageRoute(href, role);
        return route ? <Link to={route} className={style}>{children}</Link> : <span>{children}</span>;
      }
      if (/^https?:\/\//i.test(href)) return <a href={href} target="_blank" rel="noopener noreferrer" className={style}>{children}</a>;
      if (/^(mailto:|tel:)/i.test(href)) return <a href={href} className={style}>{children}</a>;
      return <span>{children}</span>;
    },
  }), [role, sections]);
  return <div className="min-w-0 text-[15px] leading-7 text-slate-600 [overflow-wrap:anywhere] sm:text-base"><ReactMarkdown skipHtml disallowedElements={['img']} components={components}>{text || ''}</ReactMarkdown></div>;
}
