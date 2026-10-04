import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';

// Execute the actual Edge Function with synthetic authentication, database,
// and provider adapters. The fixture cannot make any network requests.
const source = await fs.readFile(fileURLToPath(new URL('../../supabase/functions/send-email/index.ts', import.meta.url)), 'utf8');
const javascript = (await transform(source.replace(/^import .*\n/gm, ''), {loader: 'ts', format: 'iife'})).code;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const COMPANY = uuid(1);
const OTHER_COMPANY = uuid(2);
const USER = uuid(3);
const CLIENT = uuid(4);
const DOCUMENT = uuid(5);
const REQUEST = uuid(6);
const PROJECT = uuid(8);
const LEAD = uuid(9);
const COMPANY_EMAIL = 'office@example.invalid';
const CLIENT_EMAIL = 'customer@example.invalid';
const SERVICE_KEY = 'synthetic-service-role-key';
const clone = value => JSON.parse(JSON.stringify(value));
const recipients = value => Array.isArray(value) ? value : [value];
const documentTypes = {
  quote: {table: 'quotes', field: 'quote_number', number: 'Q-1001', label: 'Quote'},
  change_order: {table: 'change_orders', field: 'change_order_number', number: 'CO-1001', label: 'Change Order'},
  invoice: {table: 'invoices', field: 'invoice_number', number: 'INV-1001', label: 'Invoice'},
};

function requestBody(overrides = {}) {
  return {
    to_email: CLIENT_EMAIL,
    subject: 'An edited client email subject',
    html_body: '<p>Hi Jane, please review your document.</p><a href="https://app.example.invalid/document">View document</a>',
    reply_to: ['reply@example.invalid'],
    attachments: [{filename: 'Invoice.pdf', content: 'U3ludGhldGljIFBERg=='}],
    attachment_url: 'https://files.example.invalid/legacy.pdf',
    company_id: COMPANY,
    client_id: CLIENT,
    send_copy_to_company: true,
    document_type: 'invoice',
    document_id: DOCUMENT,
    request_id: REQUEST,
    ...overrides,
  };
}

