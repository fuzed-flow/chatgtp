import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { communicationPhone, communicationSmsPayload, SMS_MESSAGE_LIMIT } from '../../src/lib/clientCommunications.js';

const path = value => fileURLToPath(new URL(value, import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const plain = value => JSON.parse(JSON.stringify(value));
const bundled = build({
  stdin: { resolveDir: path('../../'), loader: 'jsx', sourcefile: 'contact-sms-test.jsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import CommunicationPanel from './src/components/clients/CommunicationPanel';import {fixture} from './tests/contact-sms/browser/mockDb';
    const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});window.queryClient=client;
    window.smsRoot=createRoot(document.getElementById('root'));window.renderSms=props=>window.smsRoot.render(<QueryClientProvider client={client}><CommunicationPanel {...props}/></QueryClientProvider>);
    window.renderSms(fixture.props);`,
  }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' },
  alias: { '@/api/supabaseClient': path('./browser/mockDb.js'), '@/lib/AuthContext': path('./browser/mockAuth.js'), '@': path('../../src') },
});
async function view(kind = 'lead', options = {}) {
  const errors = []; const vc = new VirtualConsole(); vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid/LeadDetail', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window, d = w.document;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  w.fetch = () => { throw new Error('Live requests are forbidden in SMS tests'); };
  const props = { [kind === 'lead' ? 'leadId' : 'clientId']: 'saved-contact', clientName: 'Sample contact', clientPhone: '(403) 555-0123', clientEmail: '', ...options.props };
  const inbound = { id: 'incoming-one', company_id: 'company-one', [kind === 'lead' ? 'lead_id' : 'client_id']: 'saved-contact', type: 'SMS', direction: 'Inbound', status: 'Received', message: 'Can we meet Tuesday? <b>literal text</b>', sent_by: '+14035550123', created_at: '2026-11-02T18:00:00Z' };
  const f = w.smsFixture = { kind, companyId: 'company-one', rows: [inbound], queries: [], calls: [], writes: [], replyStatus: { email: true, sms: true }, ...options, props };
  w.eval((await bundled).outputFiles[0].text);
  const wait = async predicate => { for (let i=0;i<150;i++) { if (predicate()) return; await pause(10); } throw new Error(`Missing SMS UI state. ${errors.join(';')}: ${d.body.textContent}`); };
  const buttons = (text, root=d) => [...root.querySelectorAll('button')].filter(el => el.textContent.trim() === text);
  await wait(() => buttons('Send SMS').length);
  await wait(() => d.body.textContent.includes('Can we meet Tuesday?'));
  const input = async (el, value) => { Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(el,value); el.dispatchEvent(new w.Event('input',{bubbles:true})); await pause(20); };
  const open = async (reply=false) => { buttons(reply ? 'Reply by SMS' : 'Send SMS')[0].click(); await wait(() => d.querySelector('[role=dialog]')); };
  const send = () => buttons('Send SMS',d.querySelector('[role=dialog]'))[0].click();
  return { w,d,f,props,errors,wait,buttons,input,open,send,close() { w.smsRoot.unmount(); w.queryClient.clear(); dom.window.close(); } };
}

test('phone formatting is explicit, rejects extensions, and SMS payload is tracked as a conversation', () => {
  assert.equal(communicationPhone('(403) 555-0123'), '+14035550123');
  assert.equal(communicationPhone('+44 20 7946 0123'), '+442079460123');
  assert.equal(communicationPhone('403-555-0123 ext 9'), null);
  assert.equal(communicationPhone('bad'), null);
  assert.deepEqual(communicationSmsPayload({leadId:'lead-one',phone:'4035550123',message:' Hello <3 ',requestId:'request-one',replyId:'reply-one'}), {
    client_id:null,lead_id:'lead-one',phone_number:'+14035550123',message_body:'Hello <3',request_id:'request-one',notification_kind:'communication',reply_to_communication_id:'reply-one',
  });
  assert.throws(() => communicationSmsPayload({phone:'4035550123',message:'x'.repeat(SMS_MESSAGE_LIMIT+1)}));
});
for (const kind of ['lead','client']) test(`${kind} sends an SMS without email and preserves its saved conversation context`, async () => {
  const v=await view(kind);
  try {
    await v.open(); assert.equal(v.d.querySelector('#communication-sms-recipient').value,'+14035550123');
    assert.equal(v.d.querySelector('#communication-sms-recipient').readOnly,true);
    assert.equal(v.buttons('Send SMS',v.d.querySelector('[role=dialog]'))[0].disabled,true);
    await v.input(v.d.querySelector('textarea'),'  Tuesday works. <3  '); v.send();
    await v.wait(() => !v.d.querySelector('[role=dialog]'));
    const body=plain(v.f.calls[0].body);
    assert.equal(v.f.calls[0].name,'send-sms');assert.equal(body[kind === 'lead' ? 'lead_id' : 'client_id'],'saved-contact');
    assert.equal(body[kind === 'lead' ? 'client_id' : 'lead_id'],null);
    assert.equal(body.notification_kind,'communication');assert.equal(body.message_body,'Tuesday works. <3');assert.equal(body.reply_to_communication_id,null);
    assert.match(body.request_id,/^[0-9a-f-]{36}$/);assert.equal(body.company_id,undefined);
    await v.wait(() => v.d.body.textContent.includes('Tuesday works. <3'));
    assert.equal(v.f.writes.length,0,'The trusted endpoint owns history writes.');assert.deepEqual(v.errors,[]);
  } finally { v.close(); }
});
test('SMS reply links the incoming message, renders incoming text safely, and does not prematurely mark it answered', async () => {
  const v=await view();
  try {
    assert.equal(v.d.querySelector('b'),null);assert.ok(v.d.body.textContent.includes('<b>literal text</b>'));
    await v.open(true);await v.input(v.d.querySelector('textarea'),'Yes, Tuesday morning.');v.send();
    await v.wait(() => v.f.calls.length === 1 && !v.d.querySelector('[role=dialog]'));
    assert.equal(v.f.calls[0].body.reply_to_communication_id,'incoming-one');
    assert.equal(v.f.writes.length,0);assert.ok(v.d.body.textContent.includes('Needs reply'));
  } finally { v.close(); }
});
test('failure keeps the draft and retry request ID, while an intentional new message gets a new ID', async () => {
  const v=await view();
  try {
    v.f.nextSend=async()=>({data:{success:false,error:'Check communication history before sending another copy.'},error:null});
    await v.open();await v.input(v.d.querySelector('textarea'),'Keep this draft');v.send();
    await v.wait(() => v.d.querySelector('[role=alert]'));
    assert.equal(v.d.querySelector('textarea').value,'Keep this draft');const first=v.f.calls[0].body.request_id;
    v.send();await v.wait(() => v.f.calls.length===2);assert.equal(v.f.calls[1].body.request_id,first);
    await v.wait(() => v.buttons('Send SMS',v.d.querySelector('[role=dialog]'))[0]?.disabled === false);
    await v.input(v.d.querySelector('textarea'),'A different message');v.send();await v.wait(() => v.f.calls.length===3);
    assert.notEqual(v.f.calls[2].body.request_id,first);
  } finally { v.close(); }
});
test('HTTP errors show the endpoint message and double clicks cannot send concurrent copies', async () => {
  const v=await view();
  try {
    let finish;v.f.nextSend=()=>new Promise(resolve=>{finish=resolve;});
    await v.open();await v.input(v.d.querySelector('textarea'),'One request only');v.send();v.send();
    await v.wait(() => v.f.calls.length===1);assert.equal(v.d.querySelector('textarea').disabled,true);
    finish({data:null,error:{context:new Response(JSON.stringify({error:'SMS delivery is not configured.'}),{status:400})}});
    await v.wait(() => v.d.querySelector('[role=alert]')?.textContent.includes('not configured'));
    assert.equal(v.f.calls.length,1);assert.equal(v.d.querySelector('textarea').value,'One request only');
  } finally { v.close(); }
});
for (const phone of ['', '4035550123 ext 9']) test(`missing or unsupported phone disables send and reply: ${phone}`, async () => {
  const v=await view('client',{props:{clientPhone:phone}});
  try {assert.equal(v.buttons('Send SMS')[0].disabled,true);assert.equal(v.buttons('Reply by SMS')[0].disabled,true);assert.ok(v.d.body.textContent.includes(phone ? 'Update this contact' : 'Add a phone number'));} finally {v.close();}
});
test('cancel retains the draft, switching contact clears it, and new inbound messages appear on refresh', async () => {
  const v=await view();
  try {
    await v.open();await v.input(v.d.querySelector('textarea'),'Unsent draft');v.buttons('Cancel',v.d.querySelector('[role=dialog]'))[0].click();
    await v.wait(() => !v.d.querySelector('[role=dialog]'));await v.open();assert.equal(v.d.querySelector('textarea').value,'Unsent draft');
    v.w.renderSms({...v.props,leadId:'another-contact',clientName:'Another contact'});await v.wait(() => !v.d.querySelector('[role=dialog]'));
    v.buttons('Send SMS')[0].click();await v.wait(() => v.d.querySelector('textarea'));assert.equal(v.d.querySelector('textarea').value,'');
    v.buttons('Cancel',v.d.querySelector('[role=dialog]'))[0].click();
    v.f.rows.push({...v.f.rows[0],id:'new-reply',lead_id:'another-contact',message:'A new incoming SMS'});
    await v.w.queryClient.invalidateQueries({queryKey:['client-communications']});await v.wait(() => v.d.body.textContent.includes('A new incoming SMS'));
    assert.ok(v.f.queries.filter(q=>q.table==='client_communications').every(q=>q.filters.some(([key,value])=>key==='company_id'&&value==='company-one')));
    const query=v.w.queryClient.getQueryCache().findAll({queryKey:['client-communications']}).at(-1);
    assert.equal([...query.observers][0].options.refetchInterval,15000);
    assert.equal([...query.observers][0].options.refetchIntervalInBackground,undefined);
  } finally { v.close(); }
});
test('unconfirmed reply capture is stated honestly while sending remains available', async () => {
  const v=await view('client',{replyStatus:{email:true,sms:false}});
  try {await v.wait(()=>v.d.body.textContent.includes('reply capture is not confirmed'));await v.open();assert.ok(v.d.querySelector('[role=dialog]').textContent.includes('not confirmed'));} finally {v.close();}
});
