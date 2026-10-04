import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BookOpen, Building2, ChartNoAxesCombined, CheckCircle2, ChevronRight, Clock3, Compass, FileText, HardHat, LifeBuoy, List, Loader2, MessageCircle, Package, Search, Smartphone, Users, X } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { canReadHelp, findHelpArticles, helpPageRoute } from '@/lib/helpContent';
import { FEATURED_HELP, HELP_COLLECTIONS, getHelpSections, helpArticleUrl, helpBrowseUrl, helpReadMinutes, helpVerifiedDate, relatedHelpArticles } from '@/lib/helpPortal';
import HelpArticleBody from '@/components/shared/HelpArticleBody';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const EMPTY = [];
const PAGE_SIZE = 12;
const ICONS = { compass: Compass, file: FileText, building: Building2, hardhat: HardHat, package: Package, chart: ChartNoAxesCombined, users: Users, lifebuoy: LifeBuoy };
const FEATURE_ICONS = { 'guide-getting-started': Compass, 'guide-mobile-navigation': Smartphone, 'guide-troubleshooting': LifeBuoy };
const FEATURE_LABELS = { 'guide-getting-started': 'START HERE', 'guide-mobile-navigation': 'ON THE GO', 'guide-troubleshooting': 'GET UNSTUCK' };
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2';

function SupportCard({ compact = false }) {
  return <aside className={`rounded-2xl bg-slate-900 p-5 text-white ${compact ? '' : 'sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6'}`}>
    <div><h2 className="flex items-center gap-2 text-lg font-bold"><LifeBuoy className="h-5 w-5 text-amber-400" aria-hidden="true" />Still need a hand?</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Ask AI Help for guidance from these articles, or tell our support team where you got stuck.</p></div>
    <Link to="/Contact" className={`mt-4 inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 text-sm font-semibold text-white touch-manipulation hover:bg-amber-600 ${FOCUS} ${compact ? '' : 'sm:mt-0 sm:w-auto'}`}><MessageCircle className="h-4 w-4" aria-hidden="true" />Contact support</Link>
  </aside>;
}