function edgeFixture(options = {}) {
  const observed = {clients: [], tokens: [], queries: [], writes: [], providerAttempts: [], delivered: []};
  const profile = options.profile === undefined ? {id: USER, company_id: COMPANY, role: 'owner', is_active: true} : options.profile;
  const company = options.company === undefined ? {id: COMPANY, name: 'LBProjects', settings: {email: COMPANY_EMAIL}} : options.company;
  const client = options.client === undefined ? {id: CLIENT, company_id: COMPANY, name: 'Jane Smith', email: CLIENT_EMAIL} : options.client;
  const projects = options.projects === undefined ? [{id: PROJECT, company_id: COMPANY, client_id: CLIENT}] : options.projects;
  const leads = options.leads === undefined ? [{id: LEAD, company_id: COMPANY, contact_name: 'Jane Smith'}] : options.leads;
  const documents = options.documents === undefined ? Object.entries(documentTypes).reduce((records, [type, info]) => {
    records[info.table] = [{id: DOCUMENT, company_id: COMPANY, client_id: CLIENT, ...(type === 'change_order' ? {project_id: PROJECT} : {}), [info.field]: info.number}];
    return records;
  }, {}) : options.documents;
  const communications = new Map();
  const providerCache = new Map();
  let primaryAttempts = 0;
  let copyAttempts = 0;
  let handler;

  const tableRows = table => {
    if (table === 'profiles') return profile ? [profile] : [];
    if (table === 'companies') return company ? [company] : [];
    if (table === 'clients') return options.noClient || !client ? [] : [client];
    if (table === 'projects') return projects;
    if (table === 'leads') return leads;
    if (table === 'client_communications') return [...communications.values()];
    return documents[table] || [];
  };

  class Query {
    constructor(table, key) {
      this.table = table;
      this.key = key;
      this.filters = [];
      this.mode = 'select';
      observed.queries.push(this);
    }
    select(columns) {this.columns = columns; return this;}
    eq(field, value) {this.filters.push({field, value}); return this;}
    in(field, values) {this.filters.push({field, values}); return this;}
    limit() {return this;}
    order() {return this;}
    insert(payload) {this.mode = 'insert'; this.payload = clone(payload); return this;}
    upsert(payload, settings) {this.mode = 'upsert'; this.payload = clone(payload); this.settings = clone(settings || {}); return this;}
    single() {return this.execute(true);}
    maybeSingle() {return this.execute(true);}
    then(resolve, reject) {return this.execute(false).then(resolve, reject);}
    execute(single) {
      if (this.result) return this.result;
      this.result = Promise.resolve().then(() => {
        if (options.databaseThrows?.[this.table]) throw new Error(options.databaseThrows[this.table]);
        const error = options.databaseErrors?.[this.table];
        if (error) return {data: null, error: {message: error}};
        if (this.mode !== 'select') {
          observed.writes.push({table: this.table, key: this.key, mode: this.mode, payload: this.payload, settings: this.settings});
          if (this.table === 'client_communications') {
            for (const record of Array.isArray(this.payload) ? this.payload : [this.payload]) {
              const identifier = record.id || `generated-${communications.size}`;
              if (communications.has(identifier)) {
                if (this.mode === 'upsert' && this.settings.ignoreDuplicates) continue;
                return {data: null, error: {message: 'duplicate key value violates unique constraint', code: '23505'}};
              }
              communications.set(identifier, record);
            }
          }
          return {data: this.payload, error: null};
        }
        const rows = tableRows(this.table).filter(row => this.filters.every(filter => filter.values ? filter.values.includes(row[filter.field]) : row[filter.field] === filter.value));
        return {data: single ? (rows[0] || null) : rows, error: null};
      });
      return this.result;
    }
  }

  const createClient = (...args) => {
    observed.clients.push(args);
    return {
      auth: {getUser: async token => {
        observed.tokens.push(token);
        return {data: {user: options.invalidUser ? null : {id: USER}}, error: options.invalidUser ? {message: 'Invalid synthetic token'} : null};
      }},
      from: table => new Query(table, args[1]),
    };
  };

  const fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.resend.com/emails', 'Only the mocked email provider can be called.');
    assert.equal(init.method, 'POST');
    const payload = JSON.parse(init.body);
    const headers = new Headers(init.headers);
    const key = headers.get('Idempotency-Key');
    const isCopy = key?.endsWith('/copy') || payload.subject?.startsWith('[COPY]');
    const attempt = {payload, key, headers: Object.fromEntries(headers), isCopy};
    observed.providerAttempts.push(attempt);
    if (key && providerCache.has(key)) {
      const previous = providerCache.get(key);
      if (JSON.stringify(previous.payload) !== JSON.stringify(payload)) {
        return new Response(JSON.stringify({name: 'invalid_idempotent_request', message: 'The same key was used with a different payload.'}), {status: 409});
      }
      return new Response(JSON.stringify(previous.result), {status: 200});
    }
    const count = isCopy ? ++copyAttempts : ++primaryAttempts;
    const failure = isCopy ? options.copyFailure : options.primaryFailure;
    const failureCount = isCopy ? (options.copyFailureCount ?? Infinity) : (options.primaryFailureCount ?? Infinity);
    if (failure && count <= failureCount) {
      if (failure === 'throw') throw new Error('Synthetic provider network failure');
      return new Response(JSON.stringify({message: 'Synthetic provider rejection'}), {status: 503});
    }
    const result = options.providerResponses?.[isCopy ? 'copy' : 'original'] || {id: uuid(100 + observed.delivered.length)};
    observed.delivered.push({...attempt, result});
    if (key) providerCache.set(key, {payload, result});
    return new Response(JSON.stringify(result), {status: 200});
  };

  const env = {
    SUPABASE_URL: 'https://project.example.invalid',
    SUPABASE_ANON_KEY: 'synthetic-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    RESEND_API_KEY: 'synthetic-resend-key',
  };
  const context = vm.createContext({
    serve: callback => {handler = callback;}, createClient, fetch,
    Deno: {env: {get: name => env[name]}, serve: callback => {handler = callback;}},
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    crypto: webcrypto, structuredClone,
    console: {log() {}, warn() {}, error() {}},
  });
  new vm.Script(javascript, {filename: 'send-email.fixture.js'}).runInContext(context);
  assert.equal(typeof handler, 'function', 'The actual Edge Function registered its request handler.');
  const request = async (body = requestBody(), {authorization = 'Bearer synthetic-user-token', method = 'POST'} = {}) => {
    const headers = {'Content-Type': 'application/json', ...(authorization ? {Authorization: authorization} : {})};
    const response = await handler(new Request('https://edge.example.invalid/send-email', {method, headers, ...(method === 'POST' ? {body: JSON.stringify(body)} : {})}));
    const text = await response.text();
    return {response, body: text === 'ok' ? text : JSON.parse(text)};
  };
  return {request, observed, communications};
}

