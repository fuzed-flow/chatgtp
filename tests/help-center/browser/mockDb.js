import data from './articles.json';
let failure=0;
export function failNextLoad(){failure=2;}
export const supabase={
 from(){return {select(){return this},eq(){return this},order(){if(failure){failure--;return Promise.resolve({data:null,error:new Error('Synthetic connection failure')});}return Promise.resolve({data:data.filter(article=>article.is_active!==false),error:null});}}},
 functions:{invoke:async(name,options)=>{window.__helpLastRequest=options.body;return {data:{reply:'1. Open **PM Projects** and select your project.\n2. Choose **Staff & Tasks → Task List**.\n3. Use **Assigned to** to pick a user.\n\nSelect **Unassigned** for tasks without an assignee or **All users** to reset.',sources:[{slug:'pm-task-assignee-filter',question:'How do I filter project tasks by the person assigned?'}]},error:null};}},
};
