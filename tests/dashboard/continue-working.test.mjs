import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { getDocumentContactName } from '../../src/lib/documentContact.js';

const clients = [
  { id: 'client-one', name: 'Acme Renovations' },
  { id: 'client-two', first_name: 'Alex', surname: 'Homeowner' },
  { id: 'client-three', primary_contact_name: 'Primary Contact' },
];
const leads = [{ id: 'lead-one', contact_name: 'Jamie Lead' }];

test('resume documents resolve client names with the normal fallbacks', () => {
  assert.equal(getDocumentContactName({ client_id: 'client-one' }, clients, leads), 'Acme Renovations');
  assert.equal(getDocumentContactName({ client_id: 'client-two' }, clients, leads), 'Alex Homeowner');
  assert.equal(getDocumentContactName({ client_id: 'client-three' }, clients, leads), 'Primary Contact');
});

test('lead-linked quotes display the lead instead of Unknown Client', () => {
  assert.equal(getDocumentContactName({ client_id: null, lead_id: 'lead-one' }, clients, leads), 'Jamie Lead');
  assert.equal(getDocumentContactName({ client_id: 'missing', lead_id: 'lead-one' }, clients, leads), 'Jamie Lead');
});

test('resume documents distinguish missing links from stale references', () => {
  assert.equal(getDocumentContactName({}, clients, leads), 'No client or lead linked');
  assert.equal(getDocumentContactName({ client_id: 'missing' }, clients, leads), 'Unknown Client');
  assert.equal(getDocumentContactName({ lead_id: 'missing' }, clients, leads), 'Unknown Lead');
});

test('dashboard passes tenant-scoped leads into Resume Quotes', async () => {
  const dashboard = await fs.readFile(new URL('../../src/pages/Dashboard.jsx', import.meta.url), 'utf8');
  const continueWorking = await fs.readFile(new URL('../../src/components/dashboard/ContinueWorking.jsx', import.meta.url), 'utf8');

  assert.match(dashboard, /<ContinueWorking quotes=\{activeQuotes\} invoices=\{invoices\} clients=\{clients\} leads=\{leads\} \/>/);
  assert.match(continueWorking, /getDocumentContactName\(quote, clients, leads\)/);
  assert.match(continueWorking, /getDocumentContactName\(invoice, clients, leads\)/);
});