function assertScopedKey(key, phase, company = COMPANY, request = REQUEST) {
  assert.equal(key, `fuzedflow/${company}/${request}/${phase}`, 'Provider keys distinguish the authenticated company, send request, and original/copy phase.');
}

test('CORS preflight performs no authentication, database reads, or email send', async () => {
  const fixture = edgeFixture();
  const {response} = await fixture.request(null, {method: 'OPTIONS', authorization: null});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(fixture.observed.clients.length, 0);
  assert.equal(fixture.observed.providerAttempts.length, 0);
});

test('an unchecked copy option sends and logs only the original client email', async () => {
  const fixture = edgeFixture();
  const payload = requestBody({send_copy_to_company: false});
  const {response, body} = await fixture.request(payload);
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.copy_status, 'not_requested');
  assert.equal(fixture.observed.providerAttempts.length, 1);
  assert.deepEqual(recipients(fixture.observed.delivered[0].payload.to), [CLIENT_EMAIL]);
  assert.equal(fixture.observed.delivered[0].payload.subject, payload.subject);
  assert.equal(fixture.communications.size, 1);
  assert.equal([...fixture.communications.values()][0].subject, payload.subject);
  assert.ok(!fixture.observed.queries.some(query => ['quotes', 'change_orders', 'invoices'].includes(query.table)), 'Ordinary email does not require document-copy metadata.');
});

test('company copies require an explicit boolean opt-in and ordinary sends do not require copy setup', async t => {
  for (const value of [undefined, false, null, 'false', 'true', 1]) {
    await t.test(String(value), async () => {
      const fixture = edgeFixture({company: {id: COMPANY, name: 'LBProjects', settings: {}}});
      const {response, body} = await fixture.request(requestBody({send_copy_to_company: value, document_type: undefined, document_id: undefined, request_id: undefined}));
      assert.equal(response.status, 200);
      assert.equal(body.success, true);
      assert.equal(body.copy_status, 'not_requested');
      assert.equal(fixture.observed.delivered.length, 1);
      assert.equal(fixture.observed.delivered[0].isCopy, false);
    });
  }
});

