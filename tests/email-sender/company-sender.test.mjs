import test from 'node:test';
import assert from 'node:assert/strict';
import { companyEmailFrom, resolveCompanyEmailSender } from '../../supabase/functions/_shared/companyEmailSender.js';

test('company names use the fixed verified sender address', () => {
  assert.equal(companyEmailFrom({name: 'LB Projects', email: 'ignored@example.invalid'}), '"LB Projects" <alerts@mail.fuzedflow.com>');
  assert.equal(companyEmailFrom({name: 'Omega Reno & Contracting Inc'}), '"Omega Reno & Contracting Inc" <alerts@mail.fuzedflow.com>');
});

test('display names preserve punctuation and Unicode within one quoted mailbox', () => {
  assert.equal(companyEmailFrom({name: 'Élan, "Build" \\ Renovate (Calgary)'}), '"Élan, \\"Build\\" \\\\ Renovate (Calgary)" <alerts@mail.fuzedflow.com>');
  assert.equal(companyEmailFrom({name: '  Jane’s   Renovations  '}), '"Jane’s Renovations" <alerts@mail.fuzedflow.com>');
});

test('saved names cannot introduce control characters or additional headers', () => {
  const from = companyEmailFrom({name: 'LB\r\nBcc: other@example.invalid\u0000\u0085\u2028\u2029'});
  assert.equal(from, '"LB Bcc: other@example.invalid" <alerts@mail.fuzedflow.com>');
  assert.doesNotMatch(from, /[\r\n\u0000\u0085\u2028\u2029]/);
  assert.equal(companyEmailFrom({name: '🛠'.repeat(200)}), `"${'🛠'.repeat(150)}" <alerts@mail.fuzedflow.com>`);
});

test('missing company names stop sending instead of reverting to platform branding', () => {
  for (const name of [undefined, null, '', ' \r\n ', 123]) {
    assert.throws(() => companyEmailFrom({name}), /Save your company name/);
  }
});

test('company identity lookup is scoped to the authenticated company and fails closed', async () => {
  const calls = [];
  let result = {data: {name: 'Saved Company'}, error: null};
  const query = {select: value => {calls.push(['select', value]); return query;}, eq: (...args) => {calls.push(['eq', ...args]); return query;}, single: async () => result};
  const db = {from: value => {calls.push(['from', value]); return query;}};
  assert.equal((await resolveCompanyEmailSender(db, 'company-one')).from, '"Saved Company" <alerts@mail.fuzedflow.com>');
  assert.deepEqual(calls, [['from', 'companies'], ['select', 'name,settings'], ['eq', 'id', 'company-one']]);
  for (const failure of [{data: null, error: null}, {data: {name: 'Wrong Company'}, error: {message: 'unavailable'}}]) {
    result = failure;
    await assert.rejects(resolveCompanyEmailSender(db, 'company-one'), /identity is unavailable/);
  }
});
