import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClientTasks, clientTaskUpdates, updateClientTask, deleteClientTask } from '../../src/lib/clientTasks.js';
function fixture({fail=false}={}) {
  const queries=[];
  const db={from(table){const query={table,filters:[]};queries.push(query);
    const chain={select(){return chain;},eq(key,value){query.filters.push([key,value]);return chain;},
      order(){return chain;},update(changes){query.changes=changes;return chain;},delete(){query.deleted=true;return chain;},
      then(resolve){resolve({error:fail ? new Error('Permission denied') : null,data:[{id:'same-id',title:table,created_at:table==='tasks'?'2026-11-02T18:00Z':'2026-11-01T18:00Z'}]});}};
    return chain;
  }};
  return {db,queries};
}
test('client task list combines original lead tasks and project tasks with scoped queries and separate identities',async()=>{
  const {db,queries}=fixture();const tasks=await loadClientTasks(db,'company','client');
  assert.deepEqual(tasks.map(t=>t._taskTable),['tasks','project_tasks']);
  assert.equal(tasks.length,2,'identical UUIDs in different tables must not hide a task');
  assert.ok(queries.every(q=>JSON.stringify(q.filters)===JSON.stringify([['company_id','company'],['client_id','client']])));
});
for(const table of ['tasks','project_tasks']) test(`${table} edits, status changes and deletion keep the correct source and account`,async()=>{
  const {db,queries}=fixture(),task={id:'task',_taskTable:table};
  await updateClientTask(db,'company','client',task,{title:'Edited'});
  await updateClientTask(db,'company','client',task,{status:'Completed'});
  await deleteClientTask(db,'company','client',task);
  assert.ok(queries.every(q=>q.table===table));
  assert.ok(queries.every(q=>JSON.stringify(q.filters)===JSON.stringify([['id','task'],['company_id','company'],['client_id','client']])));
  assert.deepEqual(queries[0].changes,{title:'Edited'});assert.equal(queries[2].deleted,true);
});
test('converted task edits preserve timestamp, assignee and zero hours and write the original field types',()=>{
  const form={_taskTable:'tasks',title:'Visit',status:'Doing',assigned_to:'user',_originalAssignedTo:'user',due_date_target:'2030-11-02',_originalDueDate:'2030-11-02T17:30:00+00:00',estimated_hours:0};
  let changes=clientTaskUpdates(form);
  assert.equal(changes.due_date,'2030-11-02T17:30:00+00:00');assert.equal(changes.assigned_to,'user');assert.equal(changes.estimated_hours,0);
  assert.equal(changes.due_date_target,undefined);
  changes=clientTaskUpdates({...form,assigned_to:'none',due_date_target:''});
  assert.equal(changes.assigned_to,null);assert.equal(changes.due_date,null);
  changes=clientTaskUpdates({...form,assigned_to:'new-user',due_date_target:'2030-11-03'});
  assert.equal(changes.assigned_to,'new-user');assert.equal(changes.due_date,'2030-11-03');
});
test('project tasks retain multiple assignees when only the title is edited',()=>{
  const form={_taskTable:'project_tasks',title:'Renamed',assigned_to:'a',_originalAssignedTo:['a','b'],due_date_target:'2030-11-02',estimated_hours:'2.5'};
  assert.deepEqual(clientTaskUpdates(form).assigned_to,['a','b']);
  assert.deepEqual(clientTaskUpdates({...form,assigned_to:'c'}).assigned_to,['c']);
  assert.equal(clientTaskUpdates(form).due_date_target,'2030-11-02');
});
test('query and write errors propagate and unknown sources cannot select arbitrary tables',async()=>{
  const {db}=fixture({fail:true});
  await assert.rejects(loadClientTasks(db,'company','client'),/Permission denied/);
  await assert.rejects(updateClientTask(db,'company','client',{id:'task',_taskTable:'tasks'},{status:'Done'}),/Permission denied/);
  await assert.rejects(deleteClientTask(db,'company','client',{id:'task',_taskTable:'tasks'}),/Permission denied/);
  await assert.rejects(deleteClientTask(db,'company','client',{id:'task',_taskTable:'profiles'}),/Task source is missing/);
});