for (const [type, info] of Object.entries(documentTypes)) {
  test(`${info.label} copy uses saved company/client/document metadata and preserves the original content`, async () => {
    const fixture = edgeFixture();
    const payload = requestBody({document_type: type, company_id: OTHER_COMPANY, client_id: uuid(999), company_name: 'Untrusted Company', client_name: 'Untrusted Customer', document_number: 'SPOOFED', copy_to_email: 'attacker@example.invalid'});
    const {response, body} = await fixture.request(payload);
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.copy_status, 'sent');
    assert.equal(fixture.observed.delivered.length, 2);
    const [original, copy] = fixture.observed.delivered;
    assert.deepEqual(recipients(original.payload.to), [CLIENT_EMAIL]);
    assert.deepEqual(recipients(copy.payload.to), [COMPANY_EMAIL]);
    assert.equal(original.payload.subject, payload.subject);
    assert.equal(copy.payload.subject, `[COPY] ${info.label} from LBProjects - ${info.label} #${info.number} for Jane Smith`);
    assert.equal(copy.payload.html, original.payload.html);
    assert.equal(original.payload.html, payload.html_body);
    assert.deepEqual(copy.payload.attachments, original.payload.attachments);
    assert.deepEqual(copy.payload.reply_to, original.payload.reply_to);
    assert.deepEqual(original.payload.reply_to, payload.reply_to);
    assert.equal(copy.payload.from, original.payload.from);
    assert.deepEqual(original.payload.attachments, [{filename: 'Document.pdf', path: payload.attachment_url}, ...payload.attachments]);
    assertScopedKey(original.key, 'original');
    assertScopedKey(copy.key, 'copy');
    const documentRead = fixture.observed.queries.find(query => query.table === info.table);
    assert.ok(documentRead, 'The saved document is read.');
    assert.ok(fixture.observed.clients.some(args => args[1] === documentRead.key && args[2]?.global?.headers?.Authorization === 'Bearer synthetic-user-token'), 'Metadata lookup retains the authenticated user context.');
    assert.ok(documentRead.filters.some(filter => filter.field === 'id' && filter.value === DOCUMENT));
    assert.ok(documentRead.filters.some(filter => filter.field === 'company_id' && filter.value === COMPANY), 'The document lookup explicitly restricts the authenticated company.');
    const clientRead = fixture.observed.queries.find(query => query.table === 'clients');
    assert.ok(clientRead.filters.some(filter => filter.field === 'id' && filter.value === CLIENT));
    assert.ok(clientRead.filters.some(filter => filter.field === 'company_id' && filter.value === COMPANY), 'Related client lookup explicitly restricts the authenticated company.');
    const companyRead = fixture.observed.queries.find(query => query.table === 'companies');
    assert.ok(companyRead.filters.some(filter => filter.field === 'id' && filter.value === COMPANY));
    if (type === 'change_order') {
      const projectRead = fixture.observed.queries.find(query => query.table === 'projects');
      assert.ok(projectRead.filters.some(filter => filter.field === 'id' && filter.value === PROJECT));
      assert.ok(projectRead.filters.some(filter => filter.field === 'company_id' && filter.value === COMPANY));
    }
    assert.equal(fixture.communications.size, 1, 'The company copy is not logged as client outreach.');
    const record = [...fixture.communications.values()][0];
    assert.equal(record.id, original.result.id, 'Only the trusted provider ID identifies the communication.');
    assert.equal(record.company_id, COMPANY);
    assert.equal(record.client_id, CLIENT);
    assert.equal(record.sent_by, USER);
    assert.equal(record.subject, payload.subject);
    const log = fixture.observed.writes.find(write => write.table === 'client_communications');
    assert.equal(log.mode, 'upsert');
    assert.equal(log.settings.ignoreDuplicates, true);
  });
}

test('lead-linked quotes use the saved lead contact and a company-scoped lookup', async () => {
  const fixture = edgeFixture({documents: {quotes: [{id: DOCUMENT, company_id: COMPANY, client_id: null, lead_id: LEAD, quote_number: 'Q-1001'}]}});
  const {response, body} = await fixture.request(requestBody({document_type: 'quote'}));
  assert.equal(response.status, 200);
  assert.equal(body.copy_status, 'sent');
  assert.equal(fixture.observed.delivered[1].payload.subject, '[COPY] Quote from LBProjects - Quote #Q-1001 for Jane Smith');
  const read = fixture.observed.queries.find(query => query.table === 'leads');
  assert.ok(read.filters.some(filter => filter.field === 'id' && filter.value === LEAD));
  assert.ok(read.filters.some(filter => filter.field === 'company_id' && filter.value === COMPANY));
  assert.equal([...fixture.communications.values()][0].client_id, null, 'A lead-only quote is not logged against a body-supplied client.');
});

