import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,depositRequest,COMPANY,INVOICE,INVOICE_TOKEN} from './stripe-handler-fixture.mjs';

function milestoneFixture({total=18244.67,paid=5473.4,depositStatus='Paid',milestonePaid=0,currency='CAD'}={}) {
  return fixture('createDepositCheckout',{rows:{
    companies:[{id:COMPANY,stripe_account_id:'acct_synthetic',settings:{currency}}],
    invoices:[{id:INVOICE,company_id:COMPANY,status:'Partially Paid',invoice_number:'INV-SYNTHETIC',total,amount_paid:paid,has_payment_schedule:true}],
    invoice_payment_schedules:[
      {id:'deposit',invoice_id:INVOICE,company_id:COMPANY,amount:5473.4,amount_type:'percentage',percentage:30,amount_paid:paid,status:depositStatus,sort_order:0},
      {id:'next',invoice_id:INVOICE,company_id:COMPANY,amount:5473.4,amount_type:'percentage',percentage:30,amount_paid:milestonePaid,status:'Pending',sort_order:1},
    ],
  }});
}

test('a settled 30% deposit on an 18244.67 invoice advances to the next 5473.40 milestone',async()=>{
  const view=milestoneFixture();
  const response=await view.handler(depositRequest({invoice_id:INVOICE,token:INVOICE_TOKEN}));
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const call=view.stripeCalls.find(item=>item.method==='checkout.sessions.create');
  assert.equal(call.args[0].line_items[0].price_data.unit_amount,547340);
  assert.equal(call.args[0].metadata.schedule_item_id,'next');
  assert.equal(view.writes.length,0,'Starting checkout does not alter invoice or payment records.');
});

test('rounding skips a settled percentage milestone even before its Paid status is refreshed',async()=>{
  const view=milestoneFixture({depositStatus:'Pending'});
  assert.equal((await view.handler(depositRequest({invoice_id:INVOICE,token:INVOICE_TOKEN}))).status,200);
  const call=view.stripeCalls.find(item=>item.method==='checkout.sessions.create');
  assert.equal(call.args[0].metadata.schedule_item_id,'next');
  assert.equal(call.args[0].line_items[0].price_data.unit_amount,547340);
});

test('partial milestone payments are subtracted in cents',async()=>{
  const view=milestoneFixture({milestonePaid:1000});
  assert.equal((await view.handler(depositRequest({invoice_id:INVOICE,token:INVOICE_TOKEN}))).status,200);
  assert.equal(view.stripeCalls.find(item=>item.method==='checkout.sessions.create').args[0].line_items[0].price_data.unit_amount,447340);
});

test('a real unpaid cent remains collectible instead of being treated as rounding noise',async()=>{
  const view=milestoneFixture({paid:5473.39,depositStatus:'Partial'});
  assert.equal((await view.handler(depositRequest({invoice_id:INVOICE,token:INVOICE_TOKEN}))).status,200);
  const call=view.stripeCalls.find(item=>item.method==='checkout.sessions.create');
  assert.equal(call.args[0].metadata.schedule_item_id,'deposit');
  assert.equal(call.args[0].line_items[0].price_data.unit_amount,1);
});

test('zero-decimal currency milestones are rounded to the currency unit before checking what remains',async()=>{
  const view=milestoneFixture({total:1001,paid:300,depositStatus:'Pending',currency:'JPY'});
  assert.equal((await view.handler(depositRequest({invoice_id:INVOICE,token:INVOICE_TOKEN}))).status,200);
  const call=view.stripeCalls.find(item=>item.method==='checkout.sessions.create');
  assert.equal(call.args[0].metadata.schedule_item_id,'next');
  assert.equal(call.args[0].line_items[0].price_data.unit_amount,300);
});
