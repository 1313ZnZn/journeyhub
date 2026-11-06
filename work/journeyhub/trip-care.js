/* Confirm once; account-owned support continues on the server. */
const tcFresh=owner=>({owner,trips:[],loaded:false,loading:false,busy:false,error:'',open:new Set(),loadVersion:0});
let tc=tcFresh(jhUser?.id||null);
const tcCurrent=ctx=>tc===ctx&&ctx.owner===(jhUser?.id||null);
function tcScope(){const owner=jhUser?.id||null;if(tc.owner!==owner)tc=tcFresh(owner);}
const tcEditing=()=>!!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]');
const tcRender=()=>{if(!tcEditing())render();};
async function tcRequest(payload,ctx){
  const {data,error}=await sb.auth.getSession();if(error)throw error;
  if(!tcCurrent(ctx)||!data.session||data.session.user.id!==ctx.owner)throw Error('Please sign in again to manage your trip.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  try{const response=await fetch(jhConfig.url+'/functions/v1/journeyhub-agent',{method:'POST',headers:{'Content-Type':'application/json',apikey:jhConfig.publishableKey,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(payload),signal:controller.signal});const body=await response.json();if(!response.ok)throw Error(body?.error?.message||'Trip support could not update. Please retry.');if(tcCurrent(ctx)&&payload.action!=='care_status'&&typeof jhInvalidateSnapshot==='function')jhInvalidateSnapshot();return body;}finally{clearTimeout(timer);}
}
function tcStore(ctx,trip){if(!trip||typeof trip.id!=='string'||!['history','run'].includes(trip.sourceType))throw Error('Trip support returned an incomplete status.');ctx.trips=[trip,...ctx.trips.filter(t=>t.id!==trip.id)];ctx.loaded=true;}
function tcSyncItinerary(trip){
  if(!trip||trip.sourceType!=='history'||trip.sourceId!==pd.historyId||!pd.plan||!Array.isArray(trip.stops))return;
  const key=stops=>JSON.stringify(stops.map(s=>[s.id,s.dayIndex,s.start,s.end]));if(key(trip.stops)===key(pd.plan.stops))return;
  const lookup=new Map([...pd.places,...pd.plan.stops].map(s=>[s.id,s]));
  // A replacement can come from the server's saved candidate cards. Keep its
  // actual photo, source and coordinates instead of reducing it to a label.
  for(const s of trip.stops)if(!lookup.has(s.id)&&typeof s.name==='string'&&s.name.trim()&&Number.isFinite(s.lat)&&Number.isFinite(s.lng))lookup.set(s.id,s);
  if(trip.stops.some(s=>!lookup.has(s.id)))return;
  const topology=JSON.stringify(trip.stops.map(s=>[s.id,s.dayIndex]))!==JSON.stringify(pd.plan.stops.map(s=>[s.id,s.dayIndex]));
  const stops=trip.stops.map(s=>({...lookup.get(s.id),...s,name:lookup.get(s.id).name||s.name,address:lookup.get(s.id).address||s.address,photo:lookup.get(s.id).photo||s.photo,dayIndex:s.dayIndex,start:s.start,end:s.end,travel:s.travel||(topology?null:lookup.get(s.id).travel)}));
  for(const s of stops)if(!pd.places.some(p=>p.id===s.id))pd.places.push({...s});
  pd.plan={...pd.plan,stops,supportAdjusted:true,...(trip.roadRoutes?.length?{roadRoutes:trip.roadRoutes}:topology?{roadRoutes:Array.from({length:pd.plan.days},(_,i)=>({day:i+1,status:'unavailable',message:'Adjusted itinerary. Check directions for the updated stops.'}))}:{})};
}
async function tcLoad(force=false){
  tcScope();const ctx=tc;if(!ctx.owner||ctx.loading||ctx.busy||(!force&&ctx.loaded))return;ctx.loading=true;const version=++ctx.loadVersion;
  try{const result=await tcRequest({action:'care_status'},ctx);if(!tcCurrent(ctx)||version!==ctx.loadVersion)return;if(!Array.isArray(result.trips))throw Error('Trip support could not load.');ctx.trips=result.trips;ctx.loaded=true;ctx.error='';}
  catch(e){if(tcCurrent(ctx))ctx.error=agErrorText(e);}
  finally{if(tcCurrent(ctx)){ctx.loading=false;tcRender();}}
}
async function tcChange(payload,{silent=false}={}){
  tcScope();const ctx=tc;if(!ctx.owner||ctx.busy)return null;ctx.busy=true;ctx.error='';ctx.loadVersion++;tcRender();
  try{const result=await tcRequest(payload,ctx);if(!tcCurrent(ctx))return null;tcStore(ctx,result.trip);if(!silent)ctx.open.add(result.trip.id);return result.trip;}
  catch(e){if(tcCurrent(ctx))ctx.error=agErrorText(e);return null;}
  finally{if(tcCurrent(ctx)){ctx.busy=false;tcRender();}}
}
const tcFor=(sourceType,sourceId)=>tc.trips.find(t=>t.sourceType===sourceType&&t.sourceId===sourceId);
const tcURL=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:'';}catch{return '';}};
function tcLocalTime(value,city){try{return new Intl.DateTimeFormat('en-GB',{timeZone:({Bangkok:'Asia/Bangkok',Shanghai:'Asia/Shanghai',Singapore:'Asia/Singapore'})[city]||'UTC',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}catch{return '';}}
function tcDateContext(trip,now=new Date()){
  const zone=({Bangkok:'Asia/Bangkok',Shanghai:'Asia/Shanghai',Singapore:'Asia/Singapore'})[trip.city]||'UTC',local=value=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;};
  let date=trip.date;try{if(trip.nextStop?.startsAt)date=local(trip.nextStop.startsAt);else if(/^\d{4}-\d{2}-\d{2}$/.test(date))date=new Date(Date.parse(date+'T12:00:00Z')+(Math.max(1,Number(trip.nextStop?.dayIndex)||1)-1)*86400000).toISOString().slice(0,10);}catch{}
  let today=false,label='';try{today=date===local(now);if(/^\d{4}-\d{2}-\d{2}$/.test(date))label=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short'}).format(new Date(date+'T12:00:00Z'));}catch{}
  return {heading:trip.status==='completed'?'TRIP COMPLETE':trip.status==='paused'?'PAUSED':today?'TODAY':'UPCOMING',label:today?'Today':label};
}
function tcName(stop,trip){return (trip?.sourceType==='history'&&trip.sourceId===pd.historyId?pd.places?.find(p=>p.id===stop?.id)?.name:null)||stop?.name||'Scheduled stop';}
function tcBookingHTML(booking,trip,bookingLabel){
  const supplier=booking.supplier,verified=supplier?.relevance?.version===1&&supplier.relevance.placeId===booking.id;
  const offers=verified?(supplier.offers||[]).filter(o=>tcURL(o.url)):[];
  const detail=supplier&&!verified?'Check tickets or table availability with the venue.':booking.detail||'';
  return '<article><div><strong>'+esc(tcName(booking,trip))+'</strong><span class="tc-booking-state">'+esc(bookingLabel(booking.status))+'</span></div><p>'+esc(detail)+'</p>'+offers.map(o=>'<p><a href="'+esc(tcURL(o.url))+'" target="_blank" rel="noopener noreferrer">'+esc(o.title)+' ↗</a><small>Fliggy'+(Number.isFinite(o.price)?' · from CNY '+o.price:'')+' · Check final price and availability</small></p>').join('')+(tcURL(booking.url)?'<a href="'+esc(tcURL(booking.url))+'" target="_blank" rel="noopener noreferrer">View booking options ↗</a>':'')+'</article>';
}
function tcError(){return tc.error?'<div class="tc-error" role="alert"><span>'+esc(tc.error)+'</span><button data-act="tcRefresh">Retry</button></div>':'';}
function tcCard(trip){
  const next=trip.nextStop,bookings=trip.bookings||[],alerts=trip.alerts||[],proposal=trip.proposal,pending=bookings.filter(b=>!['confirmed','booked','succeeded','checked_in','not_required'].includes(b.status)),busy=tc.busy?' disabled':'',directions=tcURL(next?.directionsURL);
  const needsAttention=alerts.some(a=>['closure','unavailable','booking'].includes(a.kind));
  const badge=trip.status==='completed'?'Trip finished':trip.status==='paused'?'Paused':needsAttention?'Needs attention':'Support active',dateContext=tcDateContext(trip);
  const bookingLabel=status=>({confirmed:'Confirmed',checked_in:'Checked in',booked:'Reserved',succeeded:'Reserved',needs_action:'Action needed',pending:'Pending',queued:'Queued',failed:'Failed',not_required:'No booking needed',unavailable:'Unavailable',external_action_required:'Book with venue'}[status]||String(status||'Check with venue').replaceAll('_',' '));
  return '<section class="tc-card" data-care-id="'+esc(trip.id)+'" aria-label="Trip support"><div class="tc-heading"><span class="tc-orb" aria-hidden="true">'+ic('sparkle',18)+'</span><div><small>'+esc(dateContext.heading)+' · '+esc(trip.city)+'</small><strong>Your trip, taken care of.</strong></div><span class="tc-state '+(needsAttention?'attention':'')+'">'+esc(badge)+'</span></div><div class="tc-next">'+(next?'<span class="tc-clock">'+esc(next.start||tcLocalTime(next.startsAt,trip.city))+'</span><div><small>'+esc(dateContext.label)+' · Day '+esc(next.dayIndex||1)+' · local time</small><h3>'+esc(tcName(next,trip))+'</h3></div>'+(directions?'<a href="'+esc(directions)+'" target="_blank" rel="noopener noreferrer" aria-label="Directions to '+esc(tcName(next,trip))+'">'+ic('right',18)+'</a>':''):'<p>'+(trip.status==='completed'?'Your scheduled visits are complete.':'No upcoming visits remain in this plan.')+'</p>')+'</div>'+(alerts[0]?'<p class="tc-alert">'+ic('bell',15)+'<span>'+esc(alerts[0].title||alerts[0].message)+'</span></p>':'')+'<details class="tc-details" data-care-details="'+esc(trip.id)+'"'+(tc.open.has(trip.id)?' open':'')+'><summary><span>'+ (pending.length?pending.length+' booking item'+(pending.length===1?'':'s')+' to review':'Bookings & trip support')+'</span><span>'+ic('down',15)+'</span></summary><div class="tc-details-body"><div class="tc-check-head"><span>'+ (trip.checkedAt?'Last checked '+esc(tcLocalTime(trip.checkedAt,trip.city))+' · local time':'Awaiting first check')+'</span><button data-act="tcCheck" data-a="'+esc(trip.id)+'"'+busy+'>'+(tc.busy?'Checking…':'Check now')+'</button></div>'+(bookings.length?'<div class="tc-bookings">'+bookings.map(b=>tcBookingHTML(b,trip,bookingLabel)).join('')+'</div>':'<p class="tc-muted">No booking items are linked to this trip.</p>')+(alerts.length?'<div class="tc-alerts">'+alerts.map(a=>'<p><strong>'+esc(a.title||'Trip update')+'</strong><span>'+esc(a.message||'')+'</span></p>').join(''):'')+(trip.status==='active'?'<div class="tc-adjust"><strong>Something changed?</strong><div><button data-act="tcEvent" data-a="'+esc(trip.id)+'" data-b="delay"'+busy+'>30 min late</button><button data-act="tcEvent" data-a="'+esc(trip.id)+'" data-b="rain"'+busy+'>It’s raining</button><button data-act="tcEvent" data-a="'+esc(trip.id)+'" data-b="closure"'+busy+'>Place closed</button></div><small>For your next stop. Review changes before applying.</small></div>':'')+(proposal?'<div class="tc-proposal"><small>SUGGESTED ADJUSTMENT</small><h3>'+esc(proposal.title||'Adjust your day')+'</h3><p>'+esc(proposal.summary||'')+'</p>'+(proposal.changes||[]).map(c=>'<div class="tc-change"><strong>'+esc(c.name||'Scheduled stop')+'</strong><span>'+esc(c.before||'Current plan')+' → '+esc(c.after||'Suggested change')+'</span></div>').join('')+(proposal.canApply?'<button class="btn btn-primary btn-block" data-act="tcAccept" data-a="'+esc(trip.id)+'" data-b="'+esc(proposal.id)+'"'+busy+'>Apply this adjustment</button>':'<p class="tc-muted">Keep existing reservations. Review options with the venue before changing a booking.</p>')+'</div>':'')+(trip.status==='active'?'<button class="tc-pause" data-act="tcStop" data-a="'+esc(trip.id)+'"'+busy+'>Pause trip support</button>':'')+'<p class="tc-scope">In-app updates. Fliggy links are search results, not reservations. Complete payment with the supplier. Restaurant reservations and live weather alerts are not connected.</p></div></details></section>';
}
function tcConfirmHTML(){return '<div class="tc-confirm"><button class="btn btn-primary btn-block" data-act="tcConfirm"'+(tc.busy||pd.busy||!pd.historyId?' disabled':'')+'>'+(tc.busy?'Starting trip support…':'Confirm trip & start support')+'</button><p>Start booking follow-up, daily guidance and change checks. External reservations still need to be completed with the venue.</p>'+(!pd.historyId?'<button class="btn-text" data-act="thSave">Save itinerary first</button>':'')+tcError()+'</div>';}
A.tcConfirm=async()=>{if(!pd.plan||pd.sample||pd.busy||!pd.historyId||pd.owner!==(jhUser?.id||null))return;await tcChange({action:'care_confirm',historyId:pd.historyId},{silent:true});};
A.tcRefresh=()=>tcLoad(true);
A.tcStop=id=>tc.trips.some(t=>t.id===id&&t.status==='active')?tcChange({action:'care_stop',id}):null;
A.tcCheck=id=>tc.trips.some(t=>t.id===id)?tcChange({action:'care_check',id}):null;
A.tcEvent=(id,event)=>tc.trips.some(t=>t.id===id)&&['delay','rain','closure'].includes(event)?tcChange({action:'care_event',id,event,...(event==='delay'?{minutes:30}:{})}):null;
A.tcAccept=(id,proposalId)=>tc.trips.some(t=>t.id===id&&t.proposal?.id===proposalId&&t.proposal.canApply)?tcChange({action:'care_accept',id,proposalId}):null;
const tcCatalogConfirm=A.agConfirm;
A.agConfirm=async()=>{const run=agRun(),owner=jhUser?.id;if(!run)return;await tcCatalogConfirm();if(jhUser?.id!==owner)return;const current=ag.runs.find(r=>r.id===run.id);if(current&&['queued','booked'].includes(current.status))await tcChange({action:'care_confirm',runId:run.id},{silent:true});};
const tcPlaceView=V['place-plan'];
V['place-plan']=()=>{
  tcScope();const trip=tcFor('history',pd.historyId);if(!pd.sample)tcSyncItinerary(trip);const view=tcPlaceView();if(!pd.plan||pd.sample||!tc.owner)return view;const template=document.createElement('template');template.innerHTML=view.body;const root=template.content.querySelector('.tu-sheet-scroll')||template.content.querySelector('.pd-plan');
  const adjusted=pd.plan.supportAdjusted?'<p class="tc-adjusted">Showing your accepted adjustments. The original plan remains in Trip history.</p>':'';
  if(root){root.insertAdjacentHTML('afterbegin',trip?tcCard(trip)+tcError()+adjusted:tcConfirmHTML());view.body=template.innerHTML;}else view.body+=(trip?tcCard(trip)+tcError()+adjusted:tcConfirmHTML());return view;
};
for(const route of ['ai-plan','ai-tasks']){const previous=V[route];V[route]=()=>{tcScope();const view=previous(),run=agRun(),trip=run?tcFor('run',run.id):null;if(trip)view.body=tcCard(trip)+tcError()+view.body;else if(tc.error&&run&&['queued','booked'].includes(run.status))view.body=tcError()+view.body;return view;};}
// Calendar groups confirmed trips by date. Full follow-up stays in each itinerary.
document.addEventListener('toggle',e=>{const id=e.target.dataset?.careDetails;if(id){if(e.target.open)tc.open.add(id);else tc.open.delete(id);}},true);
const tcPreviousRender=render;
render=function(){tcScope();tcPreviousRender();tcScope();const ctx=tc;if(ctx.owner&&!ctx.loaded&&!ctx.loading&&!ctx.error)Promise.resolve().then(()=>{if(tcCurrent(ctx))void tcLoad();});};
setInterval(()=>{if(document.visibilityState==='visible'&&tc.owner&&!tcEditing()&&['journey','place-plan','ai-plan','ai-tasks','orders'].includes(state.route))void tcLoad(true);},60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&tc.owner&&!tcEditing())void tcLoad(true);});