function ArticleCard({ article, params }) {
  const guide = article.article_type === 'guide';
  return <Link to={helpArticleUrl(article.slug, params)} aria-label={`Read ${article.question}`} className={`group flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors touch-manipulation hover:border-amber-300 hover:bg-amber-50/30 ${FOCUS}`}>
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span className={`rounded-full px-2.5 py-1 font-semibold ${guide ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>{guide ? 'Guide' : 'Quick answer'}</span><span className="text-slate-500">{article.feature_area}</span></div>
    <h3 className="text-base font-bold leading-snug text-slate-900 group-hover:text-amber-900">{article.question}</h3>
    <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{article.answer_short || 'Open this article for step-by-step guidance.'}</p>
    <div className="mt-auto flex items-center justify-between gap-3 pt-5"><span className="flex items-center gap-1.5 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{helpReadMinutes(article)} min read</span><span className="flex items-center gap-1 text-sm font-semibold text-amber-800">Read article<ArrowRight className="h-4 w-4" aria-hidden="true" /></span></div>
  </Link>;
}

function jumpToSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
}

function ArticleReader({ article, articles, params, role }) {
  const readerRef = useRef(null);
  const titleRef = useRef(null);
  const sections = useMemo(() => getHelpSections(article.answer_long || article.answer_short), [article.answer_long, article.answer_short]);
  const related = useMemo(() => relatedHelpArticles(article, articles), [article, articles]);
  const route = helpPageRoute(article.route, role);
  const verified = helpVerifiedDate(article.last_verified_at);
  const [activeSection, setActiveSection] = useState('');
  useEffect(() => {
    readerRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    titleRef.current?.focus({ preventScroll: true });
  }, [article.slug]);

  function goToSection(id) { setActiveSection(id); jumpToSection(id); }
  return <main ref={readerRef} data-help-reader className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 sm:px-6 sm:pt-6">
    <nav aria-label="Breadcrumb" className="mb-5 flex min-w-0 flex-wrap items-center gap-x-1 text-sm text-slate-500"><Link to={helpBrowseUrl(params)} className={`inline-flex min-h-12 items-center gap-2 rounded-lg px-2 font-semibold text-slate-600 hover:bg-slate-100 ${FOCUS}`}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Help Articles</Link><ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words px-2">{article.feature_area}</span></nav>
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-8">
      <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 p-5 sm:p-8">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold"><span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">{article.article_type === 'guide' ? 'Step-by-step guide' : 'Quick answer'}</span><span className="text-slate-500">{article.feature_area}</span></div>
          <h1 ref={titleRef} tabIndex={-1} className="text-2xl font-black leading-tight tracking-tight text-slate-900 outline-none [overflow-wrap:anywhere] sm:text-3xl lg:text-4xl">{article.question}</h1>
          {article.answer_short && article.answer_long?.trim() !== article.answer_short.trim() && <p className="mt-4 text-base leading-7 text-slate-500 sm:text-lg">{article.answer_short}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 sm:text-sm"><span className="flex items-center gap-1.5"><Clock3 className="h-4 w-4" aria-hidden="true" />{helpReadMinutes(article)} min read</span>{verified && <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-amber-600" aria-hidden="true" />Reviewed {verified}</span>}</div>
          {route && <Link to={route} className={`mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-900 touch-manipulation hover:bg-amber-100 ${FOCUS}`}>Open related page<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
        </header>
        {sections.length > 1 && <div className="border-b border-slate-100 bg-slate-50 px-5 py-4 sm:px-8 lg:hidden"><label htmlFor="article-section" className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><List className="h-4 w-4" aria-hidden="true" />Jump to a section</label><select id="article-section" value={activeSection} onChange={event => goToSection(event.target.value)} className={`h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900 touch-manipulation ${FOCUS}`}><option value="">Choose a section</option>{sections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></div>}
        <div className="p-5 sm:p-8"><HelpArticleBody text={article.answer_long || article.answer_short} sections={sections} role={role} /></div>
        <footer className="border-t border-slate-100 bg-slate-50 p-5 sm:px-8"><Link to={helpBrowseUrl(params)} className={`inline-flex min-h-12 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-white ${FOCUS}`}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to all help articles</Link></footer>
      </article>
      <aside className="hidden space-y-5 lg:sticky lg:top-24 lg:block">
        {sections.length > 0 && <nav aria-label="On this page" className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900"><List className="h-4 w-4 text-amber-600" aria-hidden="true" />On this page</h2><ul className="space-y-1">{sections.map(section => <li key={section.id}><button type="button" onClick={() => goToSection(section.id)} aria-current={activeSection === section.id ? 'location' : undefined} className={`min-h-11 w-full rounded-lg px-3 py-2.5 text-left text-sm leading-5 touch-manipulation ${FOCUS} ${activeSection === section.id ? 'bg-amber-50 font-semibold text-amber-900' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}>{section.title}</button></li>)}</ul></nav>}
        <SupportCard compact />
      </aside>
    </div>
    {related.length > 0 && <section className="mt-8 sm:mt-10" aria-labelledby="related-help-heading"><div className="mb-4 flex items-center gap-2"><BookOpen className="h-5 w-5 text-amber-600" aria-hidden="true" /><h2 id="related-help-heading" className="text-lg font-bold text-slate-900 sm:text-xl">Keep exploring</h2></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{related.map(item => <ArticleCard key={item.id} article={item} params={params} />)}</div></section>}
    <div className="mt-8 lg:hidden"><SupportCard /></div>
  </main>;
}

function LoadingState() {
  return <div role="status" className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-amber-600" aria-hidden="true" />Loading help articles…</div>;
}