test('a change order resolves its project client before its direct client and retains direct-client fallback', async t => {
  const scenarios = [
    {name: 'project client takes priority', directClient: uuid(999), projectClient: CLIENT},
    {name: 'direct client when project has no client', directClient: CLIENT, projectClient: null},
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const fixture = edgeFixture({
        documents: {change_orders: [{id: DOCUMENT, company_id: COMPANY, project_id: PROJECT, client_id: scenario.directClient, change_order_number: 'CO-1001'}]},
        projects: [{id: PROJECT, company_id: COMPANY, client_id: scenario.projectClient}],
      });
      const {response, body} = await fixture.request(requestBody({document_type: 'change_order'}));
      assert.equal(response.status, 200);
      assert.equal(body.copy_status, 'sent');
      assert.equal(fixture.observed.delivered[1].payload.subject, '[COPY] Change Order from LBProjects - Change Order #CO-1001 for Jane Smith');
      assert.equal([...fixture.communications.values()][0].client_id, CLIENT);
      const read = fixture.observed.queries.find(query => query.table === 'clients');
      assert.ok(read.filters.some(filter => filter.field === 'id' && filter.value === CLIENT));
      assert.ok(read.filters.some(filter => filter.field === 'company_id' && filter.value === COMPANY));
    });
  }
});

test('generated copy subject sanitizes saved metadata and does not duplicate the document-number prefix', async () => {
  const fixture = edgeFixture({
    company: {id: COMPANY, name: '  LBProjects\r\nCalgary  ', settings: {email: ' office+copies@example.invalid '}},
    client: {id: CLIENT, company_id: COMPANY, name: ' Jane\r\nSmith  '},
    documents: {invoices: [{id: DOCUMENT, company_id: COMPANY, client_id: CLIENT, invoice_number: ' ## INV-1001\r\nRevised '}]},
  });
  const {response, body} = await fixture.request();
  assert.equal(response.status, 200);
  assert.equal(body.copy_status, 'sent');
  const copy = fixture.observed.delivered[1].payload;
  assert.deepEqual(recipients(copy.to), ['office+copies@example.invalid']);
  assert.equal(copy.subject, '[COPY] Invoice from LBProjects Calgary - Invoice #INV-1001 Revised for Jane Smith');
  assert.doesNotMatch(copy.subject, /[\r\n]/);
});

