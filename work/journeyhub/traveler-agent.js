/* One account-owned trip agent: saved evidence, reviewable actions, verified results. */
let taNotice={owner:null,tripId:null,text:''};
let taRetryCheck={owner:null,id:null};
const taTrip=id=>{tcScope();return tc.trips.find(t=>t.id===id);};
const taSafeURL=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}};
function taTasks(trip,day){
  const selected=day?new Set((trip.stops||[]).filter(s=>s.dayIndex===day).map(s=>s.id)):null;
  const tasks=Array.isArray(trip.readiness?.tasks)?trip.readiness.tasks:[];
  return tasks.filter(t=>!selected||!t.stopId||selected.has(t.stopId)).map(t=>({...t,status:['ready','attention','unknown'].includes(t.status)?t.status:'unknown'}));
}
function taCounts(trip,tasks,day){
  if(tasks.length)return {ready:tasks.filter(t=>t.status==='ready').length,attention:tasks.filter(t=>t.status==='attention').length,unknown:tasks.filter(t=>t.status==='unknown').length};
  const r=trip.readiness;
  if(r&&!day)return {ready:Math.max(0,Number(r.ready)||0),attention:Math.max(0,Number(r.attention)||0),unknown:Math.max(0,Number(r.unknown)||0)};
  // Older saved companion responses are unverified, never silently all-clear.
  return {ready:0,attention:0,unknown:(trip.stops||[]).filter(s=>!day||s.dayIndex===day).length};
}
function taStamp(value,city){
  if(!value||!Number.isFinite(Date.parse(value)))return 'Not checked yet';
  try{return new Intl.DateTimeFormat('en-GB',{timeZone:({Bangkok:'Asia/Bangkok',Shanghai:'Asia/Shanghai',Singapore:'Asia/Singapore'})[city]||'UTC',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}catch{return 'Not checked yet';}
}
function taTaskHTML(task,trip){
  const label={ready:'Ready',attention:'Needs attention',unknown:'To verify'}[task.status],source=taSafeURL(task.sourceURL),busy=tc.busy?' disabled':'';
  const action=['booking','details','review','check'].includes(task.action)?task.action:'';
  const actionText={booking:'Review booking',details:'Visit details',review:'Review change',check:'Check now'}[action];
  return '<li class="ta-task ta-task-'+task.status+'"><span class="ta-task-icon" aria-hidden="true">'+ic(task.status==='ready'?'check':task.status==='attention'?'bell':'info',16)+'</span><div><div class="ta-task-title"><strong>'+esc(task.title||'Visit check')+'</strong><span>'+label+'</span></div>'+(task.detail?'<p>'+esc(task.detail)+'</p>':'')+'<div class="ta-task-actions">'+(action?'<button data-act="taTask" data-a="'+esc(trip.id)+'" data-b="'+esc(task.id)+'"'+busy+'>'+actionText+' '+ic('right',13)+'</button>':'')+(source?'<a href="'+esc(source)+'" target="_blank" rel="noopener noreferrer">Source ↗</a>':'')+'</div></div></li>';
}
function taProposalHTML(trip){
  const p=trip.proposal;if(!p)return '';
  return '<section class="tc-proposal ta-proposal" aria-label="Proposed itinerary adjustment"><small>REVIEW BEFORE APPLYING</small><h3>'+esc(p.title||'Suggested adjustment')+'</h3><p>'+esc(p.summary||'')+'</p>'+(p.changes?.length?'<ol class="ta-changes">'+p.changes.map(c=>'<li><strong>'+esc(c.name||'Planned visit')+'</strong><div><span><small>Current</small>'+esc(c.before||'Current plan')+'</span><span aria-hidden="true">→</span><span><small>Proposed</small>'+esc(c.after||'Suggested change')+'</span></div></li>').join('')+'</ol>':'')+(p.canApply?'<button class="btn btn-primary btn-block" data-act="tcAccept" data-a="'+esc(trip.id)+'" data-b="'+esc(p.id)+'"'+(tc.busy?' disabled':'')+'>Apply this adjustment</button>':'<p class="ta-proposal-hold">No changes applied. Your current plan stays saved.</p>')+'</section>';
}
function taActivityHTML(trip){
  const rows=(Array.isArray(trip.activity)?trip.activity:Array.isArray(trip.events)?trip.events:[]).slice().sort((a,b)=>(Date.parse(b.at||b.createdAt)||0)-(Date.parse(a.at||a.createdAt)||0)).slice(0,4);
  if(!rows.length)return '';
  return '<details class="ta-activity"><summary>Recent activity</summary><ol>'+rows.map(e=>'<li><span>'+esc(e.title||e.message||String(e.kind||'Trip updated').replaceAll('_',' '))+'</span><time>'+esc(taStamp(e.at||e.createdAt,trip.city))+'</time></li>').join('')+'</ol></details>';
}
function taCard(trip,{day=null,compact=false}={}){
  const tasks=taTasks(trip,day),counts=taCounts(trip,tasks,day),status=trip.status==='completed'?'Completed':trip.status==='paused'?'Paused':counts.attention?'Needs attention':trip.readiness?.checking?'Checks queued':'Active';
  const pieces=[counts.ready+' ready',counts.attention+' need attention',counts.unknown?counts.unknown+' to verify':''].filter(Boolean),next=trip.nextStop;
  const open=tc.open.has(trip.id),busy=tc.busy?' disabled':'',notice=taNotice.owner===jhUser?.id&&taNotice.tripId===trip.id?taNotice.text:'';
  const protectedCount=Number(trip.protectedBookingCount)||0,checkedAt=trip.readiness?.checkedAt||trip.checkedAt;
  return '<section class="tc-card ta-card'+(compact?' ta-compact':'')+'" data-care-id="'+esc(trip.id)+'" aria-label="Trip agent"><div class="ta-header"><span class="tc-orb" aria-hidden="true">'+ic('sparkle',18)+'</span><div><strong>Trip agent</strong><p>'+(day?'Day '+day+' · ':'')+pieces.join(' · ')+'</p></div><span class="tc-state '+(counts.attention?'attention':'')+'">'+status+'</span></div>'+(!compact&&next?'<p class="ta-next"><span>Next · '+esc(next.start||tcLocalTime(next.startsAt,trip.city))+'</span><strong>'+esc(tcName(next,trip))+'</strong></p>':'')+(notice?'<p class="ta-result" role="status">'+ic('check',15)+esc(notice)+'</p>':'')+'<details class="tc-details ta-details" data-care-details="'+esc(trip.id)+'"'+(open?' open':'')+'><summary><span>'+(trip.proposal?'Review suggested change':counts.attention||counts.unknown?'View checks & actions':'View trip support')+'</span>'+ic('down',15)+'</summary><div class="tc-details-body"><div class="tc-check-head"><span>'+esc(checkedAt?'Checked '+taStamp(checkedAt,trip.city):'Not checked yet')+'</span><button data-act="tcCheck" data-a="'+esc(trip.id)+'"'+busy+'>'+(tc.busy?'Checking…':'Check now')+'</button></div>'+(tasks.length?'<ul class="ta-tasks">'+tasks.map(t=>taTaskHTML(t,trip)).join('')+'</ul>':'<p class="tc-muted">Saved visits are available. Run a check to review booking and visit information.</p>')+taProposalHTML(trip)+(trip.status==='active'?'<div class="tc-adjust"><strong>Something changed?</strong><div><button data-act="tcEvent" data-a="'+esc(trip.id)+'" data-b="delay"'+busy+'>30 min late</button><button data-act="tcEvent" data-a="'+esc(trip.id)+'" data-b="rain"'+busy+'>Rain</button><button data-act="tcEvent" data-a="'+esc(trip.id)+'" data-b="closure"'+busy+'>Place closed</button></div><small>The agent prepares a change for you to review.</small></div>':'')+'<div class="ta-booking-action"><button data-act="taBooking" data-a="'+esc(trip.id)+'"'+busy+'>'+ic('ticket',16)+' Review reservations & budget '+ic('right',15)+'</button>'+(protectedCount?'<small>'+protectedCount+' existing reservation'+(protectedCount===1?' is':'s are')+' protected from automatic changes.</small>':'')+'</div>'+taActivityHTML(trip)+'<p class="tc-scope">Reservations use virtual credits. Venue availability and official requirements remain separate checks.</p>'+(trip.status==='active'?'<button class="tc-pause" data-act="tcStop" data-a="'+esc(trip.id)+'"'+busy+'>Pause trip support</button>':trip.status==='paused'?'<button class="tc-pause" data-act="taResume" data-a="'+esc(trip.id)+'"'+busy+'>Resume trip support</button>':'')+'</div></details></section>';
}
tcCard=trip=>taCard(trip);
A.taBooking=id=>{const trip=taTrip(id);if(!trip||tc.busy)return;A.dwReview(trip.sourceType,trip.sourceId);};
A.taResume=id=>{const trip=taTrip(id);if(!trip||trip.status!=='paused'||tc.busy)return;return tcChange({action:'care_confirm',[trip.sourceType==='history'?'historyId':'runId']:trip.sourceId});};
A.taTask=(id,taskId)=>{
  const trip=taTrip(id),task=trip?.readiness?.tasks?.find(t=>t.id===taskId);if(!task||tc.busy)return;
  if(task.action==='booking')return A.taBooking(id);
  if(task.action==='check')return A.tcCheck(id);
  tc.open.add(id);
  if(task.action==='review'){if(!trip.proposal)return A.tcCheck(id);render();document.querySelector('[data-care-id="'+CSS.escape(id)+'"] .ta-proposal')?.scrollIntoView({block:'nearest',behavior:'smooth'});return;}
  if(task.action==='details'){
    const event=typeof calEvents==='function'?calEvents().find(e=>e.manageKind===trip.sourceType&&e.manageId===trip.sourceId&&e.stops.some(s=>s.id===task.stopId)):null;
    if(event&&typeof A.cvOpen==='function')return A.cvOpen(event.key,task.stopId);
    if(trip.sourceType==='history'&&typeof A.calOpenHistory==='function'){go('orders');return A.calOpenHistory(trip.sourceId,trip.stops?.find(s=>s.id===task.stopId)?.dayIndex||1);}
    if(trip.sourceType==='run'&&typeof A.calOpenRun==='function'){go('orders');return A.calOpenRun(trip.sourceId);}
  }
};
const taPreviousChange=tcChange;
tcChange=async function(payload,options){
  const owner=jhUser?.id,before=taTrip(payload.id)?.revision;taNotice={owner,tripId:payload.id||null,text:''};taRetryCheck={owner:null,id:null};
  const trip=await taPreviousChange(payload,options);
  if(owner!==jhUser?.id)return trip;
  if(!trip){if(payload.action==='care_check'&&tc.error){taRetryCheck={owner,id:payload.id};tcRender();}return trip;}
  const text=payload.action==='care_accept'?(Number(trip.revision)>Number(before)&&!trip.proposal?'Adjustment saved. Existing reservations are unchanged.':'Trip status refreshed. Review the saved result.'):payload.action==='care_check'?'Trip checks refreshed.':payload.action==='care_stop'?'Trip support paused.':payload.action==='care_confirm'?'Trip support is active.':'';
  taNotice={owner,tripId:trip.id,text};
  if(payload.action==='care_accept')tcSyncItinerary(trip);
  tcRender();return trip;
};
const taPreviousError=tcError;
tcError=function(){const html=taPreviousError();return taRetryCheck.owner===jhUser?.id&&taTrip(taRetryCheck.id)?html.replace('data-act="tcRefresh"','data-act="taRetryCheck"'):html;};
A.taRetryCheck=()=>taRetryCheck.owner===jhUser?.id?A.tcCheck(taRetryCheck.id):tcLoad(true);
function taStartHTML(event){
  return '<section class="ta-start" aria-label="Trip agent"><div><span class="tc-orb" aria-hidden="true">'+ic('sparkle',18)+'</span><span><strong>Trip agent</strong><small>Visit checks, reservations & changes</small></span></div><button data-act="taStart" data-a="'+esc(event.manageKind)+'" data-b="'+esc(event.manageId)+'"'+(tc.busy?' disabled':'')+'>'+(tc.busy?'Starting…':'Confirm & start')+' '+ic('right',14)+'</button></section>';
}
A.taStart=(type,id)=>{
  if(!['history','run'].includes(type)||tc.busy||!jhUser?.id)return;
  const event=calEvents().find(e=>e.manageKind===type&&e.manageId===id&&e.kind==='plan'&&!e.sample);if(!event)return;
  return tcChange({action:'care_confirm',[type==='history'?'historyId':'runId']:id},{silent:true});
};
// Put the selected day's agent next to that day's schedule, never unrelated trips.
const taCalendarView=V.orders;
V.orders=()=>{
  const view=taCalendarView();if(!jhUser?.id||!traveler())return view;
  const event=calEvents().find(e=>e.date===cal.date&&e.kind==='plan'&&e.manageKind&&e.manageId&&!e.sample);if(!event)return view;
  const t=document.createElement('template');t.innerHTML=view.body;
  const plan=t.content.querySelector('.cal-day-plan');if(!plan)return view;
  const trip=tcFor(event.manageKind,event.manageId),html=trip?taCard(trip,{day:event.day,compact:true}):taStartHTML(event);
  const heading=plan.querySelector('.cal-plan-heading');if(heading)heading.insertAdjacentHTML('afterend',html);else plan.insertAdjacentHTML('afterbegin',html);
  // One entry point covers readiness and budget; remove the previous duplicate.
  plan.querySelector('.dw-day-agent')?.remove();
  if(tc.error)plan.insertAdjacentHTML('afterbegin',tcError());
  view.body=t.innerHTML;return view;
};
const taPlaceView=V['place-plan'];
V['place-plan']=()=>{
  const view=taPlaceView(),t=document.createElement('template');t.innerHTML=view.body;
  if(t.content.querySelector('.ta-card'))t.content.querySelector('.dw-agent-invite')?.remove();
  view.body=t.innerHTML;return view;
};
const taCalendarRefresh=A.calRefresh;
A.calRefresh=async()=>{await Promise.allSettled([taCalendarRefresh(),tcLoad(true)]);};
