import { supabase } from '@/api/supabaseClient';

export const EMPTY_SEARCH_FILTERS = Object.freeze({
  type: 'all', status: 'all', dateFrom: '', dateTo: '', minAmount: '', maxAmount: '',
});

const entities = [
  {
    name: 'Quote', label: 'Quotes', page: '/QuoteView', permission: 'quotes', table: 'quotes',
    select: 'id,title,quote_number,status,total,issue_date,created_at',
    textColumns: ['title', 'quote_number'], statusColumn: 'status', dateColumn: 'issue_date', amountColumn: 'total',
    statuses: ['Draft', 'Sent', 'Approved', 'Declined', 'Expired'],
  },
  {
    name: 'Client', label: 'Clients', page: '/ClientDetail', permission: 'clients', table: 'clients',
    select: 'id,name,email,created_at', textColumns: ['name', 'email'], statuses: [],
  },
  {
    name: 'Lead', label: 'Leads', page: '/LeadDetail', permission: 'leads', table: 'leads',
    select: 'id,contact_name,contact_email,pipeline_stage,value_estimate,created_at',
    textColumns: ['contact_name', 'contact_email'], statusColumn: 'pipeline_stage', amountColumn: 'value_estimate',
    statuses: ['New', 'Contacted', 'Booked Visit', 'Quoted', 'Negotiation', 'Won', 'Lost'],
  },
  {
    name: 'Project', label: 'Projects', page: '/PMProjectWorkspace', permission: 'projects', table: 'projects',
    select: 'id,name,project_number,status,budget_revenue,start_date,created_at,clients(name)',
    textColumns: ['name', 'project_number'], statusColumn: 'status', dateColumn: 'start_date', amountColumn: 'budget_revenue',
    statuses: ['Lead', 'Planning', 'Active', 'In Progress', 'On Hold', 'Completed', 'Cancelled'],
  },
  {
    name: 'Invoice', label: 'Invoices', page: '/InvoiceView', permission: 'invoices', table: 'invoices',
    select: 'id,invoice_number,status,total,issue_date,created_at',
    textColumns: ['invoice_number'], statusColumn: 'status', dateColumn: 'issue_date', amountColumn: 'total',
    statuses: ['Draft', 'Sent', 'Partial', 'Paid', 'Overdue'],
  },
];

export const SEARCH_ENTITY_TYPES = Object.freeze(entities.map(entity => Object.freeze({
  ...entity,
  textColumns: Object.freeze(entity.textColumns),
  statuses: Object.freeze(entity.statuses),
  statusOptions: Object.freeze(entity.statuses.map(value => Object.freeze({ value, label: value }))),
})));

const TYPE_LIMIT = 8;
const RESULT_LIMIT = 40;
const ALL_STATUSES = new Set(entities.flatMap(entity => entity.statuses));
const textValue = value => value == null ? '' : String(value).trim();
const normalizeFilters = filters => ({ ...EMPTY_SEARCH_FILTERS, ...filters });
const hasValue = value => textValue(value) !== '';

// Mirror the office navigation permissions. The explicit company predicate is
// mandatory for every query; the caller's RLS policies also apply independently.
export function getSearchTypes(profile, planId = 'business') {
  if (!profile || profile.is_active === false) return [];
  if (['owner', 'admin'].includes(profile.role)) return entities.map(entity => entity.name);
  if (!['manager', 'office'].includes(profile.role)) return [];
  const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
  const customPermissionsApply = planId === 'business' && permissions.length > 0;
  return entities.filter(entity => {
    if (entity.name === 'Invoice' && profile.role !== 'office') return false;
    if (!customPermissionsApply) return true;
    return permissions.includes(entity.permission);
  }).map(entity => entity.name);
}

export function hasSearchCriteria(query, filters) {
  const active = normalizeFilters(filters);
  return textValue(query).length >= 2 || active.type !== 'all' || active.status !== 'all'
    || ['dateFrom', 'dateTo', 'minAmount', 'maxAmount'].some(key => hasValue(active[key]));
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) === 0) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validAmount(value) {
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value)) && Number(value) >= 0;
}

export function getSearchFilterError(filters) {
  const active = normalizeFilters(filters);
  if (active.type !== 'all' && !entities.some(entity => entity.name === active.type)) return 'Choose a valid record type.';
  if (active.status !== 'all' && !ALL_STATUSES.has(active.status)) return 'Choose a valid status.';
  const dateFrom = textValue(active.dateFrom);
  const dateTo = textValue(active.dateTo);
  if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo))) return 'Enter valid dates.';
  if (dateFrom && dateTo && dateFrom > dateTo) return 'The start date must be on or before the end date.';
  const minAmount = textValue(active.minAmount);
  const maxAmount = textValue(active.maxAmount);
  if ((minAmount && !validAmount(minAmount)) || (maxAmount && !validAmount(maxAmount))) return 'Enter valid amounts of zero or more.';
  if (minAmount && maxAmount && Number(minAmount) > Number(maxAmount)) return 'The minimum amount must not exceed the maximum amount.';
  return null;
}

function supportsFilters(entity, filters) {
  if (filters.type !== 'all' && filters.type !== entity.name) return false;
  if (filters.status !== 'all' && !entity.statuses.includes(filters.status)) return false;
  if ((hasValue(filters.dateFrom) || hasValue(filters.dateTo)) && !entity.dateColumn) return false;
  if ((hasValue(filters.minAmount) || hasValue(filters.maxAmount)) && !entity.amountColumn) return false;
  return true;
}

