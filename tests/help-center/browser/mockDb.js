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
 functions:{invoke:async(name,options)=>{window.__helpLastRequest=options.body;return {data:{reply:'1. Open **PM Projects** and select your project.\n2. Choose **Staff & Tasks → Task List**.\n3. Use **Assigned to** to pick a user.\n\nSelect **Unassigned** for tasks without an assignee or **All users** to reset.',sources:[{slug:'pm-task-assignee-filter',question:'How do I filter project tasks by the person assigned?'}]},error:null};}},
};
