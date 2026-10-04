import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronDown, ArrowRight, Search, X, Loader2, MessageCircle } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { canReadHelp, findHelpArticles, helpPageRoute } from '@/lib/helpContent';
import AIHelpAnswer from '@/components/shared/AIHelpAnswer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const EMPTY = [];
const PAGE_SIZE = 18;
const POPULAR = ['Quotes', 'Projects', 'Leads', 'Invoices', 'Employee Portal', 'Notifications'];

export default function FAQ() {
  const { profile } = useAuth();
  const role = profile?.role || 'employee';
  const [params] = useSearchParams();
  const articleSlug = params.get('article');
  const [search, setSearch] = useState(params.get('q') || '');
  const [category, setCategory] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const query = useQuery({
    queryKey: ['help-faqs', profile?.id, role],
    enabled: !!profile?.id,
    retry: 1,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('help_faqs')
        .select('id,slug,feature_area,audience,question,answer_short,answer_long,route,search_terms,priority,requires_admin,last_verified_at')
        .eq('is_active', true).eq('article_type', 'faq').order('priority', { ascending: false });
      if (error) throw error;
      return (data || []).filter(article => canReadHelp(article, role));
    },
  });
  const articles = query.data || EMPTY;
  const categories = useMemo(() => [...new Set(articles.map(article => article.feature_area))].sort(), [articles]);
  const results = useMemo(() => findHelpArticles(articles, search, category), [articles, search, category]);

  useEffect(() => {
    const article = articles.find(item => item.slug === articleSlug);
    if (article) {
      setSearch(article.question);
      setCategory('all');
      setOpenId(article.id);
      setLimit(PAGE_SIZE);
    }
  }, [articleSlug, articles]);

  function resetResults() { setOpenId(null); setLimit(PAGE_SIZE); }
  function clearFilters() { setSearch(''); setCategory('all'); resetResults(); }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 p-4 pb-28 sm:space-y-6 sm:p-6 sm:pb-28">
      <header className="flex items-start gap-3 sm:gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><BookOpen className="h-6 w-6" aria-hidden="true" /></div>
        <div className="min-w-0"><h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Knowledge Base & FAQ</h1><p className="mt-1 text-sm leading-relaxed text-slate-500 sm:text-base">Find an answer, follow the steps, and get back to work.</p></div>
      </header>

      <section aria-label="Find help" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div>
          <label htmlFor="help-search" className="sr-only">Search the knowledge base</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-4 h-5 w-5 text-slate-400" aria-hidden="true" />
            <Input id="help-search" type="search" value={search} placeholder="Search questions or features…" autoComplete="off"
              onChange={event => { setSearch(event.target.value); setCategory('all'); resetResults(); }}
              className="h-12 rounded-xl border-slate-200 pl-10 pr-12 text-base focus-visible:ring-amber-500 [&::-webkit-search-cancel-button]:appearance-none" />
            {search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(''); resetResults(); }} className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center rounded-xl text-slate-500 touch-manipulation focus-visible:ring-2 focus-visible:ring-amber-500"><X className="h-5 w-5" aria-hidden="true" /></button>}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <label htmlFor="help-topic" className="text-sm font-semibold text-slate-600">Browse a topic</label>
          <select id="help-topic" value={category} onChange={event => { setCategory(event.target.value); resetResults(); }} className="h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 sm:flex-1">
            <option value="all">All topics</option>
            {categories.map(topic => <option key={topic} value={topic}>{topic}</option>)}
          </select>
        </div>
        {!search && category === 'all' && <div className="hidden flex-wrap gap-2 sm:flex" aria-label="Popular topics">{POPULAR.filter(topic => categories.includes(topic)).map(topic => <button type="button" key={topic} onClick={() => { setCategory(topic); resetResults(); }} className="min-h-11 rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:border-amber-300 hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-amber-500">{topic}</button>)}</div>}
      </section>

      {query.isLoading ? <div role="status" className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />Loading help articles…</div>
        : query.isError ? <section role="alert" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 text-center"><h2 className="font-semibold text-slate-900">Help articles couldn't load</h2><p className="text-sm text-slate-500">Check your connection and try again.</p><Button onClick={() => query.refetch()} disabled={query.isFetching} className="h-12 bg-amber-500 text-white hover:bg-amber-600">{query.isFetching ? 'Retrying…' : 'Try again'}</Button></section>
          : <>
            <div className="flex items-center justify-between gap-3"><p role="status" aria-live="polite" className="text-sm text-slate-500">{results.length} {results.length === 1 ? 'answer' : 'answers'}{category !== 'all' ? ` in ${category}` : ''}</p>{(search || category !== 'all') && <button type="button" onClick={clearFilters} className="min-h-11 shrink-0 px-2 text-sm font-semibold text-amber-800 underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-amber-500">Reset filters</button>}</div>
            {results.length === 0 ? <section className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center"><h2 className="font-semibold text-slate-900">{articles.length ? 'No matching answers' : 'Help articles are not available yet'}</h2><p className="text-sm leading-relaxed text-slate-500">{articles.length ? 'Try a shorter search or choose another topic.' : 'Please try again later or contact support.'}</p>{articles.length > 0 && <Button variant="outline" onClick={clearFilters} className="h-12">Show all topics</Button>}</section>
              : <section className="space-y-3" aria-label="Help articles">{results.slice(0, limit).map(article => {
                const open = openId === article.id;
                const route = helpPageRoute(article.route, role);
                return <article key={article.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <h2><button type="button" id={`question-${article.id}`} aria-expanded={open} aria-controls={`answer-${article.id}`} onClick={() => setOpenId(open ? null : article.id)} className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-4 text-left touch-manipulation hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 sm:px-5">
                    <span className="min-w-0"><span className="mb-1 block text-xs font-medium text-amber-800">{article.feature_area}</span><span className="block text-base font-semibold leading-snug text-slate-900">{article.question}</span></span>
                    <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button></h2>
                  <div id={`answer-${article.id}`} role="region" aria-labelledby={`question-${article.id}`} hidden={!open}>
                    {open && <div className="space-y-3 border-t border-slate-100 px-4 py-4 text-sm leading-relaxed text-slate-600 [overflow-wrap:anywhere] sm:px-5"><AIHelpAnswer text={article.answer_long || article.answer_short} />{route && <Link to={route} className="inline-flex min-h-12 items-center gap-2 rounded-lg px-2 font-semibold text-amber-800 touch-manipulation hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-amber-500">Open related page<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}</div>}
                  </div>
                </article>;
              })}{results.length > limit && <Button variant="outline" className="h-12 w-full rounded-xl" onClick={() => setLimit(value => value + PAGE_SIZE)}>Show more answers ({results.length - limit} remaining)</Button>}</section>}
          </>}

      <aside className="rounded-2xl bg-slate-900 p-5 text-white sm:flex sm:items-center sm:justify-between sm:gap-4"><div><h2 className="font-semibold">Need a hand?</h2><p className="mt-1 text-sm leading-relaxed text-slate-300">Ask AI Help, or reach our support team.</p></div><Link to="/Contact" className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 text-sm font-semibold text-white touch-manipulation hover:bg-amber-600 focus-visible:ring-2 focus-visible:ring-amber-300 sm:mt-0 sm:w-auto sm:shrink-0"><MessageCircle className="h-4 w-4" aria-hidden="true" />Contact support</Link></aside>
    </main>
  );
}
