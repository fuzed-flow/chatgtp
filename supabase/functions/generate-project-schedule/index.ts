import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.112.3';
import {buildScheduleDraft} from '../_shared/schedule.js';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return respond({error:'Method not allowed'},405);
 try{
  const token=req.headers.get('Authorization')?.replace(/^Bearer /i,'');if(!token)return respond({error:'Sign in to plan a schedule.'},401);
  const userClient=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:{user},error:authError}=await userClient.auth.getUser(token);if(authError||!user)return respond({error:'Sign in to plan a schedule.'},401);
  const {data:profile}=await userClient.from('profiles').select('company_id,role,is_active').eq('id',user.id).single();
  if(!profile?.company_id||profile.is_active===false||!['owner','admin','office','manager'].includes(profile.role))return respond({error:'Manager access required.'},403);
  const {project_id}=await req.json();
  const {data:project,error}=await userClient.from('projects').select('id,start_date,target_end_date').eq('id',project_id).eq('company_id',profile.company_id).single();
  if(error||!project)return respond({error:'Project unavailable.'},404);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {count}=await db.from('project_schedule_drafts').select('id',{count:'exact',head:true}).eq('company_id',profile.company_id).gte('created_at',new Date(Date.now()-86400000).toISOString());
  if((count||0)>=5)return respond({error:'Your company has reached the five-draft daily limit.'},429);
  const {data:phases}=await userClient.from('project_phases').select('name,start_date_target,end_date_target,status').eq('project_id',project_id).eq('company_id',profile.company_id).limit(20);
  // Deterministic planning runs inside Fuzed Flow; project data is not sent to an external model.
  const schedule=buildScheduleDraft(project,phases||[]);
  const {data:draft,error:saveError}=await db.from('project_schedule_drafts').insert({company_id:profile.company_id,project_id,user_id:user.id,schedule}).select('id').single();if(saveError)throw saveError;
  return respond({success:true,schedule,draft_id:draft.id});
 }catch{console.error(JSON.stringify({level:'error',route:'generate-project-schedule',message:'Schedule draft generation failed'}));return respond({error:'The draft could not be prepared. Please use the manual schedule or try again.'},500);}
});
