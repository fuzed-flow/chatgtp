import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_INVOICE_EMAIL,invoiceEmailTemplate,invoiceEmailPayments,renderInvoiceEmail} from '../../src/lib/invoiceEmail.js';

test('only exact shipped default templates are replaced; custom templates keep the full-invoice balance token',()=>{
  const custom='Invoice {{invoice_number}}: total balance ${{balance_due}}; requested {{payment_name}} ({{milestone_name}}): ${{payment_balance}}';
  assert.equal(invoiceEmailTemplate(custom),custom);
  assert.equal(invoiceEmailTemplate(''),DEFAULT_INVOICE_EMAIL);
  assert.equal(renderInvoiceEmail({template:custom,invoice:{invoice_number:'INV-1004',balance_due:12771.27},payment:{name:'Payment 2',milestone:'Rough-ins Complete',label:'Payment 2 — Rough-ins Complete',balance:4473.4}}),
    'Invoice INV-1004: total balance $12,771.27; requested Payment 2 (Rough-ins Complete): $4,473.40');
});

test('paid and fully collected milestones are omitted, sorting is stable, and a request never exceeds the invoice balance',()=>{
  const schedule=[
    {id:'second',payment_name:'Second',amount:50,amount_paid:10,sort_order:2},
    {id:'first',payment_name:'First',amount:100,amount_paid:10,sort_order:1},
    {id:'settled',amount:25,amount_paid:25,sort_order:0},
    {id:'paid',amount:50,amount_paid:0,status:'Paid',sort_order:0},
  ];
  const original=JSON.stringify(schedule);
  const payments=invoiceEmailPayments({balance_due:45.25},schedule);
  assert.deepEqual(payments.map(item=>[item.id,item.balance]),[['first',45.25],['second',40]]);
  assert.equal(JSON.stringify(schedule),original,'Rendering an email does not modify saved payment schedules.');
});

test('a fully paid invoice has no payment request and a message with no collection demand',()=>{
  assert.deepEqual(invoiceEmailPayments({balance_due:0},[{id:'old',amount:100}]),[]);
  const message=renderInvoiceEmail({invoice:{invoice_number:'INV-1004',balance_due:0},clientName:'Paul Hughes'});
  assert.match(message,/Hi Paul/);
  assert.match(message,/paid in full/);
  assert.doesNotMatch(message,/remaining balance|{{/);
});

test('token replacements treat dollar signs and braces in customer data literally without recursively resolving them',()=>{
  const message=renderInvoiceEmail({template:'{{payment_summary}} {{unknown_token}}',invoice:{invoice_number:'INV-1004',balance_due:90},payment:{label:'Payment $& {{balance_due}}',balance:12.34}});
  assert.equal(message,'Your Payment $& {{balance_due}} for invoice INV-1004 has a remaining balance of $12.34.');
});