test('invalid company inbox and invalid document-copy context fail before the original is sent', async t => {
  const cases = [
    {name: 'missing company contact', options: {company: {id: COMPANY, name: 'LBProjects', settings: {}}}},
    {name: 'malformed company contact', options: {company: {id: COMPANY, name: 'LBProjects', settings: {email: 'not-an-email'}}}},
    {name: 'multiple company destinations', options: {company: {id: COMPANY, name: 'LBProjects', settings: {email: `${COMPANY_EMAIL},attacker@example.invalid`}}}},
    ...[
      ['mailto company contact', 'mailto:office@example.invalid'],
      ['company contact with path', 'office@example.invalid/path'],
      ['leading local dot', '.office@example.invalid'],
      ['trailing local dot', 'office.@example.invalid'],
      ['consecutive local dots', 'off..ice@example.invalid'],
      ['company contact with injected header', `${COMPANY_EMAIL}\r\nBcc:attacker@example.invalid`],
      ['oversized local part', 'a'.repeat(65) + '@example.invalid'],
    ].map(([name, email]) => ({name, options: {company: {id: COMPANY, name: 'LBProjects', settings: {email}}}})),
    {name: 'missing company', options: {company: null}},
    {name: 'missing company name', options: {company: {id: COMPANY, name: ' ', settings: {email: COMPANY_EMAIL}}}},
    {name: 'company query failed', options: {databaseErrors: {companies: 'Synthetic company lookup failure'}}},
    {name: 'missing document ID', body: {document_id: undefined}},
    {name: 'malformed document ID', body: {document_id: 'not-a-uuid'}},
    {name: 'unsupported document type', body: {document_type: 'purchase_order'}},
    {name: 'missing request ID', body: {request_id: undefined}},
    {name: 'malformed request ID', body: {request_id: 'not-a-uuid'}},
    {name: 'document not saved', options: {documents: {invoices: []}}},
    {name: 'document belongs to another company', options: {documents: {invoices: [{id: DOCUMENT, company_id: OTHER_COMPANY, client_id: CLIENT, invoice_number: 'PRIVATE-1001'}]}}},
    {name: 'document query failed', options: {databaseErrors: {invoices: 'Synthetic document lookup failure'}}},
    {name: 'missing saved document number', options: {documents: {invoices: [{id: DOCUMENT, company_id: COMPANY, client_id: CLIENT, invoice_number: ''}]}}},
    {name: 'missing related client', options: {noClient: true}},
    {name: 'related client belongs to another company', options: {client: {id: CLIENT, company_id: OTHER_COMPANY, name: 'Other Company Customer'}}},
    {name: 'missing client name', options: {client: {id: CLIENT, company_id: COMPANY, name: ' '}}},
    {name: 'client query failed', options: {databaseErrors: {clients: 'Synthetic client lookup failure'}}},
    {name: 'missing quote lead', body: {document_type: 'quote'}, options: {documents: {quotes: [{id: DOCUMENT, company_id: COMPANY, lead_id: LEAD, quote_number: 'Q-1001'}]}, leads: []}},
    {name: 'quote lead belongs to another company', body: {document_type: 'quote'}, options: {documents: {quotes: [{id: DOCUMENT, company_id: COMPANY, lead_id: LEAD, quote_number: 'Q-1001'}]}, leads: [{id: LEAD, company_id: OTHER_COMPANY, contact_name: 'Other Company Lead'}]}},
    {name: 'lead query failed', body: {document_type: 'quote'}, options: {documents: {quotes: [{id: DOCUMENT, company_id: COMPANY, lead_id: LEAD, quote_number: 'Q-1001'}]}, databaseErrors: {leads: 'Synthetic lead lookup failure'}}},
    {name: 'missing change-order project', body: {document_type: 'change_order'}, options: {projects: []}},
    {name: 'change-order project belongs to another company', body: {document_type: 'change_order'}, options: {projects: [{id: PROJECT, company_id: OTHER_COMPANY, client_id: CLIENT}]}},
    {name: 'project query failed', body: {document_type: 'change_order'}, options: {databaseErrors: {projects: 'Synthetic project lookup failure'}}},
  ];
  for (const example of cases) {
    await t.test(example.name, async () => {
      const fixture = edgeFixture(example.options);
      const {response, body} = await fixture.request(requestBody(example.body));
      assert.ok(response.status >= 400, 'Invalid copy preconditions produce a request error.');
      assert.notEqual(body.success, true);
      assert.equal(fixture.observed.providerAttempts.length, 0, 'The customer email must not be sent before copy validation passes.');
      assert.equal(fixture.communications.size, 0);
    });
  }
});

