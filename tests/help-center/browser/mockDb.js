import data from './articles.json';
let failure=0;
export function failNextLoad(){failure=2;}
function mockQuery(table){
 const filters=new Map();
 const load=()=>{
  if(table!=='help_faqs')return {data:[],error:null,count:0};
  if(failure){failure--;return {data:null,error:new Error('Synthetic connection failure')};}
  return {data:data.filter(article=>[...filters].every(([field,value])=>(field==='article_type'?(article.article_type||'faq'):article[field])===value)),error:null};
 };
 return {select(){return this;},eq(field,value){filters.set(field,value);return this;},order(){return this;},limit(){return this;},or(){return this;},then(resolve,reject){return Promise.resolve(load()).then(resolve,reject);},single(){return Promise.resolve({data:null,error:null});},maybeSingle(){return Promise.resolve({data:null,error:null});}};
}
export const supabase={
 from:mockQuery,
 functions:{invoke:async(name,options)=>{
  window.__helpLastRequest=options.body;
  const validation=/link validation/i.test(options.body.query);
  const reply=validation
   ? 'Read the [task filter guide](/HelpArticles?article=pm-task-assignee-filter), or [contact support](/Contact).\n\nThese unverified samples should remain plain text: [Missing page](/MissingHelpPage), [Missing article](/HelpArticles?article=guide-does-not-exist), and [External sample](https://unverified.example/help).'
   : '1. Open **PM Projects** and select your project.\n2. Choose **Staff & Tasks → Task Board**.\n3. Use **Assigned to** to pick a user.\n\nSelect **Unassigned** for tasks without an assignee or **All users** to reset. Read the [task filter guide](/HelpArticles?article=pm-task-assignee-filter) for the full steps.';
  const sources=[{slug:'pm-task-assignee-filter',question:'How do I filter project tasks by the person assigned?'}];
  if(validation)sources.push({slug:'guide-does-not-exist',question:'Unverified source sample'});
  return {data:{reply,sources,allowedLinks:[
   {href:'/HelpArticles',label:'Help Articles'},
   {href:'/FAQ',label:'Quick answers & FAQ'},
   {href:'/Contact',label:'Contact support'},
   {href:'/Tutorials',label:'Video tutorials'},
   {href:'/HelpArticles?article=pm-task-assignee-filter',label:'How do I filter project tasks by the person assigned?'},
  ]},error:null};
 }},
};
