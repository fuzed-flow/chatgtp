const members = [
  {id:'gary',full_name:'Gary Byrne',email:'gary@example.invalid'},
  {id:'jordan',full_name:'Jordan',email:'jordan@example.invalid'},
  {id:'jaclyn',full_name:'Jaclyn',email:'jaclyn@example.invalid'}
].map(member => ({ ...member, company_id: 'sample-company' }));
const task = (id,title,assigned_to,status='To Do',project_id='sample-project') => ({id,title,assigned_to,status,project_id,company_id:'sample-company',priority:'Medium'});
const data = {
  users:members, profiles:members,
  projects:[{id:'sample-project',name:'Sample renovation',company_id:'sample-company'},{id:'other-project',name:'Second project',company_id:'sample-company'}],
  clients:[],project_phases:[],
  project_staff:members.map(u=>({id:'staff-'+u.id,user_id:u.id,project_id:'sample-project'})),
  project_tasks:[
    task('doors','Install interior doors',['jordan']),
    task('walk','Site walkthrough',['jordan','gary']),
    task('paint','Paint touch-ups','jordan','Done'),
    task('quote','Prepare quote','gary@example.invalid'),
    task('cleaner','Book cleaner',null),
    task('delivery','Confirm material delivery',[]),
    task('other','Second project task',null,'To Do','other-project')
  ]
};
export const supabase={from(table){
  const filters=[];
  const query={
    select(){return this},eq(key,value){filters.push([key,value]);return this},order(){return this},
    then(resolve,reject){return Promise.resolve({data:(data[table]||[]).filter(row=>filters.every(([key,value])=>row[key]===value)),error:null}).then(resolve,reject)}
  };
  return query;
}};