function quotedFilterValue(value) {
  // Supabase .or() accepts raw PostgREST grammar. Quote its entire value and
  // escape grammar-level quotes/backslashes separately from LIKE wildcards.
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function searchCondition(entity, query) {
  // PostgREST turns every '*' into '%' for LIKE, even a quoted/escaped star.
  // For that case use an entirely escaped literal regex instead of broadening
  // the user's search. No user-provided regex operators reach the database.
  const operator = query.includes('*') ? 'imatch' : 'ilike';
  const pattern = operator === 'imatch'
    ? query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  return entity.textColumns.map(column => `${column}.${operator}.${quotedFilterValue(pattern)}`).join(',');
}

function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Search cancelled.');
  error.name = 'AbortError';
  throw error;
}

const money = value => {
  const amount = value == null || value === '' ? 0 : Number(value);
  return `$${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
};

function recordResult(entity, record) {
  const result = {
    type: entity.name, id: record.id, page: entity.page,
    url: `${entity.page}?id=${encodeURIComponent(String(record.id))}`,
    status: entity.statusColumn ? record[entity.statusColumn] || '' : '',
  };
  if (entity.name === 'Quote') return { ...result, title: record.title || record.quote_number || 'Untitled quote', subtitle: [record.quote_number, money(record.total)].filter(Boolean).join(' · ') };
  if (entity.name === 'Client') return { ...result, title: record.name || 'Unnamed client', subtitle: record.email || 'No email' };
  if (entity.name === 'Lead') return { ...result, title: record.contact_name || 'Unnamed lead', subtitle: record.contact_email || 'No email' };
  if (entity.name === 'Project') return { ...result, title: record.name || record.project_number || 'Untitled project', subtitle: [record.project_number, record.clients?.name, money(record.budget_revenue)].filter(Boolean).join(' · ') };
  return { ...result, title: record.invoice_number || 'Untitled invoice', subtitle: money(record.total) };
}

function relevance(record, entity, query) {
  if (!query) return 0;
  const term = query.toLocaleLowerCase();
  return Math.max(...entity.textColumns.map(column => {
    const text = textValue(record[column]).toLocaleLowerCase();
    if (text === term) return 3;
    if (text.startsWith(term)) return 2;
    return text.includes(term) ? 1 : 0;
  }));
}

export async function searchGlobalRecords({ query = '', filters, profile, planId = 'business', signal } = {}) {
  const empty = { results: [], errors: [], hasMore: false };
  abortIfNeeded(signal);
  const active = normalizeFilters(filters);
  const term = textValue(query);
  if (!profile?.company_id || !hasSearchCriteria(term, active) || getSearchFilterError(active)) return empty;
  const permitted = new Set(getSearchTypes(profile, planId));
  const selected = SEARCH_ENTITY_TYPES.filter(entity => permitted.has(entity.name) && supportsFilters(entity, active));
  const typeLimit = selected.length === 1 ? RESULT_LIMIT : TYPE_LIMIT;
  const responses = await Promise.allSettled(selected.map(async entity => {
    abortIfNeeded(signal);
    let request = supabase.from(entity.table).select(entity.select).eq('company_id', profile.company_id);
    if (entity.name === 'Quote') request = request.eq('is_template', false);
    if (entity.name === 'Project') request = request.eq('clients.company_id', profile.company_id);
    if (term) request = request.or(searchCondition(entity, term));
    if (active.status !== 'all') request = request.eq(entity.statusColumn, active.status);
    if (hasValue(active.dateFrom)) request = request.gte(entity.dateColumn, textValue(active.dateFrom));
    if (hasValue(active.dateTo)) request = request.lte(entity.dateColumn, textValue(active.dateTo));
    if (hasValue(active.minAmount)) request = request.gte(entity.amountColumn, Number(active.minAmount));
    if (hasValue(active.maxAmount)) request = request.lte(entity.amountColumn, Number(active.maxAmount));
    request = request.order('created_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(typeLimit + 1);
    if (signal) request = request.abortSignal(signal);
    const response = await request;
    if (response.error) throw response.error;
    return Array.isArray(response.data) ? response.data : [];
  }));
  abortIfNeeded(signal);

  const errors = [];
  let hasMore = false;
  const groups = responses.map((response, index) => {
    const entity = selected[index];
    if (response.status !== 'fulfilled') {
      errors.push({ type: entity.name, message: `Could not search ${entity.label.toLowerCase()}. Please try again.` });
      return [];
    }
    const records = response.value;
    if (records.length > typeLimit) hasMore = true;
    // Relevance improves the bounded recent matches without letting one entity
    // consume every result slot. Stable ties retain the server's date/id order.
    return records.slice(0, typeLimit)
      .filter(record => record && record.id != null)
      .sort((left, right) => relevance(right, entity, term) - relevance(left, entity, term))
      .map(record => recordResult(entity, record));
  });

  const results = [];
  for (let index = 0; index < typeLimit; index++) {
    for (const group of groups) {
      if (!group[index]) continue;
      if (results.length < RESULT_LIMIT) results.push(group[index]);
      else hasMore = true;
    }
  }
  return { results, errors, hasMore };
}