test('missing or invalid human authentication and inactive/unassigned profiles cannot send emails', async t => {
  const cases = [
    {name: 'missing authorization', request: {authorization: null}},
    {name: 'invalid token', options: {invalidUser: true}},
    {name: 'missing profile', options: {profile: null}},
    {name: 'inactive profile', options: {profile: {id: USER, company_id: COMPANY, role: 'owner', is_active: false}}},
    {name: 'unassigned profile', options: {profile: {id: USER, company_id: null, role: 'owner', is_active: true}}},
    {name: 'profile query failed', options: {databaseErrors: {profiles: 'Synthetic profile lookup failure'}}},
  ];
  for (const example of cases) {
    await t.test(example.name, async () => {
      const fixture = edgeFixture(example.options);
      const {response} = await fixture.request(requestBody(), example.request);
      assert.ok(response.status >= 400);
      assert.equal(fixture.observed.providerAttempts.length, 0);
      assert.equal(fixture.communications.size, 0);
    });
  }
});

for (const failure of ['reject', 'throw']) {
  test(`a primary provider ${failure} prevents the company copy and communication log`, async () => {
    const fixture = edgeFixture({primaryFailure: failure});
    const {response, body} = await fixture.request();
    assert.ok(response.status >= 400);
    assert.notEqual(body.success, true);
    assert.equal(fixture.observed.providerAttempts.length, 1);
    assert.equal(fixture.observed.providerAttempts[0].isCopy, false);
    assert.equal(fixture.communications.size, 0);
  });
}

for (const failure of ['reject', 'throw']) {
  test(`a company-copy ${failure} reports original success and retry cannot duplicate the original email or outreach`, async () => {
    const fixture = edgeFixture({copyFailure: failure, copyFailureCount: 1});
    const payload = requestBody();
    const first = await fixture.request(payload);
    assert.equal(first.response.status, 200);
    assert.equal(first.body.success, true);
    assert.equal(first.body.copy_status, 'failed');
    assert.equal(fixture.observed.delivered.length, 1);
    assert.equal(fixture.communications.size, 1);
    const retry = await fixture.request(payload);
    assert.equal(retry.response.status, 200);
    assert.equal(retry.body.success, true);
    assert.equal(retry.body.copy_status, 'sent');
    assert.equal(fixture.observed.delivered.filter(delivery => !delivery.isCopy).length, 1, 'The provider deduplicates the original with the same scoped key.');
    assert.equal(fixture.observed.delivered.filter(delivery => delivery.isCopy).length, 1);
    assert.equal(fixture.communications.size, 1, 'Retried original outreach retains one trusted provider ID.');
    assert.equal(first.body.resend_id, retry.body.resend_id);
    const originalKeys = fixture.observed.providerAttempts.filter(attempt => !attempt.isCopy).map(attempt => attempt.key);
    const copyKeys = fixture.observed.providerAttempts.filter(attempt => attempt.isCopy).map(attempt => attempt.key);
    assert.ok(originalKeys.every(key => key === originalKeys[0]));
    assert.ok(copyKeys.every(key => key === copyKeys[0]));
    assertScopedKey(originalKeys[0], 'original');
    assertScopedKey(copyKeys[0], 'copy');
  });
}

test('retrying a completed send does not duplicate either delivery or client communication', async () => {
  const fixture = edgeFixture();
  const payload = requestBody();
  const first = await fixture.request(payload);
  const retry = await fixture.request(payload);
  assert.equal(first.response.status, 200);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.copy_status, 'sent');
  assert.equal(fixture.observed.delivered.length, 2);
  assert.equal(fixture.communications.size, 1);
});

test('reusing a send request for changed content cannot deliver an extra original email', async () => {
  const fixture = edgeFixture();
  const payload = requestBody();
  assert.equal((await fixture.request(payload)).response.status, 200);
  const changed = await fixture.request({...payload, subject: 'A different email under the same request identifier'});
  assert.ok(changed.response.status >= 400);
  assert.notEqual(changed.body.success, true);
  assert.equal(fixture.observed.delivered.length, 2, 'Changed-payload replay creates neither another original nor another copy.');
  assert.equal(fixture.communications.size, 1);
});

