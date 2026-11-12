/* Date-based view of existing account records. Calendar never generates or books. */
const calDate=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return '';const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?value:'';};
const calAdd=(date,days)=>calDate(date)?new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10):'';
const calToday=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const calFormat=(date,options)=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',...options}).format(new Date(date+'T12:00:00Z'));
const calFresh=owner=>({owner,date:calToday(),month:calToday().slice(0,7),refreshing:false,error:'',opening:null,openVersion:0,details:{},detailVersion:0});
let cal=calFresh(jhUser?.id||null);
function calScope(){
  const owner=jhUser?.id||null;if(cal.owner===owner)return;
  cal=calFresh(owner);
  if(owner)try{const saved=JSON.parse(sessionStorage.getItem('journeyhub-calendar-'+owner)||'null');if(calDate(saved?.date)){cal.date=saved.date;cal.month=saved.date.slice(0,7);}}catch{}
}
function calSave(){if(cal.owner)try{sessionStorage.setItem('journeyhub-calendar-'+cal.owner,JSON.stringify({date:cal.date}));}catch{}}
function calSelect(date){if(!calDate(date))return;cal.date=date;cal.month=date.slice(0,7);calSave();render();}
A.calDate=calSelect;
A.calToday=()=>calSelect(calToday());
A.calMonth=step=>{if(![-1,1].includes(Number(step)))return;const d=new Date(cal.month+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+Number(step));calSelect(d.toISOString().slice(0,10));};
A.calSignIn=()=>openLogin('traveler',{route:'orders'});
const calZone=city=>({Bangkok:'Asia/Bangkok',Shanghai:'Asia/Shanghai',Singapore:'Asia/Singapore'})[city]||'UTC';
function calInstantDate(value,zone){if(!value||!Number.isFinite(Date.parse(value)))return '';try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));return calDate(p.year+'-'+p.month+'-'+p.day);}catch{return '';}}
const calTime=value=>/^\d{2}:\d{2}$/.test(value||'')?value:'';
function calStopTime(stop,zone){return calTime(stop.start)|| (stop.startsAt&&Number.isFinite(Date.parse(stop.startsAt))?agTime(stop.startsAt,stop.timeZone||zone):'');}
function calDayStops(stops,date,startDate,zone){return (stops||[]).filter(s=>(calInstantDate(s.startsAt,s.timeZone||zone)||calAdd(startDate,Math.max(0,(Number(s.dayIndex)||1)-1)))===date).sort((a,b)=>calStopTime(a,zone).localeCompare(calStopTime(b,zone)));}
const calReadableName=name=>typeof name==='string'&&name.trim()&&!/^(?:stop\s*\d+|scheduled (?:stop|visit)|place details unavailable)$/i.test(name.trim())&&!/\p{Script=Han}/u.test(name);
const calCurrent=ctx=>cal===ctx&&ctx.owner===(jhUser?.id||null);
function calStopTheme(stop){
  const kind=typeof stop.kind==='string'?stop.kind.toLowerCase():'',categories=(Array.isArray(stop.categories)?stop.categories:[]).filter(x=>typeof x==='string').join(' ').toLowerCase();
  const dining=/restaurant|cafe|café|coffee|bakery|food|dining|meal|tea house|teahouse|餐|咖啡|茶/;
  const sights=/museum|gallery|park|garden|landmark|historic|attraction|sight|temple|palace|monument|zoo|aquarium|beach|博物馆|景点|公园/;
  if(dining.test(kind))return {key:'dining',label:'Food & drink'};
  if(sights.test(kind))return {key:'sightseeing',label:'Sightseeing'};
  if(dining.test(categories))return {key:'dining',label:'Food & drink'};
  if(sights.test(categories))return {key:'sightseeing',label:'Sightseeing'};
  // A saved visit reason is used only when a provider category is absent.
  if(!kind&&/\b(lunch|dinner|breakfast|restaurant|cafe|coffee|matcha|meal|dining)\b/i.test(stop.reason||''))return {key:'dining',label:'Food & drink'};
  return {key:'sightseeing',label:'Visit'};
}
function calCarePlan(care,hydrated,input){
  if(!care?.stops)return hydrated||null;
  const originals=hydrated?.stops||[],lookup=new Map(originals.map(s=>[s.id||s.sessionId,s]));
  const stops=care.stops.map((s,index)=>{
    const id=s.id||s.sessionId,p=lookup.get(id)||{},before=care.stops[index-1],originalIndex=originals.findIndex(x=>(x.id||x.sessionId)===id),originalBefore=originals[originalIndex-1];
    const sameLeg=before&&before.dayIndex===s.dayIndex&&originalBefore&&(originalBefore.id||originalBefore.sessionId)===(before.id||before.sessionId)&&originalBefore.dayIndex===s.dayIndex;
    const acceptedLeg=before&&s.travel?.fromId===(before.id||before.sessionId)&&s.travel?.toId===id?s.travel:null;
    return {...p,...s,id,name:calReadableName(p.name)?p.name:s.name||p.name,address:p.address||s.address||'',kind:p.kind||s.kind||'',categories:p.categories||s.categories,source:p.source||s.source,lat:p.lat??s.lat,lng:p.lng??s.lng,coordinateSystem:p.coordinateSystem||s.coordinateSystem,originalName:p.originalName||s.originalName,reason:p.reason||s.reason||'',travel:acceptedLeg||(sameLeg?p.travel:null)};
  });
  return {...input,...hydrated,...care,transport:hydrated?.transport||input?.transport,stops};
}
function calTransferHTML(event,from,to){
  if(!from||!to)return '';
  const travel=to.travelFromId===from.id?to.travel:null,mode=travel?.mode||event.transport;
  const label={walk:'Walking',drive:'Car / taxi',transit:'Public transport',bicycle:'Cycling'}[mode]||'Travel';
  const minutes=travel?.durationMinutes,distance=travel?.distanceMeters,hasMinutes=typeof minutes==='number'&&Number.isFinite(minutes)&&minutes>=0,hasDistance=typeof distance==='number'&&Number.isFinite(distance)&&distance>=0;
  const measured=travel&&['Google Routes','Amap'].includes(travel.source),detail=[hasDistance?(distance/1000).toFixed(1)+' km':'',measured?travel.source:hasMinutes?'Estimated':'Check current directions'].filter(Boolean).join(' · ');
  const link=typeof tuDirectionsLink==='function'?tuDirectionsLink(from,to,mode):null;
  return '<li class="cal-transfer" aria-label="Travel to '+esc(to.name)+'"><div><strong>'+(hasMinutes?esc(minutes)+' min · ':'')+esc(label)+'</strong><small>'+esc(detail)+'</small></div>'+(link?'<a href="'+esc(link.href)+'" target="_blank" rel="noopener noreferrer" title="'+esc(link.title)+'">'+esc(link.label)+'</a>':'')+'</li>';
}
function calLatestPlans(events){
  // Historical versions remain in Trip history. Calendar presents one schedule
  // per date, consistently choosing the newest saved version.
  const chosen=new Map();
  for(const event of events.filter(e=>e.kind==='plan')){const before=chosen.get(event.date),stamp=e=>(Number.isFinite(Date.parse(e.savedAt))?Date.parse(e.savedAt):0),tie=e=>(e.manageKind||'')+'|'+(e.id||e.key);if(!before||stamp(event)>stamp(before)||(stamp(event)===stamp(before)&&tie(event)>tie(before)))chosen.set(event.date,event);}
  return events.filter(event=>event.kind!=='plan'||chosen.get(event.date)===event);
}
function calEvents(){
  const owner=jhUser?.id;if(!owner||!traveler())return [];
  const events=[],supported=(tc.owner===owner?tc.trips:[]).filter(t=>!cmHidden(t.sourceType,t.sourceId)),histories=(th.owner===owner?th.items:[]).filter(t=>!cmHidden('history',t.id)),runs=(ag.owner===owner?ag.runs:[]).filter(t=>!cmHidden('run',t.id));
  const allBookings=Object.values(DBC.bookings).filter(isMine),activeBookings=allBookings.filter(b=>b.status==='confirmed'),booked=allBookings.filter(b=>!cmHidden('booking',b.id)),allBookedSlots=new Set(activeBookings.map(b=>b.slot)),plannedSlots=new Set(runs.flatMap(r=>agPlan(r)?.stops?.map(s=>s.sessionId)||[])),seen=new Set();
  function addPlan(key,input,stops,options={}){
    const date=calDate(input.date);if(!date)return;
    const days=Math.max(1,Math.min(31,Number(input.days)||1)),zone=calZone(input.city);
    for(let i=0;i<days;i++){
      const day=calAdd(date,i),all=Array.isArray(stops)?calDayStops(stops,day,date,zone):null;
      // A booking changes this visit's status, never the saved itinerary itself.
      const daily=all,reservedOnly=false;
      const names=(daily||[]).map(s=>{const preceding=all[all.indexOf(s)-1],experience=EXPS[DBC.sessions[s.sessionId]?.exp];return {...s,id:s.id||s.sessionId,sessionId:s.sessionId,dayIndex:i+1,time:calStopTime(s,zone),start:calStopTime(s,zone),end:calTime(s.end)||(s.endsAt?agTime(s.endsAt,s.timeZone||zone):''),name:options.care?tcName(s,options.care):s.name||s.title||'Scheduled visit',address:s.address||s.venue||'',reason:s.reason||'',kind:s.kind||experience?.kind||'',categories:s.categories||experience?.cats||[],photo:s.photo||null,sourceURL:s.sourceURL||experience?.details?.source||'',openingHours:s.openingHours||experience?.details?.openingHours||[],visitInfo:s.visitInfo||experience?.details?.visitInfo||null,estimate:input.estimate?.items?.find(item=>item.stopId===(s.id||s.sessionId))||s.estimate||null,lat:s.lat??experience?.lat,lng:s.lng??experience?.lng,coordinateSystem:s.coordinateSystem,source:s.source,originalName:s.originalName,travel:s.travel||null,travelFromId:preceding?.id||preceding?.sessionId||null,unavailable:!!s.unavailable};});
      events.push({key:key+':'+i,date:day,kind:'plan',title:(input.city||'Your trip')+' · Day '+(i+1),city:input.city||'',transport:input.transport,time:names[0]?.time||'',stops:names,savedAt:options.savedAt,hasStops:Array.isArray(stops),hydrated:!!options.hydrated,reservedOnly,sample:options.sample,tag:options.sample?'Sample plan':options.draft?'Draft':options.pending?'Pending':'Planned',detail:daily?daily.length+' stop'+(daily.length===1?'':'s'):'Day '+(i+1)+' of '+days,action:options.action||'calOpenHistory',id:options.id,day:i+1,manageKind:options.manageKind,manageId:options.id});
    }
  }
  for(const item of histories){
    if(item.status!=='itinerary')continue;
    const care=supported.find(t=>t.sourceType==='history'&&t.sourceId===item.id);
    const live=pd.owner===owner&&pd.historyId===item.id?pd.plan:null,detail=cal.owner===owner?cal.details[item.id]?.plan:null;
    const hydrated=detail||live,effective=calCarePlan(care,hydrated,item.input);
    addPlan('history:'+item.id,effective||item.input||{},effective?.stops,{id:item.id,manageKind:'history',hydrated:!!hydrated,savedAt:item.updatedAt||item.createdAt,sample:String(item.input?.prompt||'').startsWith('[Sample]')});seen.add('history:'+item.id);
  }
  for(const run of runs){
    const plan=agPlan(run);if(!plan)continue;
    const care=supported.find(t=>t.sourceType==='run'&&t.sourceId===run.id);
    // Catalog plan carries session IDs; care rows alone do not always include them.
    const stops=care?.stops?.map(s=>({...plan.stops.find(p=>p.sessionId===s.id),...s}))||plan.stops;
    addPlan('run:'+run.id,care||plan,stops,{id:run.id,manageKind:'run',action:'calOpenRun',savedAt:run.createdAt,booked:run.status==='booked',pending:run.status==='queued',draft:run.status==='awaiting_confirmation'});seen.add('run:'+run.id);
  }
  for(const trip of supported){
    if(seen.has(trip.sourceType+':'+trip.sourceId))continue;
    addPlan('care:'+trip.id,trip,trip.stops,{id:trip.sourceId,manageKind:trip.sourceType,care:trip,savedAt:trip.createdAt,booked:trip.sourceType==='run'&&(runs.find(r=>r.id===trip.sourceId)?.status==='booked'||!!trip.bookings?.length),action:trip.sourceType==='run'?'calOpenRun':'calOpenHistory'});
  }
  for(const booking of booked){
    const s=DBC.sessions[booking.slot],e=EXPS[booking.exp];if(!s||!calDate(s.date))continue;
    events.push({key:'booking:'+booking.id,date:s.date,kind:'reservation',activityKind:e?.kind||'',categories:e?.cats||[],title:e?.name||'Reserved activity',city:e?.city||'',time:s.start||'',tag:booking.checkedIn?'Checked in':booking.status==='confirmed'?'Reserved':String(booking.status||'Reserved').replaceAll('_',' '),detail:(s.time||s.start||'')+' · '+booking.guests+' guest'+(booking.guests===1?'':'s'),action:'ticket',id:booking.id,stops:[],manageKind:'booking',manageId:booking.id});
  }
  // Keep cloud-saved legacy drafts visible when their sessions provide real dates.
  const draft=state.plan?.aiDraft;
  if(draft&&!draft.agentRunId&&Array.isArray(draft.stops)){
    const grouped=new Map();for(const id of draft.stops){const s=DBC.sessions[id];if(!s||!calDate(s.date)||allBookedSlots.has(id)||plannedSlots.has(id))continue;plannedSlots.add(id);const rows=grouped.get(s.date)||[];rows.push({sessionId:id,title:EXPS[s.exp]?.name||'Planned activity',start:s.start,startsAt:s.startsAt,timeZone:s.timeZone});grouped.set(s.date,rows);}
    for(const [date,stops]of grouped)addPlan('draft:'+date,{city:draft.city,date,days:1},stops,{id:'',action:'ixResume',draft:true});
  }
  const legacy=new Map();for(const stop of state.plan?.savedStops||[]){const session=DBC.sessions[stop.slot];if(!session||!calDate(session.date)||allBookedSlots.has(stop.slot)||plannedSlots.has(stop.slot))continue;plannedSlots.add(stop.slot);const city=EXPS[session.exp]?.city||'Your trip',key=city+':'+session.date,group=legacy.get(key)||{city,date:session.date,days:1,stops:[]};group.stops.push({sessionId:stop.slot,title:EXPS[session.exp]?.name||stop.title||'Planned activity',start:session.start,startsAt:session.startsAt,timeZone:session.timeZone});legacy.set(key,group);}
  for(const [key,group]of legacy)addPlan('legacy:'+key,group,group.stops,{id:'',action:'calOpenLegacy',draft:true});
  const latest=calLatestPlans(events),visiblePlans=latest.filter(e=>e.kind==='plan');
  return latest.filter(event=>event.kind!=='reservation'||!visiblePlans.some(plan=>plan.date===event.date&&plan.stops.some(stop=>{const booking=DBC.bookings[event.id];return stop.sessionId===booking?.slot||(booking?.sourceType===plan.manageKind&&booking.sourceId===plan.manageId&&booking.stopId===(stop.id||stop.sessionId));}))).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'99:99').localeCompare(b.time||'99:99')||a.title.localeCompare(b.title));
}
async function calLoadDay(event,{retry=false}={}){
  const ctx=cal,id=event?.id;
  if(!ctx.owner||state.route!=='orders'||event?.manageKind!=='history'||!id||cmHidden('history',id)||th.loading||cm.loading)return;
  if(event.hydrated)return;
  if(ctx.details[id]&&!retry)return;
  // Starting hydration may invalidate an older cached revision. Register this
  // day's loading record afterwards so that invalidation cannot orphan it.
  const hydration=thHydrate(id,{force:retry});
  const record={loading:true,error:'',plan:null},version=ctx.detailVersion;ctx.details[id]=record;
  render();
  try{
    const result=await hydration;
    if(!calCurrent(ctx)||version!==ctx.detailVersion)return;
    if(cmHidden('history',id)){delete ctx.details[id];return;}
    if((result.historyId&&result.historyId!==id)||!result.plan||!Array.isArray(result.plan.stops)||!calDate(result.plan.date)||calAdd(result.plan.date,event.day-1)!==event.date)throw Error('This saved itinerary is unavailable. Please retry.');
    record.plan=result.plan;record.snapshot=result.snapshot||null;
  }catch(error){if(calCurrent(ctx)&&version===ctx.detailVersion)record.error=agErrorText(error);}
  finally{if(calCurrent(ctx)&&version===ctx.detailVersion){record.loading=false;if(state.route==='orders')render();}}
}
A.calRetryDay=id=>{const event=calEvents().find(e=>e.id===id&&e.kind==='plan'&&e.date===cal.date);if(event)void calLoadDay(event,{retry:true});};
A.calOpenLegacy=()=>go('reserved-trips');
A.calOpenHistory=async(id,day)=>{
  calScope();const ctx=cal;if(ctx.opening||!ctx.owner||th.loading)return;ctx.opening=id;ctx.error='';render();
  try{
    // Older confirmed trips can outlive the first page of history. Load only DB summaries.
    if(!th.loaded)await thLoad();
    let pages=0;while(cal===ctx&&state.route==='orders'&&!th.items.some(x=>x.id===id)&&th.cursor&&!th.error&&pages++<50)await thLoad(true);
    if(cal!==ctx||state.route!=='orders')return;
    if(!th.items.some(x=>x.id===id))throw Error(th.error||'This trip could not be loaded. Open Trip history to retry.');
    await A.thOpen(id,{day:Number(day)});
  }catch(error){if(cal===ctx)ctx.error=agErrorText(error);}
  finally{if(cal===ctx){ctx.opening=null;render();}}
};
A.calOpenRun=async id=>{
  calScope();const ctx=cal;if(!ctx.owner||ctx.opening||ag.busy)return;
  const version=++ctx.openVersion;ctx.opening=id;ctx.error='';render();
  try{const run=await agLoadRun(id,{quiet:true});if(cal!==ctx||ctx.openVersion!==version||state.route!=='orders')return;if(!run)throw Error(ag.error||'This plan could not open. Please retry.');agStore(run,true);ctx.opening=null;go('ai-plan',{fromCalendar:true});}
  catch(error){if(cal===ctx&&ctx.openVersion===version)ctx.error=agErrorText(error);}
  finally{if(cal===ctx&&ctx.openVersion===version){ctx.opening=null;render();}}
};
A.calRefresh=async()=>{
  calScope();const ctx=cal;if(!ctx.owner||ctx.refreshing)return;ctx.refreshing=true;ctx.error='';ctx.details={};ctx.detailVersion++;if(typeof thForgetHydration==='function')thForgetHydration(th);render();
  const results=await Promise.allSettled([thLoad(),agLoadRuns(true),jhRefresh()]);
  if(cal!==ctx)return;ctx.error=results.filter(r=>r.status==='rejected').map(r=>agErrorText(r.reason)).join(' ');ctx.refreshing=false;render();
};
A.calMore=()=>thLoad(true);
function calCard(event){
  const busy=!!cal.opening||!!th.opening||(event.action==='calOpenHistory'&&th.loading);
  if(event.kind==='plan'){
    const detail=cal.details[event.id],ready=event.hasStops&&(event.manageKind!=='history'||event.stops.every(s=>calReadableName(s.name)||s.unavailable));
    const rows=ready?event.stops.map((s,i)=>{const transfer=i?calTransferHTML(event,event.stops[i-1],s):'';if(typeof cvStopHTML==='function')return transfer+cvStopHTML(event,s,i);const theme=calStopTheme(s);return transfer+'<li class="cal-schedule-stop cal-stop-'+theme.key+'" data-stop-id="'+esc(s.id||'')+'"><div class="cal-schedule-time"><span class="cal-stop-dot">'+(i+1)+'</span><time>'+esc(s.time||'Time not set')+(s.end?'–'+esc(s.end):'')+'</time><span class="cal-stop-category">'+theme.label+'</span></div><h4>'+esc(calReadableName(s.name)?s.name:'Place details unavailable')+'</h4>'+(s.address?'<p class="cal-stop-address">'+ic('pin',15)+'<span>'+esc(s.address)+'</span></p>':'')+(s.reason?'<p class="cal-stop-reason">'+esc(s.reason)+'</p>':'')+(typeof dwStopHTML==='function'?dwStopHTML(event,s):'')+'</li>';}).join(''):'';
    const content=ready?(rows?'<ol class="cal-event-stops cal-schedule">'+rows+'</ol>':'<p class="cal-day-status">No visits were saved for this day.</p>'):detail?.error?'<div class="cal-day-status cal-day-error" role="alert">'+esc(detail.error)+'<button data-act="calRetryDay" data-a="'+esc(event.id)+'">Retry day</button></div>':'<div class="cal-day-status" role="status">Loading your day…</div>';
    return '<section class="cal-event cal-day-plan" data-kind="plan"><div class="cal-plan-heading"><h3>'+esc(event.title)+'</h3><span class="cal-tag '+(event.sample?'sample':'planned')+'">'+esc(event.tag)+'</span></div>'+(event.manageKind==='history'&&typeof thSnapshotHTML==='function'?thSnapshotHTML(event.id):'')+content+(typeof dwDayHTML==='function'?dwDayHTML(event):'')+'<div class="cal-event-action">'+(event.manageKind?cmActionButton(event.manageKind,event.manageId):'')+'<button data-act="'+event.action+'" data-a="'+esc(event.id||'')+'" data-b="'+(event.day||'')+'"'+(busy?' disabled':'')+'>'+(cal.opening===event.id?'Opening…':'Map & details')+' '+ic('right',16)+'</button></div></section>';
  }
  const theme=calStopTheme({kind:event.activityKind,categories:event.categories});
  return '<article class="cal-event cal-reservation-'+theme.key+'" data-kind="'+event.kind+'"><div class="cal-event-top"><time>'+esc(event.time||'Day plan')+'</time><span class="cal-tag reserved">'+esc(event.tag)+'</span></div><h3>'+esc(event.title)+'</h3><p class="cal-reservation-category">'+theme.label+'</p><p class="cal-event-meta">'+esc([event.city,event.detail].filter(Boolean).join(' · '))+'</p><div class="cal-event-action">'+(event.manageKind?cmActionButton(event.manageKind,event.manageId):'')+'<button data-act="'+event.action+'" data-a="'+esc(event.id||'')+'"'+(busy?' disabled':'')+'>View reservation '+ic('right',16)+'</button></div></article>';
}
const calPurchaseView=V.orders;
V.purchases=()=>{const view=calPurchaseView();view.bar=bar({title:'Purchases'});const t=document.createElement('template');t.innerHTML=view.body;t.content.querySelector('.jh-explore-reservations')?.remove();view.body=t.innerHTML;return view;};
TAB_OF.purchases='orders';
V.orders=()=>{
  calScope();thScope();tcScope();const ctx=cal;
  const header='<header class="bar top"><h1 class="h1" style="flex:1">Calendar</h1>'+(ctx.owner?'<button class="icon-btn" data-act="calRefresh" aria-label="Refresh calendar"'+(ctx.refreshing?' disabled':'')+'>'+ic('refresh',20)+'</button>':'')+'</header>';
  if(!ctx.owner||!traveler())return {bar:header,tabs:true,body:'<div class="cal-page"><div class="cal-empty">'+ic('calendar',36)+'<h3>Your travels, day by day.</h3><p>Sign in to see your saved plans and reservations.</p><button class="btn btn-primary" data-act="calSignIn">Sign in</button></div></div>'};
  const events=calEvents(),daily=events.filter(e=>e.date===ctx.date),first=ctx.month+'-01',offset=(new Date(first+'T12:00:00Z').getUTCDay()+6)%7;
  const end=new Date(first+'T12:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  const count=Math.ceil((offset+end.getUTCDate())/7)*7,today=calToday();
  const days=Array.from({length:count},(_,i)=>{const date=calAdd(first,i-offset),marks=events.filter(e=>e.date===date),kinds=[...new Set(marks.map(e=>e.kind))];return '<button class="cal-day '+(date===today?'is-today ':'')+(date.slice(0,7)!==ctx.month?'is-outside':'')+'" data-act="calDate" data-a="'+date+'" aria-label="'+calFormat(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})+(marks.length?', '+marks.length+' plans or reservations':'')+'" aria-pressed="'+(date===ctx.date)+'"'+(date===today?' aria-current="date"':'')+'><span class="cal-day-number">'+Number(date.slice(-2))+'</span><span class="cal-dots" aria-hidden="true">'+kinds.map(kind=>'<i class="'+(kind==='reservation'?'reserved':'planned')+'"></i>').join('')+'</span></button>';}).join('');
  const error=[ctx.error,th.error,ag.error,cm.error].filter(Boolean).join(' '),loading=ctx.refreshing||th.loading||ag.loading||cm.loading;
  return {bar:header,tabs:true,body:'<main class="cal-page"><section class="cal-month" aria-label="Travel calendar"><div class="cal-toolbar"><div class="cal-month-title"><h2>'+calFormat(first,{month:'long'})+'</h2><small>'+first.slice(0,4)+'</small></div><div class="cal-month-nav"><button data-act="calMonth" data-a="-1" aria-label="Previous month">'+ic('left',18)+'</button><button data-act="calToday">Today</button><button data-act="calMonth" data-a="1" aria-label="Next month">'+ic('right',18)+'</button></div></div><div class="cal-weekdays" aria-hidden="true">'+['M','T','W','T','F','S','S'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="cal-grid" role="group" aria-label="Choose a date">'+days+'</div><div class="cal-legend"><span><i class="planned"></i>Plans</span><span><i class="reserved"></i>Reservations</span></div></section><div class="cal-agenda-head"><h2>'+calFormat(ctx.date,{weekday:'short',day:'numeric',month:'short'})+'</h2><small>Times at destination</small></div>'+(loading?'<p class="cal-loading" role="status">Updating your calendar…</p>':'')+(error?'<div class="cal-error" role="alert">'+esc(error)+'<button data-act="calRefresh">Retry</button></div>':'')+'<div class="cal-agenda">'+(daily.length?daily.map(calCard).join(''):'<div class="cal-empty">'+ic('calendar',28)+'<h3>A little room for adventure.</h3><p>No plans for this day.</p><button class="btn btn-soft" data-act="tab" data-a="journey">Plan a trip</button></div>')+'</div>'+(th.cursor?'<button class="cal-more" data-act="calMore"'+(th.loading?' disabled':'')+'>Load older saved trips</button>':'')+'<nav class="cal-tools" aria-label="Calendar shortcuts"><button data-act="go" data-a="reserved-trips">'+ic('ticket',18)+'All reservations</button><button data-act="go" data-a="purchases">'+ic('bag',18)+'Purchases'+(myOrders().length?' · '+myOrders().length:'')+'</button><button data-act="go" data-a="calendar-removed">'+ic('refresh',18)+'Removed items</button></nav></main>',after:()=>{if(ctx!==cal||!ctx.owner)return;if(typeof calWeatherAttach==="function")calWeatherAttach(ctx,events);if(!th.loaded&&!th.loading&&!th.error){void thLoad();return;}if(th.loaded&&!th.loading&&!ctx.refreshing&&!cm.loading&&cm.loaded){const event=calEvents().find(e=>e.date===ctx.date&&e.kind==='plan');if(event)void calLoadDay(event);}}};
};
const calPreviousRender=render;let calLastRoute=state.route;
render=function(){calScope();if(calLastRoute!==state.route){if(calLastRoute==='orders'){cal.openVersion++;cal.opening=null;}calLastRoute=state.route;}TAB_OF['place-plan']=state.params?.fromCalendar?'orders':'journey';calPreviousRender();};
