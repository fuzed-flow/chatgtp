import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const owner = { id: 'owner-one', role: 'owner', company_id: 'company-one', is_active: true };
const bundle = await build({
  stdin: { contents: `export * from './src/lib/globalSearch.js';`, sourcefile: 'search-engine-fixture.js', resolveDir: local('../../') },
  bundle: true, write: false, platform: 'node', format: 'esm', alias: { '@': local('../../src') },
  plugins: [{ name: 'search-database-fixture', setup(builder) {
    builder.onResolve({ filter: /^@\/api\/supabaseClient$/ }, () => ({ path: 'search-db', namespace: 'search-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'search-test' }, () => ({ contents: `export const supabase={from:(table)=>globalThis.__globalSearchTestDb.from(table)};` }));
  } }],
});
const engine = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { EMPTY_SEARCH_FILTERS, SEARCH_ENTITY_TYPES, getSearchTypes, hasSearchCriteria, getSearchFilterError, searchGlobalRecords } = engine;

function database(fixtures = {}, failures = {}) {
  const calls = [];
  const db = { calls, from(table) {
    const call = { table, operations: [] };
    calls.push(call);
    const query = {};
    for (const method of ['select', 'eq', 'or', 'gte', 'lte', 'order', 'limit', 'abortSignal']) {
      query[method] = (...args) => { call.operations.push({ method, args }); return query; };
    }
    query.then = (fulfilled, rejected) => {
      const failure = failures[table];
      if (failure instanceof Error) return Promise.reject(failure).then(fulfilled, rejected);
      let rows = [...(fixtures[table] || [])];
      for (const operation of call.operations) {
        const [column, value] = operation.args;
        if (operation.method === 'eq' && column === 'company_id') rows = rows.filter(row => !row.company_id || row.company_id === value);
        if (operation.method === 'eq' && !column.includes('company_id')) rows = rows.filter(row => row[column] === value);
        if (['gte', 'lte'].includes(operation.method)) rows = rows.filter(row => {
          if (row[column] === null || row[column] === undefined) return false;
          const left = typeof value === 'number' ? Number(row[column]) : String(row[column]);
          return operation.method === 'gte' ? left >= value : left <= value;
        });
      }
      const limit = call.operations.find(operation => operation.method === 'limit')?.args[0];
      if (limit !== undefined) rows = rows.slice(0, limit);
      return Promise.resolve({ data: failure ? null : rows, error: failure || null }).then(fulfilled, rejected);
    };
    return query;
  } };
  globalThis.__globalSearchTestDb = db;
  return db;
}

const search = (query = 'alpha', filters = {}, profile = owner, signal) => searchGlobalRecords({ query, filters: { ...EMPTY_SEARCH_FILTERS, ...filters }, profile, signal });
const op = (call, method, column) => call.operations.find(item => item.method === method && (column === undefined || item.args[0] === column));
const quote = (id, title = 'Alpha quote', extra = {}) => ({ id, title, quote_number: `Q-${id}`, status: 'Draft', total: '0', issue_date: '2026-10-01', created_at: '2026-10-01T00:00:00Z', is_template: false, ...extra });
const fixtures = {
  quotes: [quote('quote-one')],
  clients: [{ id: 'client-one', name: 'Alpha client', email: 'alpha@example.test' }],
  leads: [{ id: 'lead-one', contact_name: 'Alpha lead', contact_email: 'lead@example.test', pipeline_stage: 'New', value_estimate: '0' }],
  projects: [{ id: 'project-one', name: 'Alpha project', project_number: 'P-1', status: 'Planning', budget_revenue: '0', start_date: '2026-10-01', clients: { name: 'Same company client' } }],
  invoices: [{ id: 'invoice-one', invoice_number: 'Alpha invoice', status: 'Draft', total: '0', issue_date: '2026-10-01' }],
};

test('role, permissions, account activity, and meaningful criteria bound the queried records', async () => {
  const db = database(fixtures);
  for (const [profile, expected] of [
    [owner, ['Quote', 'Client', 'Lead', 'Project', 'Invoice']],
    [{ ...owner, role: 'admin' }, ['Quote', 'Client', 'Lead', 'Project', 'Invoice']],
    [{ ...owner, role: 'manager' }, ['Quote', 'Client', 'Lead', 'Project']],
    [{ ...owner, role: 'manager', permissions: ['invoices', 'clients'] }, ['Client']],
    [{ ...owner, role: 'office', permissions: ['clients', 'invoices'] }, ['Client', 'Invoice']],
    [{ ...owner, role: 'employee' }, []],
    [{ ...owner, role: 'contractor' }, []],
  ]) assert.deepEqual(getSearchTypes(profile), expected, `${profile.role}: ${profile.permissions || 'default permissions'}`);
  assert.deepEqual(
    getSearchTypes({ ...owner, role: 'office', permissions: ['clients'] }, 'professional'),
    ['Quote', 'Client', 'Lead', 'Project', 'Invoice'],
    'Plans without Advanced Permissions ignore a stale custom permission array.',
  );
  assert.deepEqual(
    getSearchTypes({ ...owner, role: 'office', permissions: [] }, 'business'),
    ['Quote', 'Client', 'Lead', 'Project', 'Invoice'],
    'An empty Business permission list retains the office default, including invoices.',
  );
  assert.equal(hasSearchCriteria(' ', EMPTY_SEARCH_FILTERS), false);
  assert.equal(hasSearchCriteria('a', EMPTY_SEARCH_FILTERS), false);
  assert.equal(hasSearchCriteria(' aa ', EMPTY_SEARCH_FILTERS), true);
  assert.equal(hasSearchCriteria('', { ...EMPTY_SEARCH_FILTERS, minAmount: '0' }), true, 'Zero is a real amount bound.');
  for (const [query, filters, profile] of [
    ['', {}, owner], ['a', {}, owner], ['alpha', {}, { ...owner, company_id: undefined }],
    ['alpha', {}, { ...owner, is_active: false }], ['alpha', {}, { ...owner, role: 'employee' }],
    ['alpha', { type: 'Invoice' }, { ...owner, role: 'manager' }],
  ]) {
    const response = await search(query, filters, profile);
    assert.deepEqual(response.results, []);
  }
  assert.equal(db.calls.length, 0, 'Empty and unauthorized scopes do not issue any database query.');
  await search('alpha', {}, { ...owner, role: 'office', permissions: ['clients'] });
  assert.deepEqual(db.calls.map(call => call.table), ['clients']);
});

test('supported status, date, and amount facets are sent to the server before result limits', async () => {
  const beforeBound = Array.from({ length: 24 }, (_, index) => quote(`early-${index}`, 'Alpha earlier', { status: 'Draft', total: '150', issue_date: '2026-09-01' }));
  const matching = quote('late-match', 'Alpha exact facets', { status: 'Approved', total: '0.00', issue_date: '2026-10-04' });
  const db = database({ quotes: [...beforeBound, matching] });
  const response = await search('', { type: 'Quote', status: 'Approved', dateFrom: '2026-10-01', dateTo: '2026-10-04', minAmount: '0', maxAmount: '0' });
  assert.deepEqual(response.results.map(item => item.id), ['late-match'], 'Qualifying rows beyond the old first twenty records remain findable.');
  const [call] = db.calls;
  assert.equal(op(call, 'eq', 'company_id').args[1], owner.company_id);
  assert.equal(op(call, 'eq', 'is_template').args[1], false);
  assert.equal(op(call, 'eq', 'status').args[1], 'Approved');
  assert.equal(op(call, 'gte', 'issue_date').args[1], '2026-10-01');
  assert.equal(op(call, 'lte', 'issue_date').args[1], '2026-10-04');
  assert.equal(op(call, 'gte', 'total').args[1], 0);
  assert.equal(op(call, 'lte', 'total').args[1], 0);
  const limitPosition = call.operations.findIndex(item => item.method === 'limit');
  for (const item of call.operations.filter(item => ['eq', 'gte', 'lte', 'or'].includes(item.method))) assert.ok(call.operations.indexOf(item) < limitPosition);
  assert.ok(op(call, 'order', 'created_at'), 'Bounded results use deterministic server ordering.');
  assert.ok(op(call, 'order', 'id'));
});

test('quote permissions cannot expose separately permissioned templates or another company records', async () => {
  const db = database({ quotes: [
    quote('template', 'Alpha template', { is_template: true }),
    quote('foreign-record', 'Alpha foreign quote', { company_id: 'other-company' }),
    quote('authorized-record', 'Alpha authorized quote', { company_id: owner.company_id }),
  ] });
  const response = await search('alpha', {}, { ...owner, role: 'office', permissions: ['quotes'] });
  assert.deepEqual(response.results.map(item => item.id), ['authorized-record']);
  assert.deepEqual(db.calls.map(call => call.table), ['quotes']);
  assert.equal(op(db.calls[0], 'eq', 'is_template').args[1], false);
  assert.equal(op(db.calls[0], 'eq', 'company_id').args[1], owner.company_id);
});

test('facets exclude incompatible record types instead of silently ignoring the criteria', async () => {
  let db = database(fixtures);
  await search('', { dateFrom: '2026-10-01' });
  assert.deepEqual(db.calls.map(call => call.table), ['quotes', 'projects', 'invoices']);
  db = database(fixtures);
  await search('', { minAmount: '0', maxAmount: '10' });
  assert.deepEqual(db.calls.map(call => call.table), ['quotes', 'leads', 'projects', 'invoices']);
  assert.equal(op(db.calls.find(call => call.table === 'leads'), 'gte', 'value_estimate').args[1], 0);
  assert.equal(op(db.calls.find(call => call.table === 'projects'), 'lte', 'budget_revenue').args[1], 10);
  assert.equal(op(db.calls.find(call => call.table === 'projects'), 'eq', 'clients.company_id').args[1], owner.company_id);
});

test('invalid ranges are explained and never issue misleading broad queries', async () => {
  const db = database(fixtures);
  for (const filters of [
    { minAmount: '20', maxAmount: '10' }, { minAmount: 'not-money' }, { maxAmount: 'Infinity' },
    { dateFrom: '2026-10-05', dateTo: '2026-10-04' }, { dateFrom: '2026-02-30' },
  ]) {
    assert.ok(getSearchFilterError({ ...EMPTY_SEARCH_FILTERS, ...filters }), JSON.stringify(filters));
    const response = await search('alpha', filters);
    assert.deepEqual(response.results, []);
  }
  assert.equal(db.calls.length, 0);
  assert.equal(getSearchFilterError({ ...EMPTY_SEARCH_FILTERS, minAmount: '0', maxAmount: '0' }), null);
});

function parseOrClauses(condition) {
  const clauses = [];
  let quoteOpen = false;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < condition.length; index++) {
    const character = condition[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\' && quoteOpen) { escaped = true; continue; }
    if (character === '"') quoteOpen = !quoteOpen;
    if (character === ',' && !quoteOpen) { clauses.push(condition.slice(start, index)); start = index + 1; }
  }
  assert.equal(quoteOpen, false, 'Every PostgREST literal closes within its own clause.');
  clauses.push(condition.slice(start));
  return clauses.map(clause => {
    const match = /^(\w+)\.(ilike|imatch)\.(".*")$/.exec(clause);
    assert.ok(match, `Expected a quoted search literal: ${clause}`);
    return { column: match[1], operation: match[2], value: JSON.parse(match[3]) };
  });
}

test('punctuation stays inside quoted PostgREST literals and LIKE wildcards are literal user input', async () => {
  const query = 'alpha,%_"\\(x),company_id.eq.foreign';
  const db = database(fixtures);
  await search(query, { type: 'Quote' });
  const clauses = parseOrClauses(op(db.calls[0], 'or').args[0]);
  assert.deepEqual(clauses.map(clause => clause.column), ['title', 'quote_number']);
  for (const clause of clauses) {
    assert.equal(clause.operation, 'ilike');
    assert.ok(clause.value.startsWith('%') && clause.value.endsWith('%'));
    assert.equal(clause.value.slice(1, -1), query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_'));
  }
  assert.equal(op(db.calls[0], 'eq', 'company_id').args[1], owner.company_id, 'Injected-looking punctuation cannot change company scope.');
  const starDb = database(fixtures);
  await search('alpha*.(x)', { type: 'Quote' });
  const starClauses = parseOrClauses(op(starDb.calls[0], 'or').args[0]);
  for (const clause of starClauses) {
    assert.equal(clause.operation, 'imatch', 'PostgREST treats stars as LIKE wildcards, so literal stars use an escaped regular expression.');
    assert.match(clause.value, /\\\*/);
    assert.match(clause.value, /\\\./);
    assert.match(clause.value, /\\\(/);
  }
});

test('numeric database strings format reliably and every result points at a registered encoded route', async () => {
  const id = 'record / with ? & #';
  const db = database({ ...fixtures, quotes: [quote(id, 'Alpha zero'), quote('currency', 'Alpha amount', { total: '1234.50' })] });
  const response = await search();
  assert.equal(response.errors.length, 0);
  const zero = response.results.find(item => item.id === id);
  assert.ok(zero.subtitle.includes('$0.00'));
  const numeric = response.results.find(item => item.id === 'currency');
  assert.match(numeric.subtitle, /\$1,?234\.50/);
  const app = await fs.readFile(local('../../src/App.jsx'), 'utf8');
  const config = await fs.readFile(local('../../src/pages.config.js'), 'utf8');
  for (const item of response.results) {
    assert.equal(item.url, `${item.page}?id=${encodeURIComponent(item.id)}`);
    assert.ok(new RegExp(`<Route path="${item.page}"`).test(app)
      || new RegExp(`"${item.page.slice(1)}":`).test(config), `${item.type} navigates to an explicit or configured app route.`);
  }
  assert.equal(db.calls.length, 5);
});

test('bounded ranking fairly includes each record type and keeps the most relevant match within each group', async () => {
  const records = Object.fromEntries(Object.entries(fixtures).map(([table, rows]) => [table, Array.from({ length: 9 }, (_, index) => {
    const row = { ...rows[0], id: `${table}-${index}`, created_at: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z` };
    const field = table === 'quotes' ? 'title' : table === 'leads' ? 'contact_name' : table === 'invoices' ? 'invoice_number' : 'name';
    row[field] = index === 7 ? 'Alpha' : `Alpha ${index}`;
    return row;
  })]));
  const db = database(records);
  const response = await search('Alpha');
  assert.equal(response.results.length, 40);
  assert.equal(response.hasMore, true, 'A sentinel record explains that narrowing criteria may expose more matches.');
  for (const { name } of SEARCH_ENTITY_TYPES) assert.equal(response.results.filter(item => item.type === name).length, 8, `${name} is not starved by earlier record types.`);
  assert.equal(new Set(response.results.slice(0, 5).map(item => item.type)).size, 5);
  for (const { name } of SEARCH_ENTITY_TYPES) assert.equal(response.results.find(item => item.type === name).title, 'Alpha');
  assert.ok(db.calls.every(call => op(call, 'limit').args[0] === 9));
  const again = await search('Alpha');
  assert.deepEqual(again.results.map(item => `${item.type}:${item.id}`), response.results.map(item => `${item.type}:${item.id}`));
});

test('narrowing to one permitted type uses the full bounded result capacity', async () => {
  const rows = Array.from({ length: 48 }, (_, index) => quote(`quote-${index}`, `Alpha ${index}`));
  const db = database({ quotes: rows });
  const response = await search('alpha', { type: 'Quote' });
  assert.equal(response.results.length, 40, 'A narrowed search can show more than eight records without unbounded fetching.');
  assert.equal(response.hasMore, true);
  assert.equal(op(db.calls[0], 'limit').args[0], 41);
  const onePermissionDb = database({ clients: Array.from({ length: 48 }, (_, index) => ({ id: `client-${index}`, name: `Alpha ${index}` })) });
  const restricted = await search('alpha', {}, { ...owner, role: 'office', permissions: ['clients'] });
  assert.equal(restricted.results.length, 40, 'A single permitted entity receives the same useful capacity.');
  assert.deepEqual(onePermissionDb.calls.map(call => call.table), ['clients']);
  assert.equal(op(onePermissionDb.calls[0], 'limit').args[0], 41);
});

test('failed tables produce visible safe partial errors while other matches survive', async () => {
  database(fixtures, {
    quotes: { message: 'Database connection error contains secret internal SQL', code: 'XX000' },
    clients: new Error('Network failed with internal credentials'),
  });
  const response = await search();
  assert.deepEqual(new Set(response.results.map(item => item.type)), new Set(['Lead', 'Project', 'Invoice']));
  assert.deepEqual(new Set(response.errors.map(item => item.type)), new Set(['Quote', 'Client']));
  for (const error of response.errors) {
    assert.ok(error.message.length > 0);
    assert.doesNotMatch(error.message, /secret|SQL|credentials|XX000/);
  }
  assert.equal(response.hasMore, false);
});

test('the cancellation signal reaches every server query and an already cancelled search never runs', async () => {
  let db = database(fixtures);
  const controller = new AbortController();
  await search('alpha', {}, owner, controller.signal);
  for (const call of db.calls) assert.equal(op(call, 'abortSignal').args[0], controller.signal);
  db = database(fixtures);
  controller.abort();
  await assert.rejects(() => search('alpha', {}, owner, controller.signal), error => error.name === 'AbortError');
  assert.equal(db.calls.length, 0);
});