test('unconfirmed primary provider IDs cannot become trusted communication IDs or trigger a copy', async t => {
  for (const result of [{}, {id: ''}, {id: 'not-a-uuid'}]) {
    await t.test(JSON.stringify(result), async () => {
      const fixture = edgeFixture({providerResponses: {original: result}});
      const {response, body} = await fixture.request();
      assert.ok(response.status >= 400);
      assert.notEqual(body.success, true);
      assert.equal(fixture.observed.providerAttempts.length, 1);
      assert.equal(fixture.communications.size, 0);
      assert.equal(fixture.observed.writes.length, 0);
    });
  }
});

test('an unconfirmed company-copy provider ID preserves original success and reports a safe partial outcome', async t => {
  for (const result of [{}, {id: 'not-a-uuid'}]) {
    await t.test(JSON.stringify(result), async () => {
      const fixture = edgeFixture({providerResponses: {copy: result}});
      const {response, body} = await fixture.request();
      assert.equal(response.status, 200);
      assert.equal(body.success, true);
      assert.equal(body.copy_status, 'failed');
      assert.ok(body.copy_error);
      assert.doesNotMatch(body.copy_error, /not-a-uuid|Synthetic|Error:|stack/i);
      assert.equal(fixture.communications.size, 1);
      assert.equal([...fixture.communications.values()][0].id, fixture.observed.delivered[0].result.id);
    });
  }
});

test('communication-history database errors never turn an accepted email into a send failure', async t => {
  for (const failure of ['databaseErrors', 'databaseThrows']) {
    for (const sendCopy of [false, true]) {
      await t.test(`${failure}, copy=${sendCopy}`, async () => {
        const fixture = edgeFixture({[failure]: {client_communications: 'Sensitive synthetic logging diagnostic'}});
        const payload = requestBody({send_copy_to_company: sendCopy});
        const first = await fixture.request(payload);
        assert.equal(first.response.status, 200);
        assert.equal(first.body.success, true);
        assert.equal(first.body.copy_status, sendCopy ? 'sent' : 'not_requested');
        assert.equal(fixture.communications.size, 0);
        assert.doesNotMatch(JSON.stringify(first.body), /Sensitive synthetic logging diagnostic/);
        const retry = await fixture.request(payload);
        assert.equal(retry.response.status, 200);
        assert.equal(retry.body.success, true);
        assert.equal(fixture.observed.delivered.length, sendCopy ? 2 : 1, 'Logging retry does not duplicate provider delivery.');
      });
    }
  }
});

test('different send request identifiers remain independent for an intentional later email', async () => {
  const fixture = edgeFixture();
  assert.equal((await fixture.request(requestBody())).response.status, 200);
  assert.equal((await fixture.request(requestBody({request_id: uuid(7)}))).response.status, 200);
  assert.equal(fixture.observed.delivered.filter(delivery => !delivery.isCopy).length, 2);
  assert.equal(fixture.observed.delivered.filter(delivery => delivery.isCopy).length, 2);
  assert.equal(fixture.communications.size, 2);
});

test('existing service-authorized generic cron emails work without document-copy fields', async () => {
  const fixture = edgeFixture();
  const payload = {to_email: CLIENT_EMAIL, subject: 'Synthetic scheduled reminder', html_body: '<p>Scheduled reminder.</p>', client_id: CLIENT, company_id: COMPANY};
  const {response, body} = await fixture.request(payload, {authorization: 'Bearer ' + SERVICE_KEY});
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.copy_status, 'not_requested');
  assert.equal(fixture.observed.tokens.length, 0, 'Trusted service requests do not require a human user.');
  assert.equal(fixture.observed.delivered.length, 1);
  assert.equal(fixture.observed.delivered[0].payload.subject, payload.subject);
  assert.equal(fixture.communications.size, 1);
  assert.equal([...fixture.communications.values()][0].sent_by, null);
});
