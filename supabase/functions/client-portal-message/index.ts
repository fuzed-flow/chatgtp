import { createClient } from 'npm:@supabase/supabase-js@2.107.0';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status=200) => Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email = (value: unknown): value is string => typeof value==='string' && value.length<=254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
const escape = (value: unknown) => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function phone(value: string) {
  const n=value.trim().replace(/[\s().-]/g,'');
  if(/^\d{10}$/.test(n)) return '+1'+n;
  if(/^1\d{10}$/.test(n)) return '+'+n;
  if(/^\+[1-9]\d{7,14}$/.test(n)) return n;
  throw new Error('Your contractor has not configured a valid SMS number.');
}
Deno.serve(async req => {
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return json({error:'Method not allowed.'},405);
  let db: any, input: any, claimed=false, attempted=false, rejected=false, accepted=false;
  try {
    if(Number(req.headers.get('content-length')||0)>18000) return json({error:'Message is too large.'},413);
    const raw=await req.text();if(raw.length>18000) return json({error:'Message is too large.'},413);
    input=JSON.parse(raw);
    if(!uuid.test(input.client_id||'') || !uuid.test(input.request_id||'') || !['Email','SMS'].includes(input.channel)
      || typeof input.token!=='string' || input.token.length<32 || input.token.length>256
      || !['portal','quote','invoice','change_order'].includes(input.token_kind)
      || typeof input.message!=='string' || !input.message.trim() || input.message.length>(input.channel==='SMS'?1600:5000)
      || typeof input.subject!=='string' || input.subject.length>160 || (input.channel==='Email'&&!input.subject.trim())
      || (input.reply_id && !uuid.test(input.reply_id))) return json({error:'Enter a valid subject and message using your private portal link.'},400);
    const resend=Deno.env.get('RESEND_API_KEY'),sid=Deno.env.get('TWILIO_ACCOUNT_SID'),secret=Deno.env.get('TWILIO_AUTH_TOKEN'),from=Deno.env.get('TWILIO_FROM_NUMBER');
    if(input.channel==='Email'?!resend:(!sid||!secret||!from)) return json({error:'This delivery method is unavailable. Please contact your contractor.'},503);
    db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
    const {data: context,error}=await db.rpc('claim_client_portal_message',{
      p_client:input.client_id,p_token:input.token,p_kind:input.token_kind,p_request:input.request_id,
      p_channel:input.channel,p_subject:input.subject,p_message:input.message,p_reply:input.reply_id||null,
    });
    if(error) return json({error: error.code==='54000'?'Message limit reached. Please try again later.':
      ['42501','22023'].includes(error.code)?error.message:'The message could not be prepared. Please try again.'},error.code==='54000'?429:403);
    if(!context?.claimed) return context?.status==='sent'?json({success:true,replayed:true,message_id:context.message_id}):
      json({error:context?.status==='failed'?'The previous delivery failed. Start a new send to retry.':'This message is still being confirmed. Check your history before sending again.',status:context?.status||'unknown'},409);
    claimed=true;
    let response: Response, provider: string;
    const who=String(context.client_name||'Your client').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,100);
    const link=`https://app.fuzedflow.com/ClientDetail?id=${encodeURIComponent(input.client_id)}`;
    if(input.channel==='Email') {
      if(!email(context.recipient)) throw new Error('Your contractor has not configured a valid email address.');
      const payload={from:'Fuzed Flow <alerts@mail.fuzedflow.com>',to:[context.recipient],
        subject:`Client portal — ${who}: ${String(context.subject).replace(/[\r\n]/g,' ').slice(0,160)}`,
        ...(email(context.client_email)?{reply_to:context.client_email}:{}),
        html:`<p>Message from <strong>${escape(who)}</strong> to ${escape(context.company_name)}.</p><div style="white-space:pre-wrap">${escape(context.message)}</div><p><a href="${link}">Open this client's conversation in FuzedFlow</a></p>`,
      };
      attempted=true;provider='resend';
      response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resend}`,'Content-Type':'application/json','Idempotency-Key':`portal/${input.client_id}/${input.request_id}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    } else {
      const recipient=phone(context.recipient);
      const text=`FuzedFlow — client portal message from ${who}:\n${context.message}\nReply in FuzedFlow: ${link}`;
      attempted=true;provider='twilio';
      response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:'POST',headers:{Authorization:`Basic ${btoa(`${sid}:${secret}`)}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:recipient,From:from!,Body:text}),signal:AbortSignal.timeout(15000)});
    }
    if(!response.ok){rejected=true;throw new Error('Delivery was rejected.');}
    const result=await response.json(),providerId=provider==='resend'?result.id:result.sid;
    if(provider==='resend'?!uuid.test(providerId||''):!/^SM[0-9a-f]{32}$/i.test(providerId||'')) throw new Error('Delivery acceptance could not be confirmed.');
    accepted=true;
    const done=await db.rpc('finish_client_portal_message',{p_client:input.client_id,p_request:input.request_id,p_status:'sent',p_provider:provider,p_provider_id:providerId});
    if(done.error) throw new Error('History confirmation is pending.');
    return json({success:true,message_id:context.message_id});
  } catch {
    if(claimed && db) {
      try { await db.rpc('finish_client_portal_message',{p_client:input.client_id,p_request:input.request_id,p_status:accepted||attempted&&!rejected?'unknown':'failed'}); } catch { /* Never log tokens, recipients or customer content. */ }
    }
    return json({error:claimed?(accepted||attempted&&!rejected?'Delivery could not be confirmed. Check communication history before sending again.':'The email or SMS could not be sent. Your message remains in portal history.'):'The message could not be sent. Please try again.'},claimed?502:400);
  }
});
