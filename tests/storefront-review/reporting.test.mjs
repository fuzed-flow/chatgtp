import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecordDate, paymentDate, withinDateRange, invoiceBalance, csvText } from '../../src/lib/reporting.js';
import { getUserLimitFromQuantity } from '../../supabase/functions/_shared/subscriptionPlans.js';
import { checkoutAmount, checkoutReturnUrl, currencyFactor } from '../../supabase/functions/_shared/checkout.js';
test('additional billing units add seats above included users', () => {
 for (const [plan, base] of Object.entries({starter:1,professional:3,business:10})) {
  assert.equal(getUserLimitFromQuantity(plan,1),base); assert.equal(getUserLimitFromQuantity(plan,2),base+1); assert.equal(getUserLimitFromQuantity(plan,6),base+5);
 }
});
test('report dates include both date-range boundaries and Stripe dates', () => {
 assert.equal(paymentDate({payment_date:'2026-10-04',date:'2020-01-01'}),'2026-10-04');
 assert.equal(withinDateRange('2026-10-04',new Date('2026-10-04T00:00:00'),new Date('2026-10-04T23:59:59')),true);
 assert.equal(parseRecordDate('bad'),null); assert.ok(parseRecordDate('2026-10-04T15:22:00Z'));
 assert.equal(invoiceBalance({total:100,balance_due:0}),0); assert.equal(invoiceBalance({total:100,amount_paid:40}),60);
});
test('CSV safely escapes values and neutralizes spreadsheet formulas', () => {
 const text=csvText(['name','amount'],[['A,"B"',-20],['=HYPERLINK("evil")',3]]);
 assert.ok(text.includes('"A,""B"""'));assert.ok(text.includes("'=HYPERLINK"));assert.ok(text.includes('-20'));
});
test('quote checkout derives the approved remaining deposit on the server', () => {
 assert.equal(checkoutAmount({status:'Approved',total:500,deposit_amount:200,deposit_paid_amount:50},'quote',1),150);
 assert.throws(()=>checkoutAmount({status:'Draft',total:500,deposit_amount:200},'quote'));
 assert.throws(()=>checkoutAmount({status:'Approved',total:500,deposit_amount:200,deposit_paid_amount:200},'quote'));
});
test('invoice checkout bounds partial payments and trusts only application redirects', () => {
 const inv={status:'Sent',total:500,amount_paid:200};assert.equal(checkoutAmount(inv,'invoice',100),100);assert.equal(checkoutAmount(inv,'invoice'),300);
 assert.throws(()=>checkoutAmount(inv,'invoice',400));assert.throws(()=>checkoutAmount(inv,'invoice',-10));
 assert.equal(currencyFactor('usd'),100);assert.equal(currencyFactor('jpy'),1);
 assert.equal(checkoutReturnUrl('https://evil.test','https://app.fuzedflow.com/invoice','https://app.fuzedflow.com'),'https://app.fuzedflow.com/invoice');
});
