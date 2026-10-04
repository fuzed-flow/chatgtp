const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const nextDay=value=>new Date(Date.parse(value)+86400000).toISOString().slice(0,10);
const weekday=value=>![0,6].includes(new Date(value).getUTCDay());
const clamp=(value,start,end)=>value<start?start:value>end?end:value;

export function buildScheduleDraft(project, sourcePhases=[], today=new Date().toISOString().slice(0,10)) {
 if(!date(today))throw new Error('Invalid planning date.');
 const start=date(project.start_date)?project.start_date:today;
 let fallbackEnd=start, defaultDays=weekday(start)?1:0;
 while(defaultDays<10){fallbackEnd=nextDay(fallbackEnd);if(weekday(fallbackEnd))defaultDays++;}
 const end=date(project.target_end_date)&&project.target_end_date>=start?project.target_end_date:fallbackEnd;
 const days=[];let cursor=start, calendarDays=0;
 while(cursor<=end){if(++calendarDays>3660)throw new Error('Review the project date range.');if(weekday(cursor))days.push(cursor);cursor=nextDay(cursor);}
 const workingDays=days.length;if(!days.length)days.push(start);
 const active=sourcePhases.filter(p=>!['completed','cancelled','canceled'].includes(String(p.status||'').toLowerCase())).slice(0,20);
 const source=active.length?active:[{name:'Preparation'},{name:'Work planning'},{name:'Handover'}];
 const phases=source.map((phase,index)=>{
  const defaultStart=days[Math.min(days.length-1,Math.floor(index*days.length/source.length))];
  const defaultEnd=days[Math.min(days.length-1,Math.max(0,Math.ceil((index+1)*days.length/source.length)-1))];
  const phaseStart=date(phase.start_date_target)?clamp(phase.start_date_target,start,end):defaultStart;
  const candidateEnd=date(phase.end_date_target)?clamp(phase.end_date_target,start,end):defaultEnd;
  const phaseEnd=candidateEnd<phaseStart?phaseStart:candidateEnd;
  const name=String(phase.name||`Phase ${index+1}`).slice(0,200);
  return {phase_name:name,start_date:phaseStart,end_date:phaseEnd,tasks:[{title:`Review ${name}`.slice(0,250),description:'Confirm scope, required materials, trade availability and task effort before scheduling the work.',priority:'Medium',due_date:phaseEnd,estimated_hours:0,assigned_to_id:null,assigned_to_name:null}]};
 });
 return validateSchedule({timeline:{project_start:start,project_end:end,total_working_days:workingDays},phases,bottlenecks:[],resource_analysis:[],insights:{critical_path:[],recommended_adjustments:['Existing project and phase targets are used when valid; missing project dates default to ten weekdays from the planning date.','Unscheduled phases divide the available weekdays. Review overlapping phases and dependencies.','Tasks are unassigned planning placeholders. Zero hours means effort has not been estimated.','Crew availability, weather, holidays and site constraints must be checked by the manager.']}});
}
export function validateSchedule(schedule) {
 if(!schedule?.timeline||!date(schedule.timeline.project_start)||!date(schedule.timeline.project_end)||schedule.timeline.project_end<schedule.timeline.project_start)throw new Error('Invalid schedule dates.');
 if(!Array.isArray(schedule.phases)||!schedule.phases.length||schedule.phases.length>20)throw new Error('Invalid schedule phases.');
 if ((schedule.resource_analysis || []).length) throw new Error("Crew utilization must be reviewed separately.");
 let count=0;
 for(const phase of schedule.phases){
  if(!phase.phase_name||!date(phase.start_date)||!date(phase.end_date)||phase.end_date<phase.start_date||phase.start_date<schedule.timeline.project_start||phase.end_date>schedule.timeline.project_end||!Array.isArray(phase.tasks))throw new Error('Review the phase dates.');
  for(const task of phase.tasks){
   if(!task.title||task.title.length>250||!date(task.due_date)||task.due_date<phase.start_date||task.due_date>phase.end_date||!Number.isFinite(task.estimated_hours)||task.estimated_hours<0||task.estimated_hours>240||task.assigned_to_id)throw new Error('Review the task dates and hours. Draft tasks must be unassigned.');
   if(++count>50)throw new Error('A draft can contain at most 50 tasks.');
  }
 }
 if(!count)throw new Error('The draft contains no tasks.');
 return schedule;
}
