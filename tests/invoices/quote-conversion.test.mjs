import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('quote conversion uses the atomic database function from both quote screens', async () => {
  const [builder, view, helper] = await Promise.all([
    read('src/pages/QuoteBuilder.jsx'),
    read('src/pages/ClientView.jsx'),
    read('src/lib/quoteInvoiceConversion.js'),
  ]);

  assert.match(builder, /convertQuoteToInvoice/);
  assert.match(view, /convertQuoteToInvoice/);
  assert.doesNotMatch(builder, /from\("invoices"\)\.insert/);
  assert.doesNotMatch(view, /from\("invoices"\)\.insert/);
  assert.match(helper, /rpc\("convert_quote_to_invoice"/);
});

test('database conversion validates children and prevents duplicate invoices', async () => {
  const migration = await read('supabase/migrations/20261014194000_atomic_quote_invoice_conversion.sql');
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /incomplete invoice/);
  assert.match(migration, /phase_count <> expected_phase_count/);
  assert.match(migration, /item_count <> expected_item_count/);
  assert.match(migration, /schedule_count <> expected_schedule_count/);
  assert.match(migration, /grant execute .* to authenticated/i);
});
