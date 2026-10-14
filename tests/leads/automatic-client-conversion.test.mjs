import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('all lead conversion entry points use the shared database functions', async () => {
  const [builder, view, tracker, detail, helper] = await Promise.all([
    read('src/pages/QuoteBuilder.jsx'),
    read('src/pages/ClientView.jsx'),
    read('src/pages/LeadTracker.jsx'),
    read('src/pages/LeadDetail.jsx'),
    read('src/lib/leadClientConversion.js'),
  ]);

  assert.match(builder, /ensureQuoteClient\(activeQuoteId\)/);
  assert.match(view, /ensureQuoteClient\(quote\.id\)/);
  assert.match(tracker, /convertLeadToClient\(lead\.id\)/);
  assert.match(detail, /convertLeadToClient\(leadData\.id \|\| leadId\)/);
  assert.match(helper, /rpc\("convert_lead_to_client"/);
  assert.match(helper, /rpc\("ensure_quote_client"/);
  assert.doesNotMatch(tracker, /from\("clients"\)\s*\.insert/);
  assert.doesNotMatch(detail, /from\("clients"\)\.insert/);
});

test('database conversion is tenant-scoped, idempotent, and duplicate-aware', async () => {
  const migration = await read('supabase/migrations/20261014195500_automatic_lead_client_quote_conversion.sql');

  assert.match(migration, /p\.company_id = source_lead\.company_id/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /source_lead\.client_id is not null/);
  assert.match(migration, /candidate_count > 1/);
  assert.match(migration, /different email/);
  assert.match(migration, /different phone/);
  assert.match(migration, /set pipeline_stage = 'Won'/);
  assert.match(migration, /set client_id = client_id_value,\s*lead_id = null/);
  assert.match(migration, /revoke all on function public\.convert_lead_to_client\(uuid\) from public/i);
  assert.match(migration, /grant execute on function public\.convert_lead_to_client\(uuid\) to authenticated/i);
});

test('invoice conversion guarantees the quote has a client first', async () => {
  const migration = await read('supabase/migrations/20261014195500_automatic_lead_client_quote_conversion.sql');

  assert.match(migration, /perform public\.ensure_quote_client\(p_quote_id\)/);
  assert.match(migration, /return public\.convert_quote_to_invoice_core/);
  assert.match(migration, /revoke all on function public\.convert_quote_to_invoice_core[\s\S]*from authenticated/i);
});
