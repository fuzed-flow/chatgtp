import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const contact = await fs.readFile(new URL('../../src/pages/Contact.jsx', import.meta.url), 'utf8');
const threads = await fs.readFile(new URL('../../src/components/help/SupportThreads.jsx', import.meta.url), 'utf8');
const migration = await fs.readFile(new URL('../../supabase/migrations/20261008012313_support_request_deletion_and_email_routing.sql', import.meta.url), 'utf8');

test('contact support shows the public phone number without exposing an email address', () => {
  assert.match(contact, /1 \(855\) 904-5509/);
  assert.match(contact, /tel:\+18559045509/);
  assert.doesNotMatch(contact, /support@fuzedflow\.com|fuzedflow@gmail\.com|mailto:/i);
});

test('the direct support form sends through the protected enquiry function', () => {
  assert.match(contact, /functions\.invoke\('storefront-enquiry'/);
  assert.match(contact, /kind: 'contact'/);
  assert.match(contact, /This sends your message directly to Fuzed Flow Support/);
});

test('support requests can be deleted only after confirmation', () => {
  assert.match(threads, /from\('support_tickets'\)\.delete\(\)/);
  assert.match(threads, /Delete support request\?/);
  assert.match(threads, /This cannot be undone/);
  assert.match(threads, /ConfirmDeleteDialog/);
});

test('database deletion is scoped to the active request owner', () => {
  assert.match(migration, /grant delete on table public\.support_tickets to authenticated/i);
  assert.match(migration, /create policy support_ticket_delete_own/i);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /p\.company_id = support_tickets\.company_id/i);
  assert.match(migration, /p\.is_active is distinct from false/i);
});

test('saved support requests notify the private support inbox', () => {
  assert.match(migration, /'fuzedflow@gmail\.com'/);
  assert.doesNotMatch(migration, /support@fuzedflow\.com/);
});
