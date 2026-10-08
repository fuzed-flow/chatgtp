import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,authorization,apikey,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const respond=(body:unknown,status=200)=>Response.json(body,{status,headers:{...cors,'Cache-Control':'no-store'}});
const escapeHtml=(value:unknown)=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return respond({error:'Method not allowed'},405);
 const origin=req.headers.get('Origin');
 if(origin&&!['https://www.fuzedflow.com','https://fuzedflow.com','https://app.fuzedflow.com','http://localhost:3000','http://localhost:4173','http://localhost:5173'].includes(origin)&&!/^https:\/\/fuzed-flow-[a-z0-9-]+-fuzed-flow\.vercel\.app$/.test(origin))return respond({error:'Origin not allowed'},403);
 try{
  if(Number(req.headers.get('Content-Length')||0)>15000)return respond({error:'Request too large'},413);
  const text=await req.text();if(text.length>15000)return respond({error:'Request too large'},413);
  const body=JSON.parse(text);
  if(body.website)return respond({ok:true});
  const fields={kind:body.kind,name:String(body.name||'').trim(),email:String(body.email||'').trim(),company:String(body.company||'').trim(),phone:String(body.phone||'').trim(),message:String(body.message||'').trim(),preferred_date:String(body.preferred_date||'')};
  if(!['demo','contact'].includes(fields.kind)||!fields.name||fields.name.length>120||fields.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(fields.email)||fields.company.length>150||fields.phone.length>40||fields.message.length>4000||fields.preferred_date&&!/^\d{4}-\d{2}-\d{2}$/.test(fields.preferred_date))return respond({error:'Provide a valid name and email and keep the message under 4,000 characters.'},400);
  const salt=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||req.headers.get('cf-connecting-ip')||'unknown';
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip+salt));
  const digest=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const db=createClient(Deno.env.get('SUPABASE_URL')!,salt);
  const {data:id,error}=await db.rpc('record_storefront_enquiry',{p_fields:fields,p_digest:digest});
  if(error)return respond({error:'Please try again later or call 1(855) 904-5509.'},429);
  const key=Deno.env.get('RESEND_API_KEY');
  if(key){
   const subject=fields.kind==='demo'?'Fuzed Flow Storefront - Book Demo Request':'Fuzed Flow Storefront - Contact';
   const email=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from:'Fuzed Flow <alerts@mail.fuzedflow.com>',to:'fuzedflow@gmail.com',reply_to:fields.email,subject,html:'<h2>New Fuzed Flow enquiry</h2>'+Object.entries(fields).map(([label,value])=>`<p><strong>${escapeHtml(label)}</strong>: ${escapeHtml(value)}</p>`).join('')})});
   await db.from('storefront_enquiries').update({notification_status:email.ok?'sent':'failed'}).eq('id',id);
   if(!email.ok)console.error(JSON.stringify({level:'error',route:'storefront-enquiry',message:'Notification delivery failed',status:email.status}));
  }
  return respond({ok:true});
 }catch{console.error(JSON.stringify({level:'error',route:'storefront-enquiry',message:'Request processing failed'}));return respond({error:'Your request could not be saved. Please call 1(855) 904-5509.'},500);}
});
