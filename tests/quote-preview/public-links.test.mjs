import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicQuoteUrl, readPublicQuoteLink } from '../../src/lib/publicQuoteLinks.js';

const ID = '00000000-0000-4000-8000-000000000001';
const TOKEN = 'a'.repeat(64);

test('new quote links survive removal of email/browser query parameters', () => {
  const url = new URL(buildPublicQuoteUrl('https://app.fuzedflow.com', ID, TOKEN));
  url.search = '';
  assert.deepEqual(readPublicQuoteLink(url), { quoteId: ID, token: TOKEN });
  assert.equal(url.origin, 'https://app.fuzedflow.com');
  assert.equal(url.search, '');
});

test('existing emailed and checkout-return quote links retain access', () => {
  for (const separator of ['&', '&amp;']) {
    const url = new URL(`https://app.fuzedflow.com/PublicQuoteView?id=${ID}${separator}token=${TOKEN}&payment=success`);
    assert.deepEqual(readPublicQuoteLink(url), { quoteId: ID, token: TOKEN });
  }
});

test('tokens and IDs round-trip without confusing URL delimiters', () => {
  const token = 'a'.repeat(32) + '/?&#%';
  const url = new URL(buildPublicQuoteUrl('https://app.fuzedflow.com', ID, token));
  assert.deepEqual(readPublicQuoteLink(url), { quoteId: ID, token });
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
});

test('path credentials stay together when unrelated query parameters are present', () => {
  const url = new URL(buildPublicQuoteUrl('https://app.fuzedflow.com', ID, TOKEN));
  url.search = '?id=another-quote&token=another-token';
  assert.deepEqual(readPublicQuoteLink(url), { quoteId: ID, token: TOKEN });
});

test('missing access credentials are never guessed from a quote ID', () => {
  assert.throws(() => buildPublicQuoteUrl('https://app.fuzedflow.com', ID, ''), /secure quote link/);
  assert.deepEqual(readPublicQuoteLink(new URL(`https://app.fuzedflow.com/PublicQuoteView?id=${ID}`)), { quoteId: ID, token: null });
  assert.deepEqual(readPublicQuoteLink(new URL('https://app.fuzedflow.com/PublicQuoteView/%ZZ/token')), { quoteId: null, token: null });
});