function ErrorState({ query }) {
  return <section role="alert" className="rounded-2xl border border-slate-200 bg-white p-6 text-center sm:p-8"><LifeBuoy className="mx-auto mb-3 h-8 w-8 text-amber-600" aria-hidden="true" /><h2 className="text-lg font-bold text-slate-900">We couldn't load the help articles</h2><p className="mb-5 mt-2 text-sm leading-6 text-slate-500">Check your connection, then try again.</p><Button type="button" onClick={() => query.refetch()} disabled={query.isFetching} className="h-12 rounded-xl bg-amber-500 px-6 font-semibold text-white hover:bg-amber-600">{query.isFetching ? 'Retrying…' : 'Try again'}</Button></section>;
}

export default function HelpArticles() {
  const { profile } = useAuth();
  const role = profile?.role || 'employee';
  const [params, setParams] = useSearchParams();
  const articleSlug = params.get('article');
  const search = params.get('q') || '';
  const topic = params.get('topic') || 'all';
  const format = ['guide', 'faq'].includes(params.get('type')) ? params.get('type') : 'all';
  const collection = HELP_COLLECTIONS.find(item => item.id === params.get('collection'));
  const [limit, setLimit] = useState(PAGE_SIZE);
  const query = useQuery({
    queryKey: ['help-portal', profile?.id, role],
    enabled: !!profile?.id,
    retry: 1,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('help_faqs').select('id,slug,feature_area,audience,question,answer_short,answer_long,route,search_terms,priority,requires_admin,last_verified_at,article_type,read_minutes,related_slugs').eq('is_active', true).order('priority', { ascending: false });
      if (error) throw error;
      return (data || []).filter(article => canReadHelp(article, role));
    },
  });
  const articles = query.data || EMPTY;
  const topics = useMemo(() => [...new Set(articles.map(article => article.feature_area))].sort(), [articles]);
  const collections = useMemo(() => HELP_COLLECTIONS.map(item => ({ ...item, count: articles.filter(article => item.areas.includes(article.feature_area)).length })).filter(item => item.count > 0), [articles]);
  const featured = useMemo(() => FEATURED_HELP.map(slug => articles.find(article => article.slug === slug)).filter(Boolean), [articles]);
  const results = useMemo(() => findHelpArticles(articles, search, topic).filter(article => (format === 'all' || (article.article_type || 'faq') === format) && (!collection || collection.areas.includes(article.feature_area))), [articles, search, topic, format, collection]);
  const currentArticle = articleSlug ? articles.find(article => article.slug === articleSlug) : null;
  const filtered = Boolean(search || topic !== 'all' || format !== 'all' || collection);

  function updateFilters(changes) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('article');
      Object.entries(changes).forEach(([key, value]) => { if (!value || value === 'all') next.delete(key); else next.set(key, value); });
      return next;
    }, { replace: true });
    setLimit(PAGE_SIZE);
  }
  function clearFilters() { updateFilters({ q: '', topic: 'all', type: 'all', collection: '' }); }

  if (articleSlug) {
    if (query.isLoading || !profile?.id) return <main className="mx-auto max-w-6xl p-4 pb-28 sm:p-6 sm:pb-28"><LoadingState /></main>;
    if (query.isError) return <main className="mx-auto max-w-6xl space-y-6 p-4 pb-28 sm:p-6 sm:pb-28"><Link to={helpBrowseUrl(params)} className={`inline-flex min-h-12 items-center gap-2 rounded-lg px-2 font-semibold text-slate-600 ${FOCUS}`}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Help Articles</Link><ErrorState query={query} /><SupportCard /></main>;
    if (!currentArticle) return <main className="mx-auto max-w-4xl space-y-6 p-4 pb-28 sm:p-6 sm:pb-28"><section className="rounded-2xl border border-slate-200 bg-white p-6 text-center sm:p-10"><BookOpen className="mx-auto mb-4 h-10 w-10 text-amber-600" aria-hidden="true" /><h1 className="text-2xl font-black text-slate-900">This article isn't available</h1><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">It may have moved, or may cover a part of FuzedFlow your account cannot access. Browse the available help articles to find another answer.</p><Link to={helpBrowseUrl(params)} className={`mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 font-semibold text-white hover:bg-amber-600 ${FOCUS}`}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Browse help articles</Link></section><SupportCard /></main>;
    return <ArticleReader key={currentArticle.slug} article={currentArticle} articles={articles} params={params} role={role} />;
  }

  return <main className="mx-auto w-full max-w-6xl space-y-7 px-4 pb-28 pt-4 sm:space-y-9 sm:px-6 sm:pt-6">
    <header className="relative overflow-hidden rounded-2xl bg-slate-900 p-5 text-white sm:rounded-3xl sm:p-8">
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full border-[32px] border-amber-400/10" aria-hidden="true" />
      <div className="relative max-w-3xl"><p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-amber-300"><BookOpen className="h-4 w-4" aria-hidden="true" />FuzedFlow Help</p><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Help Articles</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">Clear steps, useful answers, and a smoother workday. Find the guidance you need to get the most from FuzedFlow.</p></div>
      <div className="relative mt-6 sm:mt-7"><label htmlFor="portal-search" className="sr-only">Search help articles</label><Search className="pointer-events-none absolute left-4 top-4 h-5 w-5 text-slate-400" aria-hidden="true" /><Input id="portal-search" type="search" maxLength={200} value={search} onChange={event => updateFilters({ q: event.target.value, topic: 'all', collection: '' })} placeholder="Search a feature, task, or question…" autoComplete="off" className="h-14 rounded-xl border-transparent bg-white pl-12 pr-14 text-base text-slate-900 placeholder:text-slate-400 focus-visible:ring-amber-400 [&::-webkit-search-cancel-button]:appearance-none" />{search && <button type="button" aria-label="Clear search" onClick={() => updateFilters({ q: '' })} className="absolute right-1 top-1 flex h-12 w-12 items-center justify-center rounded-lg text-slate-500 touch-manipulation hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"><X className="h-5 w-5" aria-hidden="true" /></button>}</div>
      {!filtered && featured.length > 0 && <div className="relative mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400"><span>Popular:</span>{featured.map(article => <Link key={article.id} to={helpArticleUrl(article.slug, params)} className="inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-medium text-slate-200 underline decoration-slate-600 underline-offset-4 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">{article.slug === 'guide-getting-started' ? 'Getting started' : article.slug === 'guide-mobile-navigation' ? 'Using mobile' : 'Troubleshooting'}</Link>)}</div>}
    </header>

    {query.isLoading || !profile?.id ? <LoadingState /> : query.isError ? <ErrorState query={query} /> : <>
      {!filtered && featured.length > 0 && <section aria-labelledby="recommended-help-heading"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="recommended-help-heading" className="text-xl font-bold tracking-tight text-slate-900">Start with the essentials</h2><span className="text-xs text-slate-500 sm:text-sm">A good place to begin</span></div><div className="grid gap-4 md:grid-cols-3">{featured.map(article => { const Icon = FEATURE_ICONS[article.slug] || BookOpen; return <Link key={article.id} to={helpArticleUrl(article.slug, params)} className={`group flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm touch-manipulation hover:border-amber-300 ${FOCUS}`}><div className="mb-4 flex items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Icon className="h-5 w-5" aria-hidden="true" /></div><span className="text-[10px] font-bold tracking-[0.12em] text-amber-800">{FEATURE_LABELS[article.slug] || 'RECOMMENDED'}</span></div><h3 className="text-lg font-bold leading-snug tracking-tight text-slate-900">{article.question}</h3><p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{article.answer_short}</p><div className="mt-auto flex items-center justify-between gap-2 pt-4"><span className="text-xs text-slate-500">{helpReadMinutes(article)} min read</span><ArrowRight className="h-5 w-5 text-amber-700 transition-transform group-hover:translate-x-1" aria-hidden="true" /></div></Link>; })}</div></section>}

      {!filtered && collections.length > 0 && <section aria-labelledby="help-topics-heading"><h2 id="help-topics-heading" className="mb-4 text-xl font-bold tracking-tight text-slate-900">Explore by topic</h2><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{collections.map(item => { const Icon = ICONS[item.icon] || BookOpen; return <button type="button" key={item.id} onClick={() => updateFilters({ collection: item.id })} className={`group flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-3.5 text-left touch-manipulation hover:border-amber-300 hover:bg-amber-50/30 ${FOCUS}`}><div className="mb-3 flex w-full items-center justify-between gap-1"><Icon className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" /><span className="text-[11px] text-slate-400">{item.count} {item.count === 1 ? 'article' : 'articles'}</span></div><h3 className="text-sm font-bold leading-5 text-slate-900">{item.title}</h3><p className="mt-2 hidden text-xs leading-5 text-slate-500 sm:block">{item.description}</p></button>; })}</div></section>}

      <section aria-labelledby="all-help-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"><h2 id="all-help-heading" className="text-xl font-bold tracking-tight text-slate-900">{search ? 'Search results' : collection ? collection.title : topic !== 'all' ? topic : 'All help articles'}</h2>{filtered && <button type="button" onClick={clearFilters} className={`min-h-12 rounded-lg px-3 text-sm font-semibold text-amber-800 hover:bg-amber-50 ${FOCUS}`}>Reset filters</button>}</div>
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div role="group" aria-label="Article type" className="flex min-w-0 gap-1 rounded-xl bg-slate-100 p-1">{[['all', 'All'], ['guide', 'Guides'], ['faq', 'Quick answers']].map(([value, label]) => <button type="button" key={value} aria-pressed={format === value} onClick={() => updateFilters({ type: value })} className={`min-h-12 flex-1 whitespace-nowrap rounded-lg px-2 text-sm font-semibold touch-manipulation sm:px-3 ${FOCUS} ${format === value ? 'bg-white text-amber-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>{label}</button>)}</div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-xs"><label htmlFor="portal-topic" className="sr-only">Filter by topic</label><select id="portal-topic" value={topic} onChange={event => updateFilters({ topic: event.target.value, collection: '' })} className={`h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-700 touch-manipulation ${FOCUS}`}><option value="all">All topics</option>{topics.map(area => <option key={area} value={area}>{area}</option>)}</select></div>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-slate-500">{results.length} {results.length === 1 ? 'article' : 'articles'}{search ? ` matching “${search}”` : ''}{collection ? ` in ${collection.title.toLowerCase()}` : ''}</p>
        {results.length > 0 ? <><div className="grid gap-4 md:grid-cols-2">{results.slice(0, limit).map(article => <ArticleCard key={article.id} article={article} params={params} />)}</div>{results.length > limit && <Button type="button" variant="outline" onClick={() => setLimit(value => value + PAGE_SIZE)} className="h-12 w-full rounded-xl border-slate-200 bg-white text-slate-700">Show more articles ({results.length - limit} remaining)</Button>}</> : <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center sm:p-8"><Search className="mx-auto mb-3 h-8 w-8 text-slate-400" aria-hidden="true" /><h3 className="text-lg font-bold text-slate-900">{articles.length ? 'No matching articles' : 'Help articles are not available yet'}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{articles.length ? 'Try a shorter search, choose another topic, or include quick answers in your results.' : 'Please try again later, or contact our team for help.'}</p>{articles.length > 0 && <Button type="button" variant="outline" onClick={clearFilters} className="mt-5 h-12 rounded-xl">Show all articles</Button>}</section>}
      </section>
    </>}
    <SupportCard />
  </main>;
}
