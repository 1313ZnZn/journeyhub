/* Account-owned removals are reversible; reservation cancellation is a separate action. */
const cmFresh=owner=>({owner,removed:[],loaded:false,loading:false,error:'',busy:false,confirm:null,version:0});
let cm=cmFresh(jhUser?.id||null);
const cmCurrent=ctx=>cm===ctx&&ctx.owner===(jhUser?.id||null);
function cmError(error){
  const text=String(error?.message||error||'');
  const conflict=typeof agConflictDate==='function'?agConflictDate(text):'';
  if(conflict)return 'There is already a plan on '+conflict+'. Delete that plan before restoring this one.';
  const messages={PLAN_BUSY:'This plan is still being generated or booked. Try again when it finishes.',REMINDER_IN_PROGRESS:'A reminder is being processed. Please retry shortly.',ACTIVE_RESERVATION_REQUIRES_CANCELLATION:'This reservation is still active. Cancel it before removing its calendar record.',RESERVATION_CANNOT_BE_CANCELLED:'This reservation has started, been checked in or already ended. Refresh to see its current status.',PLAN_REMOVED:'This plan has been deleted. Restore it from Removed items first.',CALENDAR_ITEM_NOT_FOUND:'This item is no longer available. Refresh your calendar.'};
  const code=Object.keys(messages).find(key=>text.includes(key));return code?messages[code]:agErrorText(error);
}
function cmScope(){const owner=jhUser?.id||null;if(cm.owner!==owner){cm=cmFresh(owner);if(ui.sheet?.type==='calendar-manage')ui.sheet=null;}}
function cmHidden(kind,id){return cm.owner===(jhUser?.id||null)&&cm.removed.some(row=>row.kind===kind&&row.id===id);}
function cmRows(result){if(!Array.isArray(result?.removed))throw Error('Your calendar settings could not load. Please retry.');return result.removed.filter(row=>['history','run','booking'].includes(row.kind)&&typeof row.id==='string');}
async function cmLoad(force=false){
  cmScope();const ctx=cm;if(!ctx.owner||ctx.loading||ctx.busy||(!force&&ctx.loaded))return;
  ctx.loading=true;ctx.error='';const version=++ctx.version;
  try{const result=await agRPC('journeyhub_calendar_state',{});if(!cmCurrent(ctx)||ctx.version!==version)return;ctx.removed=cmRows(result);ctx.loaded=true;}
  catch(error){if(cmCurrent(ctx)&&ctx.version===version)ctx.error=cmError(error);}
  finally{if(cmCurrent(ctx)&&ctx.version===version){ctx.loading=false;render();}}
}
const cmCanCancel=booking=>{
  const session=DBC.sessions[booking?.slot];
  if(!booking||!isMine(booking)||booking.checkedIn||booking.status!=='confirmed'||!session)return false;
  // The database rechecks the exact start time and check-in state atomically.
  if(session.startsAt&&Number.isFinite(Date.parse(session.startsAt)))return Date.parse(session.startsAt)>Date.now();
  const now=new Intl.DateTimeFormat('en-CA',{timeZone:session.timeZone||calZone(EXPS[booking.exp]?.city),year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const parts=Object.fromEntries(now.map(p=>[p.type,p.value])),today=parts.year+'-'+parts.month+'-'+parts.day;
  return calDate(session.date)>today;
};
function cmRecord(kind,id){
  if(kind==='booking'){const b=DBC.bookings[id];if(!b||!isMine(b))return null;return {kind,id,title:EXPS[b.exp]?.name||'Reservation',action:cmCanCancel(b)?'cancel':'remove'};}
  if(!['history','run'].includes(kind))return null;
  const source=kind==='history'?(th.owner===cm.owner?th.items.find(item=>item.id===id):null):(ag.owner===cm.owner?ag.runs.find(item=>item.id===id):null);
  const care=tc.owner===cm.owner?tc.trips.find(trip=>trip.sourceType===kind&&trip.sourceId===id):null;
  if(!source&&!care)return null;
  const input=care||source?.input||agPlan(source)||{};
  return {kind,id,title:(input.city||'Your trip')+' plan',action:'remove'};
}
function cmShow(record){
  if(!record||!cm.owner||cm.busy)return;
  cm.confirm={...record,requestId:crypto.randomUUID(),error:''};
  ui.sheet={type:'calendar-manage',id:record.kind+':'+record.id};render();
}
A.cmAsk=(kind,id)=>{cmScope();if(!cm.loaded||cmHidden(kind,id))return;cmShow(cmRecord(kind,id));};
A.cmRestore=(kind,id)=>{cmScope();const row=cm.removed.find(item=>item.kind===kind&&item.id===id);if(row)cmShow({...row,action:'restore'});};
A.cmDismiss=()=>{if(cm.busy)return;cm.confirm=null;if(ui.sheet?.type==='calendar-manage')ui.sheet=null;render();};
A.cmRefresh=()=>cmLoad(true);
async function cmRestoreSource(ctx,item){
  if(!cmCurrent(ctx)||item.kind==='booking')return;
  if(item.kind==='run'){
    if(ag.owner===ctx.owner&&ag.runs.some(run=>run.id===item.id))return;
    const run=await agLoadRun(item.id,{quiet:true});if(!cmCurrent(ctx)||ag.owner!==ctx.owner)return;
    if(!run)throw Error('Plan restored, but its details could not load. Refresh your calendar to retry.');
    // Restoring an old run may fall outside the 20 most recent summaries.
    if(!ag.runs.some(row=>row.id===run.id))ag.runs.push(run);
    return;
  }
  thScope();const history=th;
  const current=()=>cmCurrent(ctx)&&th===history&&history.owner===ctx.owner;
  let waits=0;while(current()&&history.loading&&waits++<300)await new Promise(resolve=>setTimeout(resolve,50));
  if(!current())return;
  if(history.loading)throw Error('Plan restored. Open Trip history once the current update finishes.');
  if(history.items.some(row=>row.id===item.id))return;
  // Read account-owned summaries only; history_open would call the place provider.
  if(!history.loaded||!history.cursor)await thLoad();
  let pages=0;while(current()&&!history.items.some(row=>row.id===item.id)&&history.cursor&&!history.error&&pages++<50)await thLoad(true);
  if(!current())return;
  if(!history.items.some(row=>row.id===item.id))throw Error('Plan restored, but its details could not load. Open Trip history and load older trips to find it.');
}
A.cmConfirm=async()=>{
  cmScope();const ctx=cm,item=ctx.confirm;if(!ctx.owner||!item||ctx.busy)return;
  ctx.busy=true;ctx.loading=false;ctx.version++;item.error='';render();
  try{
    const result=await agRPC('journeyhub_calendar_manage',{p_kind:item.kind,p_id:item.id,p_action:item.action,p_request_id:item.requestId});
    if(!cmCurrent(ctx))return;
    if(!result?.ok)throw Error('This item could not be updated. Please retry.');
    ctx.removed=cmRows(result);ctx.loaded=true;ctx.error='';
    if(item.action==='cancel'&&item.kind==='booking'&&DBC.bookings[item.id]){
      const booking=DBC.bookings[item.id];booking.status='cancelled';
      if(tc.owner===ctx.owner)tc.trips=tc.trips.map(trip=>trip.sourceType==='run'&&(trip.bookings||[]).some(b=>b.bookingId===item.id||b.id===booking.slot)?{...trip,status:'paused',proposal:null,bookings:trip.bookings.map(b=>b.bookingId===item.id||b.id===booking.slot?{...b,status:'cancelled'}:b)}:trip);
    }
    if(['history','run'].includes(item.kind)&&item.action==='remove'){
      th.openVersion++;th.opening=null;cal.openVersion++;cal.opening=null;
      if(tc.owner===ctx.owner)tc.trips=tc.trips.map(trip=>trip.sourceType===item.kind&&trip.sourceId===item.id?{...trip,status:'paused'}:trip);
      if(item.kind==='history'&&pd.historyId===item.id){clearTimeout(pd.historyTimer);pd=pdFresh();}
      if(item.kind==='run'&&ag.activeId===item.id){ag.activeId=null;ag.confirmChecked=false;}
    }
    ctx.confirm=null;if(ui.sheet?.type==='calendar-manage')ui.sheet=null;
    toast(item.action==='restore'?'Restored to your calendar':item.action==='cancel'?'Reservation cancelled':item.kind==='booking'?'Removed from calendar':'Plan deleted');
    render();
    // Cloud snapshots remain the source of truth for availability and tickets.
    if(item.action==='cancel')await Promise.allSettled([jhRefresh(),tcLoad(true),...(typeof dwLoad==='function'?[dwLoad(true)]:[])]);
    if(item.action==='restore')await cmRestoreSource(ctx,item);
    if(!cmCurrent(ctx))return;
  }catch(error){if(cmCurrent(ctx)){if(ctx.confirm===item)item.error=cmError(error);else ctx.error=cmError(error);}}
  finally{if(cmCurrent(ctx)){ctx.busy=false;render();}}
};
function cmActionButton(kind,id){
  const record=cmRecord(kind,id);if(!record||cmHidden(kind,id))return '';
  const label=record.action==='cancel'?'Cancel reservation':kind==='booking'?'Remove from calendar':'Delete plan';
  return '<button class="cm-manage-btn" data-act="cmAsk" data-a="'+esc(kind)+'" data-b="'+esc(id)+'"'+(!cm.loaded||cm.busy?' disabled':'')+'>'+label+'</button>';
}
const cmSheetView=sheetView;
sheetView=function(){
  if(ui.sheet?.type!=='calendar-manage'){
    const html=cmSheetView();
    if(ui.sheet?.type!=='ticket')return html;
    const action=cmActionButton('booking',ui.sheet.id);if(!action)return html;
    const template=document.createElement('template');template.innerHTML=html;
    template.content.querySelector('.sheet')?.insertAdjacentHTML('beforeend',(cm.error?'<div class="cal-error" role="alert">'+esc(cm.error)+' <button data-act="cmRefresh">Retry calendar settings</button></div>':'')+'<div class="cm-history-actions">'+action+'</div>');
    return template.innerHTML;
  }
  const item=cm.confirm;if(!item||!cmCurrent(cm))return '';
  const restore=item.action==='restore',cancel=item.action==='cancel',booking=item.kind==='booking';
  const heading=restore?'Restore this item?':cancel?'Cancel this reservation?':booking?'Remove from calendar?':'Delete this plan?';
  const explanation=restore?(booking?'Show this reservation again. Its booking status will not change.':'Show the full plan again. Trip support stays paused and no new reservations will be created.'):cancel?'Cancel this JourneyHub reservation, release its seats and pause linked trip support. Other reservations stay unchanged. Reserving again requires a new booking.':booking?'Hide this record from your calendar. Its reservation status and check-in record will stay unchanged.':'Remove all days of this plan and pause its trip support. Existing reservations will stay in your calendar. You can restore the plan from Removed items.';
  const action=restore?'Restore':cancel?'Cancel reservation':booking?'Remove':'Delete plan';
  return '<div class="scrim" data-act="scrim"><section class="sheet cm-confirm" role="dialog" aria-modal="true" aria-labelledby="cm-confirm-title"><span class="handle" aria-hidden="true"></span><h2 id="cm-confirm-title">'+heading+'</h2><strong>'+esc(item.title)+'</strong><p>'+explanation+'</p>'+(item.error?'<div class="cal-error" role="alert">'+esc(item.error)+'</div>':'')+'<div class="cm-confirm-actions"><button class="btn btn-soft" data-act="cmDismiss"'+(cm.busy?' disabled':'')+'>'+(restore?'Back':'Keep it')+'</button><button class="btn '+(restore?'btn-primary':'cm-danger')+'" data-act="cmConfirm"'+(cm.busy?' disabled':'')+'>'+(cm.busy?'Updating…':item.error?'Retry '+action.toLowerCase():action)+'</button></div></section></div>';
};
TAB_OF['calendar-removed']='orders';
V['calendar-removed']=()=>{
  cmScope();const ctx=cm;
  if(!ctx.owner)return {bar:bar({title:'Removed items'}),tabs:true,body:'<div class="cal-page"><div class="cal-empty"><h3>Your saved items</h3><p>Sign in to see removed plans and calendar records.</p><button class="btn btn-primary" data-act="calSignIn">Sign in</button></div></div>'};
  const rows=ctx.removed.map(item=>'<article class="cal-event cm-removed-card" data-kind="'+esc(item.kind)+'" data-id="'+esc(item.id)+'"><span class="cal-tag">'+(item.kind==='booking'?'Calendar record':'Deleted plan')+'</span><h3>'+esc(item.title||item.city||'Your trip')+'</h3>'+(calDate(item.date)?'<p class="cal-event-meta">'+esc(agDate(item.date))+'</p>':'')+'<div class="cal-event-action"><button data-act="cmRestore" data-a="'+esc(item.kind)+'" data-b="'+esc(item.id)+'"'+(ctx.busy?' disabled':'')+'>Restore '+ic('refresh',16)+'</button></div></article>').join('');
  return {bar:bar({title:'Removed items',right:'<button class="btn-text" data-act="cmRefresh"'+(ctx.loading?' disabled':'')+'>Refresh</button>'}),tabs:true,body:'<main class="cal-page cm-removed"><p class="cal-event-meta">Restore deleted plans and hidden calendar records here.</p>'+(ctx.error?'<div class="cal-error" role="alert">'+esc(ctx.error)+' <button data-act="cmRefresh">Retry</button></div>':'')+(ctx.loading?'<p class="cal-loading" role="status">Loading removed items…</p>':'')+'<div class="cal-agenda">'+(rows||(!ctx.loading&&ctx.loaded?'<div class="cal-empty"><h3>Nothing removed.</h3><p>Your plans are right where you left them.</p></div>':''))+'</div></main>'};
};
const cmHistory=agHistoryHTML;
agHistoryHTML=function(limit=3,filter=null){
  const template=document.createElement('template');template.innerHTML=cmHistory(limit,run=>!cmHidden('run',run.id)&&(!filter||filter(run)));
  for(const button of template.content.querySelectorAll('.ag-run[data-act="agOpen"]')){
    const action=cmActionButton('run',button.dataset.a);if(!action)continue;
    const row=document.createElement('article');row.className='cm-history-row cm-run-row';button.replaceWith(row);row.append(button);
    row.insertAdjacentHTML('beforeend','<div class="cm-history-actions">'+action+'</div>');
  }
  return template.innerHTML;
};
for(const route of ['trip-history','journey-drafts','reserved-trips','ai-history']){
  const previous=V[route];if(!previous)continue;
  V[route]=()=>{const view=previous();if(cm.error)view.body='<div class="content"><div class="cal-error" role="alert">'+esc(cm.error)+' <button data-act="cmRefresh">Retry calendar settings</button></div></div>'+view.body;return view;};
}
const cmOpenRun=A.agOpen;
A.agOpen=(id,...args)=>{if(cmHidden('run',id))return;return cmOpenRun(id,...args);};
const cmOpenHistory=A.thOpen;
A.thOpen=(id,...args)=>{if(cmHidden('history',id))return;return cmOpenHistory(id,...args);};
const cmCalRefresh=A.calRefresh;
A.calRefresh=async()=>{await Promise.allSettled([cmLoad(true),cmCalRefresh()]);};
const cmPreviousRender=render;
render=function(){
  cmScope();cmPreviousRender();const ctx=cm;
  if(ctx.owner&&traveler()&&!ctx.loaded&&!ctx.loading&&!ctx.error&&(ui.sheet?.type==='ticket'||['orders','trip-history','calendar-removed','reserved-trips','journey-drafts','ai-history'].includes(state.route)))Promise.resolve().then(()=>{if(cmCurrent(ctx))void cmLoad();});
};
