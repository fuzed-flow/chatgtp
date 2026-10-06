import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, Loader2, FileText, Users, Target, FolderKanban, Receipt, Filter, X, AlertCircle, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EMPTY_SEARCH_FILTERS, SEARCH_ENTITY_TYPES, getSearchTypes, hasSearchCriteria, getSearchFilterError, searchGlobalRecords } from "@/lib/globalSearch";

const ENTITY_ICONS = { Quote: FileText, Client: Users, Lead: Target, Project: FolderKanban, Invoice: Receipt };
const EMPTY_RESULTS = { scope: "", criteria: "", status: "idle", results: [], errors: [], hasMore: false };
const FIELD_CLASS = "h-12 min-w-0 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500";

export default function GlobalSearch({ onCloseSidebar }) {
  const { profile, company } = useAuth();
  const navigate = useNavigate();
  const id = useId();
  const inputRef = useRef(null);
  const contentRef = useRef(null);
  const returnFocusRef = useRef(null);
  const resultRefs = useRef([]);
  const controllerRef = useRef(null);
  const generationRef = useRef(0);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const planIdRef = useRef(company?.plan_id);
  planIdRef.current = company?.plan_id;

  const permissions = Array.isArray(profile?.permissions) ? [...profile.permissions].sort() : Object.entries(profile?.permissions || {}).sort(([a], [b]) => a.localeCompare(b));
  const scope = JSON.stringify([profile?.id, profile?.company_id, profile?.role, profile?.is_active, permissions, company?.plan_id]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const previousScopeRef = useRef(scope);
  const availableTypes = getSearchTypes(profile, company?.plan_id);
  const canOpen = availableTypes.length > 0;
  const availableEntities = SEARCH_ENTITY_TYPES.filter(entity => availableTypes.includes(entity.name));
  const ready = Boolean(profile?.id && profile?.company_id && profile?.is_active !== false && availableTypes.length);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ ...EMPTY_SEARCH_FILTERS });
  const [showFilters, setShowFilters] = useState(false);
  const [searchState, setSearchState] = useState(EMPTY_RESULTS);
  const [retry, setRetry] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [viewport, setViewport] = useState(null);

  const activeFilterCount = Object.values(filters).filter(value => value !== "" && value !== "all").length;
  const hasActiveFilters = activeFilterCount > 0;
  const criteria = JSON.stringify([query, filters]);
  const filterError = getSearchFilterError(filters);
  const hasCriteria = hasSearchCriteria(query, filters);
  const currentState = open && searchState.scope === scope && searchState.criteria === criteria ? searchState : EMPTY_RESULTS;
  const results = currentState.results;
  const errors = currentState.errors;
  const searching = currentState.status === "waiting" || currentState.status === "loading";
  const selectedEntity = availableEntities.find(entity => entity.name === filters.type);
  const relevantEntities = selectedEntity ? [selectedEntity] : availableEntities;
  const supportsDate = relevantEntities.some(entity => entity.dateColumn);
  const supportsAmount = relevantEntities.some(entity => entity.amountColumn);
  const statusOptions = [...new Map(relevantEntities.flatMap(entity => entity.statusOptions || entity.statuses.map(value => ({ value, label: value }))).map(option => [option.value, option])).values()];
  const dateHint = relevantEntities.filter(entity => entity.dateColumn).map(entity => entity.name).join(", ");
  const amountHint = relevantEntities.filter(entity => entity.amountColumn).map(entity => entity.name).join(", ");

  const invalidateRequest = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const resetResults = useCallback(() => {
    invalidateRequest();
    setSearchState(EMPTY_RESULTS);
    setSelectedIndex(-1);
  }, [invalidateRequest]);

  const changeOpen = useCallback(nextOpen => {
    if (!nextOpen) {
      resetResults();
      setQuery("");
    }
    setOpen(nextOpen);
  }, [resetResults]);

  const openSearch = event => {
    returnFocusRef.current = event?.currentTarget || document.activeElement;
    changeOpen(true);
    onCloseSidebar?.();
  };

  useEffect(() => {
    if (previousScopeRef.current === scope) return;
    previousScopeRef.current = scope;
    invalidateRequest();
    setSearchState(EMPTY_RESULTS);
    setSelectedIndex(-1);
    setQuery("");
    setFilters({ ...EMPTY_SEARCH_FILTERS });
    setShowFilters(false);
    setOpen(false);
  }, [scope, invalidateRequest]);

  useEffect(() => {
    const handleShortcut = event => {
      if (!canOpen) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k" || event.isComposing) return;
      const otherDialog = document.querySelector('[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), [aria-modal="true"]:not([data-state="closed"])');
      if (otherDialog && otherDialog !== contentRef.current) return;
      event.preventDefault();
      if (open) changeOpen(false);
      else {
        returnFocusRef.current = document.activeElement;
        changeOpen(true);
        onCloseSidebar?.();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [open, canOpen, changeOpen, onCloseSidebar]);

  useEffect(() => {
    invalidateRequest();
    setSearchState(EMPTY_RESULTS);
    setSelectedIndex(-1);
    if (!open || !ready || !hasCriteria || filterError) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = generationRef.current;
    const currentRequest = () => !controller.signal.aborted && generationRef.current === generation && scopeRef.current === scope;
    setSearchState({ ...EMPTY_RESULTS, scope, criteria, status: "waiting" });
    const timer = window.setTimeout(async () => {
      if (!currentRequest()) return;
      setSearchState({ ...EMPTY_RESULTS, scope, criteria, status: "loading" });
      try {
        const response = await searchGlobalRecords({ query, filters, profile: profileRef.current, planId: planIdRef.current, signal: controller.signal });
        if (!currentRequest()) return;
        setSearchState({ scope, criteria, status: "done", results: response.results, errors: response.errors, hasMore: response.hasMore });
      } catch (error) {
        if (!currentRequest() || error?.name === "AbortError") return;
        setSearchState({ ...EMPTY_RESULTS, scope, criteria, status: "done", errors: [{ type: "Search", message: "Search is unavailable. Please retry." }] });
      }
    }, 275);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
      generationRef.current += 1;
    };
  }, [open, ready, query, filters, scope, criteria, hasCriteria, filterError, retry, invalidateRequest]);

  useEffect(() => {
    if (!open) return;
    const visualViewport = window.visualViewport;
    const updateViewport = () => setViewport({
      height: visualViewport?.height ?? window.innerHeight,
      offset: visualViewport?.offsetTop ?? 0,
    });
    updateViewport();
    window.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("scroll", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("scroll", updateViewport);
    };
  }, [open]);

  useEffect(() => {
    if (selectedIndex >= 0) resultRefs.current[selectedIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  const changeQuery = value => {
    resetResults();
    setQuery(value);
  };
  const changeFilter = (name, value) => {
    resetResults();
    setFilters(previous => {
      const next = { ...previous, [name]: value };
      if (name === "type") {
        next.status = "all";
        const entity = availableEntities.find(item => item.name === value);
        if (entity && !entity.dateColumn) { next.dateFrom = ""; next.dateTo = ""; }
        if (entity && !entity.amountColumn) { next.minAmount = ""; next.maxAmount = ""; }
      }
      return next;
    });
  };
  const clearFilters = () => {
    resetResults();
    setFilters({ ...EMPTY_SEARCH_FILTERS });
  };
  const selectResult = result => {
    if (!result.url) return;
    changeOpen(false);
    onCloseSidebar?.();
    navigate(result.url);
  };
  const focusResult = index => {
    if (!results.length) return;
    const nextIndex = (index + results.length) % results.length;
    setSelectedIndex(nextIndex);
    resultRefs.current[nextIndex]?.focus();
  };
  const handleInputKeyDown = event => {
    if (!results.length || event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusResult(event.key === "ArrowDown" ? 0 : results.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectResult(results[selectedIndex >= 0 ? selectedIndex : 0]);
    }
  };
  const handleResultKeyDown = (event, index) => {
    if (event.key === "Enter") {
      event.preventDefault();
      selectResult(results[index]);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (event.key === "Home") focusResult(0);
      else if (event.key === "End") focusResult(results.length - 1);
      else focusResult(index + (event.key === "ArrowDown" ? 1 : -1));
    }
  };

  if (!canOpen) return null;

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Button type="button" aria-label="Open global search" variant="ghost" size="icon" onClick={openSearch}
        className="md:hidden h-12 w-12 shrink-0 rounded-lg text-amber-400 hover:bg-slate-800 hover:text-amber-300 focus-visible:ring-amber-500 touch-manipulation">
        <Search className="h-5 w-5" aria-hidden="true" />
      </Button>
      <button type="button" aria-label="Open global search" onClick={openSearch}
        className="hidden md:flex h-12 w-64 items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600 shadow-sm transition-colors hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
        <Search className="h-4 w-4 text-amber-600" aria-hidden="true" />
        <span className="font-medium">Search records...</span>
        <kbd className="ml-auto rounded border border-slate-300 bg-white px-1.5 text-[10px] font-semibold text-slate-500">⌘/Ctrl K</kbd>
      </button>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[130] bg-slate-950/45 backdrop-blur-sm" />
        <Dialog.Content ref={contentRef}
          style={viewport ? { "--search-viewport-height": `${viewport.height}px`, "--search-viewport-offset": `${viewport.offset}px` } : undefined}
          onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus(); }}
          onCloseAutoFocus={event => { event.preventDefault(); if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus(); }}
          className="fixed left-2 right-2 top-[calc(var(--search-viewport-offset,0px)+env(safe-area-inset-top)+0.5rem)] z-[131] flex h-[min(42rem,calc(var(--search-viewport-height,100dvh)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem))] min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl focus:outline-none sm:left-1/2 sm:right-auto sm:top-[calc(var(--search-viewport-offset,0px)+min(4rem,5vh))] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:h-[min(42rem,calc(var(--search-viewport-height,100dvh)-min(8rem,10vh)))]">
          <div className="flex shrink-0 items-center justify-between gap-3 px-3 pt-2 sm:px-4">
            <Dialog.Title className="font-semibold text-slate-900">Search FuzedFlow</Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Close global search" className="h-12 w-12 shrink-0 text-slate-500 hover:bg-slate-100 focus-visible:ring-amber-500 touch-manipulation">
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Search the records you can access. Use the arrow keys to move through results and Enter to open a record.</Dialog.Description>
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 pb-3 sm:px-4">
            <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500">
              <Search className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              <input ref={inputRef} type="search" aria-label="Search records" aria-controls={`${id}-results`} autoComplete="off" maxLength={200} value={query} onChange={event => changeQuery(event.target.value)} onKeyDown={handleInputKeyDown}
                placeholder="Find records..." className="h-full min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400" />
              {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-600" aria-hidden="true" />}
            </div>
            <Button type="button" variant="ghost" aria-label="Search filters" aria-expanded={showFilters} aria-controls={`${id}-filters`} onClick={() => setShowFilters(previous => !previous)}
              className={cn("h-12 min-w-12 shrink-0 gap-1.5 px-3 focus-visible:ring-amber-500 touch-manipulation", showFilters || hasActiveFilters ? "bg-amber-100 text-amber-900 hover:bg-amber-200" : "text-slate-600 hover:bg-slate-100")}>
              <Filter className="h-5 w-5" aria-hidden="true" />
              <span className="hidden sm:inline">Filters</span>
              {hasActiveFilters && <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-slate-900">{activeFilterCount}</span>}
            </Button>
          </div>
          {showFilters && <section id={`${id}-filters`} aria-label="Search filters" className="min-h-0 max-h-[55%] shrink overflow-y-auto overscroll-contain border-b border-slate-200 bg-slate-50 px-3 pb-3 sm:px-4">
            <div className="flex min-h-12 items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-700">Filter records</h3>
              <Button type="button" variant="ghost" onClick={clearFilters} disabled={!hasActiveFilters} className="h-12 text-sm text-slate-600 hover:text-slate-900 focus-visible:ring-amber-500">Clear filters</Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-type`} className="text-xs font-semibold text-slate-600">Record type</Label>
                <select id={`${id}-type`} value={filters.type} onChange={event => changeFilter("type", event.target.value)} className={FIELD_CLASS}>
                  <option value="all">All types</option>{availableEntities.map(entity => <option key={entity.name} value={entity.name}>{entity.label}</option>)}
                </select></div>
              <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-status`} className="text-xs font-semibold text-slate-600">Status</Label>
                <select id={`${id}-status`} value={filters.status} disabled={!statusOptions.length} onChange={event => changeFilter("status", event.target.value)} className={cn(FIELD_CLASS, "disabled:bg-slate-100 disabled:text-slate-400")}>
                  <option value="all">All statuses</option>{statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select></div>
              <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-date-from`} className="text-xs font-semibold text-slate-600">From date</Label>
                <Input id={`${id}-date-from`} type="date" disabled={!supportsDate} value={filters.dateFrom} onChange={event => changeFilter("dateFrom", event.target.value)} className={FIELD_CLASS} /></div>
              <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-date-to`} className="text-xs font-semibold text-slate-600">To date</Label>
                <Input id={`${id}-date-to`} type="date" disabled={!supportsDate} value={filters.dateTo} onChange={event => changeFilter("dateTo", event.target.value)} className={FIELD_CLASS} /></div>
              <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-amount-min`} className="text-xs font-semibold text-slate-600">Minimum amount</Label>
                <Input id={`${id}-amount-min`} type="number" inputMode="decimal" min="0" step="0.01" disabled={!supportsAmount} value={filters.minAmount} onChange={event => changeFilter("minAmount", event.target.value)} placeholder="0.00" className={FIELD_CLASS} /></div>
              <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-amount-max`} className="text-xs font-semibold text-slate-600">Maximum amount</Label>
                <Input id={`${id}-amount-max`} type="number" inputMode="decimal" min="0" step="0.01" disabled={!supportsAmount} value={filters.maxAmount} onChange={event => changeFilter("maxAmount", event.target.value)} placeholder="No limit" className={FIELD_CLASS} /></div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">Dates apply to {dateHint || "no records of this type"}. Amounts apply to {amountHint || "no records of this type"}. Records without an applicable field are excluded when that filter is set.</p>
          </section>}
          {hasActiveFilters && !showFilters && <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 text-xs text-amber-900 sm:px-4">
            <span>{activeFilterCount} active {activeFilterCount === 1 ? "filter" : "filters"}</span>
            <Button type="button" variant="ghost" onClick={clearFilters} className="h-12 px-2 text-amber-900 hover:bg-amber-50 focus-visible:ring-amber-500">Clear filters</Button>
          </div>}
          <div id={`${id}-results`} className="min-h-[min(5rem,25%)] flex-1 overflow-y-auto overscroll-contain bg-white" aria-busy={searching}>
            <div role="status" aria-live="polite" className="sr-only">{searching ? "Searching records" : currentState.status === "done" ? `${results.length} ${results.length === 1 ? "result" : "results"}${errors.length ? ". Some records could not be searched." : ""}` : ""}</div>
            {filterError ? <p role="alert" className="px-4 py-6 text-sm text-red-700">{filterError}</p> : !ready ? <p className="px-4 py-8 text-center text-sm text-slate-500">{profile?.company_id ? "No searchable records are available for your role." : "Your account is still loading. Please try again in a moment."}</p> : <>
              {errors.length > 0 && <div role="alert" className="m-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div className="min-w-0"><p className="font-semibold">{results.length ? "Some records could not be searched" : "Search could not be completed"}</p><p className="mt-1 break-words">{errors.map(error => `${error.type}: ${error.message}`).join(" ")}</p></div></div>
                <Button type="button" variant="ghost" onClick={() => { resetResults(); setRetry(previous => previous + 1); }} className="mt-1 h-12 gap-2 px-2 text-amber-950 hover:bg-amber-100 focus-visible:ring-amber-500"><RefreshCw className="h-4 w-4" aria-hidden="true" />Retry search</Button>
              </div>}
              {results.length > 0 ? <ul aria-label="Search results" className="space-y-1 p-2">
                {results.map((result, index) => {
                  const Icon = ENTITY_ICONS[result.type] || FileText;
                  return <li key={`${result.type}-${result.id}`}><button type="button" ref={element => { resultRefs.current[index] = element; }} onFocus={() => setSelectedIndex(index)} onKeyDown={event => handleResultKeyDown(event, index)} onClick={() => selectResult(result)}
                    aria-label={`${result.type}: ${result.title}${result.status ? ` · ${result.status}` : ""}`} aria-current={selectedIndex === index ? "true" : undefined}
                    className={cn("flex min-h-16 w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 touch-manipulation", selectedIndex === index ? "border-amber-200 bg-amber-50" : "border-transparent hover:border-slate-200 hover:bg-slate-50")}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-100 bg-amber-50 text-amber-700"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900">{result.title}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{result.subtitle}</span><span className="mt-1 block text-xs text-slate-500">{result.type}{result.status ? ` · ${result.status}` : ""}</span></span>
                  </button></li>;
                })}
              </ul> : searching ? <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-amber-600" aria-hidden="true" />Searching records...</div> : currentState.status === "done" && !errors.length ? <div className="px-4 py-10 text-center"><Search className="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" /><p className="text-sm font-semibold text-slate-600">No matching records</p><p className="mt-1 text-sm text-slate-500">Try another search or adjust your filters.</p></div> : !hasCriteria ? <div className="px-4 py-10 text-center"><Search className="mx-auto mb-3 h-8 w-8 text-amber-400" aria-hidden="true" /><p className="text-sm font-semibold text-slate-600">Find the records you need</p><p className="mt-1 text-sm text-slate-500">Enter at least 2 characters or choose a filter to begin.</p></div> : null}
              {currentState.hasMore && <p className="px-4 pb-4 text-sm text-slate-500">More records match. Refine your search or filters to narrow the results.</p>}
            </>}
          </div>
          <div className="hidden shrink-0 border-t border-slate-100 px-4 py-2 text-xs text-slate-500 sm:block">↑ ↓ to move · Enter to open · Esc to close</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
