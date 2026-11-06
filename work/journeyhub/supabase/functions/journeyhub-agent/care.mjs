import {isAmap,amapURL,amapDetails} from './amap.mjs';
import {sanitizeFlyaiResult} from './flyai.mjs';
import {fail} from './planner.mjs';
import {historyId} from './history.mjs';
import {createCalendarWeather} from './calendar-weather.mjs';
import {assessCare,savedPlaces,canonicalBooking,protectedStopIds,factFor,hoursAssessment,outdoors,visitDate} from './care-readiness.mjs';
const careWeather=createCalendarWeather();
const zones={Bangkok:'Asia/Bangkok',Shanghai:'Asia/Shanghai',Singapore:'Asia/Singapore'};
const offsets={Bangkok:'+07:00',Shanghai:'+08:00',Singapore:'+08:00'};
const clean=(v,n=300)=>typeof v==='string'?v.slice(0,n):'';
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const dateAt=(d,i)=>new Date(Date.parse(d+'T12:00:00Z')+(i-1)*86400000).toISOString().slice(0,10);
const safeURL=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const googleURL=id=>'https://www.google.com/maps/search/?api=1&query=Place&query_place_id='+encodeURIComponent(id);
const detailsCache=new Map(); // Instance-local rendering cache only; never stored in the database.
function cacheGet(row,now){const c=detailsCache.get(row.id);return c&&c.until>now.getTime()?c.places:{};}
function cachePut(row,places,now){if(detailsCache.size>100)detailsCache.clear();detailsCache.set(row.id,{places,until:now.getTime()+300000});}
export function careStops(row,places={}){
 places=savedPlaces(row,places);
 const input=row.input,zone=zones[input.city];
 return row.plan.stops.map((s,index)=>{
  const id=s.id||s.sessionId,p={...s,...(places[id]||{})};
  let dayIndex=s.dayIndex,start=s.start,end=s.end,startsAt=s.startsAt,endsAt=s.endsAt;
  if(row.sourceType==='run'){
   const time=t=>new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
   const d=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(startsAt));
   start=time(startsAt);end=time(endsAt);dayIndex=Math.round((Date.parse(d)-Date.parse(input.date))/86400000)+1;
  }else{startsAt=dateAt(input.date,dayIndex)+'T'+start+':00'+offsets[input.city];endsAt=dateAt(input.date,dayIndex)+'T'+end+':00'+offsets[input.city];}
  return {id,...p,name:p.name||s.title||'Stop '+(index+1),address:p.address||s.venue||'',kind:p.kind||s.kind||((row.checks||[]).find(c=>c.id===id)?.outdoor?'park':''),start,end,dayIndex,visitDate:dateAt(input.date,dayIndex),startsAt,endsAt,
   directionsURL:row.sourceType==='history'&&isAmap(id)?amapURL(id):row.sourceType==='history'?'https://www.google.com/maps/dir/?api=1&destination=Place&destination_place_id='+encodeURIComponent(id):'',
   sourceURL:row.sourceType==='history'?(isAmap(id)?amapURL(id):googleURL(id)):'',website:p.website||'',businessStatus:p.businessStatus||'',fixed:row.sourceType==='run'};
 }).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
}
export function presentCare(row,now=new Date(),places={}){
 const stops=careStops(row,places),active=row.status==='active',endDate=dateAt(row.input.date,(row.input.days||1)+1),localDay=new Intl.DateTimeFormat('en-CA',{timeZone:zones[row.input.city],year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const status=active&&localDay>=endDate?'completed':row.status;
 const nextStop=status==='active'?stops.find(s=>Date.parse(s.endsAt)>now.getTime())||null:null;
 const byId=new Map(stops.map(s=>[s.id,s]));
 const bookings=row.sourceType==='run'?stops.map(s=>{
  const b=row.run?.bookings?.find(b=>b.sessionId===s.id),status=b?.status||(row.run?.status==='failed'?'failed':'pending');
  return {id:s.id,name:s.name,status,detail:b?'JourneyHub sample reservation · '+(b.id||''):status==='failed'?'The JourneyHub reservation did not complete.':'The confirmed JourneyHub reservation is being processed.',reference:b?.id||null};
 }):stops.map(s=>{const search=sanitizeFlyaiResult((row.checks||[]).find(c=>c.id===s.id)?.supplier,s.id);return {id:s.id,name:s.name,status:'needs_action',detail:search?.status==='ready'?'Venue-matched Fliggy listings. Confirm dates, guests and availability on Fliggy; no order has been placed.':search?.status==='unavailable'?'Fliggy search is temporarily unavailable. Check with the venue.':'Check tickets or table availability with the venue.',url:s.website||s.sourceURL,supplier:search||null};});
 // Canonical rows override stale supplier searches and job snapshots.
 for(const booking of bookings){const b=canonicalBooking(row,booking.id);if(!b)continue;Object.assign(booking,{status:b.status,reference:b.bookingId,paymentStatus:b.paymentStatus,simulated:b.simulated,detail:b.status==='cancelled'?'Cancelled · Ticket invalid':(b.simulated?'Simulated reservation · ':'JourneyHub reservation · ')+b.bookingId+(b.paymentStatus==='simulated_paid'?' · Virtual payment recorded':''),supplier:null});}
 const checks=(row.checks||[]).filter(c=>byId.has(c.id));
 const alerts=checks.filter(c=>c.status==='closed').map(c=>({id:'place:'+c.id,kind:'closure',title:'Place closure reported',message:(byId.get(c.id)?.name||'A planned stop')+' is reported closed by the place provider. Review the suggested change.'}));
 const failed=checks.filter(c=>c.status==='unknown'&&c.reason==='fetch_failed');
 const unverified=checks.filter(c=>c.status!=='open'&&c.status!=='closed'&&c.reason!=='fetch_failed');
 if(failed.length)alerts.push({id:'place-check-failed',kind:'unavailable',title:'Place refresh unavailable',message:'Could not refresh '+failed.length+' location'+(failed.length===1?'':'s')+'. Your itinerary is saved. Check with the venues before visiting; this is not a closure report.'});
 if(unverified.length)alerts.push({id:'opening-status-unverified',kind:'info',title:'Opening status not verified',message:'Live opening status is not available for '+unverified.length+' stop'+(unverified.length===1?'':'s')+'. Check venue hours before visiting. This does not mean the places are closed.'});
 if(row.sourceType==='run'&&bookings.some(b=>!['confirmed','checked_in'].includes(b.status)))alerts.push({id:'bookings',kind:'booking',title:'Booking follow-up',message:'Some JourneyHub reservations need attention. See Orders for their current status.'});
 if(nextStop&&Date.parse(nextStop.startsAt)-now.getTime()<=3600000)alerts.unshift({id:'next:'+nextStop.id,kind:'departure',title:Date.parse(nextStop.startsAt)<=now.getTime()?'Your current stop':'Coming up next',message:nextStop.name+' · '+nextStop.start+'. Allow time to travel; live traffic is not connected.'});
 if(row.events?.some(e=>e.kind==='adjustment_accepted'))alerts.push({id:'adjusted',kind:'info',title:'Plan updated',message:'Your accepted changes are saved in this confirmed trip. Original trip history is preserved.'});
 const affectedDays=Array.isArray(row.proposal?.affectedDays)?[...new Set(row.proposal.affectedDays.filter(day=>Number.isInteger(day)&&day>=1&&day<=Math.min(7,row.input.days||1)))].sort((a,b)=>a-b):[];
 const proposal=row.proposal?{id:row.proposal.id,...(Number.isInteger(row.proposal.dayIndex)&&row.proposal.dayIndex>=1&&row.proposal.dayIndex<=(row.input.days||1)?{dayIndex:row.proposal.dayIndex}:{}),...(affectedDays.length?{affectedDays}:{}),title:row.proposal.title,summary:Date.parse(row.proposal.expiresAt)<=now.getTime()?'This proposal expired. Report the change again for a fresh suggestion.':row.proposal.summary,canApply:row.proposal.canApply&&Date.parse(row.proposal.expiresAt)>now.getTime(),changes:(row.proposal.changes||[]).map(c=>({...c,name:byId.get(c.id)?.name||c.name||'Planned stop'})),protectedBookingCount:protectedStopIds(row).size}:null;
 const readiness=assessCare(row,stops,now),activity=(row.events||[]).map(e=>({kind:e.kind,at:e.createdAt,title:({readiness_checked:'Trip checked',proposal_prepared:'Adjustment prepared',adjustment_accepted:'Approved adjustment saved',booking_booked:'Reservations recorded',booking_failed:'Reservation needs attention',reservation_cancelled:'Reservation cancelled',departure:'Departure reminder',itinerary_updated:'Itinerary updated',monitoring_resumed:'Monitoring resumed'})[e.kind]||'Trip updated'}));
 return {id:row.id,sourceId:row.sourceId,sourceType:row.sourceType,city:row.input.city,date:row.input.date,days:row.input.days||1,status,confirmedAt:row.confirmedAt,checkedAt:row.checkedAt,nextStop,bookings,alerts,proposal,stops,roadRoutes:Array.isArray(row.plan.roadRoutes)?row.plan.roadRoutes:[],revision:row.revision,
  readiness,activity,protectedBookingCount:protectedStopIds(row).size,
  monitoring:{bookings:'JourneyHub reservations and virtual payments',reminders:'In-app reminders',places:'Saved official facts and periodic place checks',weather:(row.checks||[]).some(c=>c.id==='__weather__'&&c.forecast?.days?.length&&Date.parse(c.forecast.expiresAt)>now.getTime()),traffic:false,push:false}};
}
async function fetchPlace(id,key,fetcher,env){
 try{
  if(isAmap(id)){const p=await amapDetails(id,env?.('AMAP_WEB_SERVICE_KEY'),fetcher);return {...p,businessStatus:'UNKNOWN'};}
  const response=await fetcher('https://places.googleapis.com/v1/places/'+encodeURIComponent(id)+'?languageCode=en',{headers:{'X-Goog-Api-Key':key,'X-Goog-FieldMask':'id,displayName,formattedAddress,primaryType,businessStatus,websiteUri'},signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!response.ok){await response.body?.cancel();return null;}
  const raw=await response.json();if(raw.id!==id)return null;
  return {name:clean(raw.displayName?.text,160),address:clean(raw.formattedAddress,400),kind:clean(raw.primaryType,80),businessStatus:clean(raw.businessStatus,50),website:safeURL(raw.websiteUri)};
 }catch{return null;}
}
export function buildCareProposal(row,event,now=new Date(),places={},minutes=30,stopId=null){
 const stops=careStops(row,places),future=stops.filter(s=>Date.parse(s.endsAt)>now.getTime());
 if(!future.length)fail('TRIP_FINISHED','There are no remaining stops to adjust.',409);
 const original=structuredClone(row.plan),id=crypto.randomUUID(),base={id,revision:row.revision,expiresAt:new Date(now.getTime()+1800000).toISOString()};
 const blocked=summary=>({...base,title:'Review before changing this trip',summary,changes:[],canApply:false,plan:original});
 if(row.sourceType==='run')return blocked('These activities have fixed session times. Review their reservations before changing arrival times. Nothing has been moved or cancelled.');
 const chosen=stopId?future.find(s=>s.id===stopId):event==='rain'?future.find(s=>s.dayIndex===future[0].dayIndex&&outdoors(s.kind)):future[0];
 if(!chosen)return blocked('No suitable remaining visit could be verified for this change. Your itinerary is unchanged.');
 const protectedIds=protectedStopIds(row);
 if(protectedIds.has(chosen.id))return blocked('This stop has a confirmed reservation. Review its ticket and contact the venue; the assistant will not move or cancel it.');
 if(event==='rain'||event==='closure')return blocked(event==='rain'?'An outdoor visit may be affected. Review the forecast and choose an indoor alternative from your saved places. The assistant has not verified a replacement route, so it has kept every visit.':'This visit needs an alternative. Review the official notice and choose another saved place. No verified replacement route is available, so the assistant has kept every visit and reservation.');
 let offset=minutes;
 if(event==='hours'){
  const info=hoursAssessment(factFor(row,chosen),chosen.start,chosen.end),duration=minute(chosen.end)-minute(chosen.start);
  const candidate=info.windows?.find(([lo,hi])=>hi-lo>=duration&&(info.lastEntry==null||lo<info.lastEntry)&&Date.parse(chosen.startsAt.slice(0,10)+'T'+clock(lo)+':00'+offsets[row.input.city])>=now.getTime());
  if(!candidate)return blocked('Published hours do not provide a safe remaining slot. Review this visit; the original plan is unchanged.');
  offset=candidate[0]-minute(chosen.start);
 }
 const plan=structuredClone(row.plan),changes=[];
 for(const s of plan.stops){
  const old=stops.find(x=>x.id===s.id);
  if(!old||s.dayIndex!==chosen.dayIndex||minute(s.start)<minute(chosen.start)||Date.parse(old.endsAt)<=now.getTime())continue;
  if(protectedIds.has(s.id))continue;
  const newStart=minute(s.start)+offset,newEnd=minute(s.end)+offset;
  if(newStart<minute(row.input.dayStart||'00:00')||newEnd>minute(row.input.dayEnd||'23:59')||newStart<0||newEnd>1439)return blocked('This adjustment would exceed your active hours. All visits are kept; shorten a visit or change your daily hours before trying again.');
  const proposedStart=Date.parse(old.startsAt.slice(0,10)+'T'+clock(newStart)+':00'+offsets[row.input.city]);
  if(proposedStart<now.getTime()&&event==='hours')return blocked('The alternative opening window has already started. Review this stop rather than moving it into the past.');
  const assessment=hoursAssessment(factFor(row,old),clock(newStart),clock(newEnd));
  if(['closed','conflict'].includes(assessment.status))return blocked('The change conflicts with another published opening window. Review the affected visit; nothing has changed.');
  s.start=clock(newStart);s.end=clock(newEnd);
  changes.push({id:s.id,name:old.name,before:old.start+'–'+old.end,after:s.start+'–'+s.end});
 }
 const day=plan.stops.filter(s=>s.dayIndex===chosen.dayIndex).sort((a,b)=>a.start.localeCompare(b.start));
 const before=stops.filter(s=>s.dayIndex===chosen.dayIndex);
 for(let i=1;i<day.length;i++){
  const gap=minute(day[i].start)-minute(day[i-1].end),oldGap=minute(before[i].start)-minute(before[i-1].end);
  if(day[i].id!==before[i].id||gap<Math.max(0,oldGap))return blocked('This change would shorten an existing transfer or conflict with a protected reservation. Nothing has been moved.');
 }
 return {...base,title:event==='hours'?'Fit the published opening window':'Give the day more time',summary:'Retimes '+changes.length+' flexible visit'+(changes.length===1?'':'s')+'. All visits and existing transfer gaps are retained. Confirmed reservations and payments stay unchanged. Review any unverified venue hours before accepting.',changes,canApply:changes.length>0,plan};
}
async function getCare(rpc,user,id){const row=await rpc('journeyhub_care_get',{p_user_id:user.id,p_id:historyId(id)});if(!row)fail('TRIP_NOT_FOUND','This confirmed trip is not available for your account.',404);return row;}
async function checkCare(row,{user,rpc,env,fetcher,now}){
 if(row.status!=='active')return row;
 const claim=await rpc('journeyhub_care_claim_check',{p_user_id:user.id,p_id:row.id});if(!claim)return row;
 const key=env('GOOGLE_PLACES_API_KEY'),stops=careStops(row).filter(s=>Date.parse(s.endsAt)>now.getTime()),places=savedPlaces(row),checks=[];
 // Amap POI does not expose an operational open/closed flag. Repeating that
 // lookup cannot verify hours. Reuse official date-specific facts instead.
 await Promise.all(stops.map(async s=>{
  const fact=factFor(row,s),hours=hoursAssessment(fact,s.start,s.end);
  if(isAmap(s.id)||row.sourceType==='run'||hours.status!=='unknown'){
   checks.push({id:s.id,status:hours.status==='closed'?'closed':hours.status==='open'?'open':'unknown',reason:hours.status==='unknown'?'status_not_supported':hours.status==='conflict'?'hours_conflict':'official_hours',outdoor:outdoors(s.kind)});return;
  }
  const p=key?await fetchPlace(s.id,key,fetcher,env):null;if(p)places[s.id]={...p,...(places[s.id]||{})};
  checks.push({id:s.id,reason:!p?'fetch_failed':!p.businessStatus?'status_not_supplied':null,status:!p?'unknown':/^CLOSED_/.test(p.businessStatus)?'closed':p.businessStatus==='OPERATIONAL'?'open':'unknown',outdoor:outdoors(p?.kind||s.kind)});
 }));
 let forecast=null;
 if(stops.some(s=>Date.parse(s.startsAt)<now.getTime()+9*86400000)){
  try{forecast=await careWeather(row.input.city,{env,fetcher,now});}catch{/* A missing forecast is never an all-clear. */}
 }
 if(forecast)checks.push({id:'__weather__',forecast});
 cachePut(row,places,now);
 const assessed={...row,checks};let proposal=row.proposal;
 if(!proposal||Date.parse(proposal.expiresAt)<=now.getTime()){
  const issue=stops.find(s=>checks.find(c=>c.id===s.id)?.status==='closed');
  const conflict=stops.find(s=>hoursAssessment(factFor(row,s),s.start,s.end).status==='conflict');
  const wet=stops.find(s=>outdoors(s.kind)&&forecast?.days?.some(d=>d.date===visitDate(row,s)&&['rain','storm','snow','sleet'].includes(d.icon)));
  if(issue)proposal=buildCareProposal(assessed,'closure',now,places,30,issue.id);
  else if(conflict)proposal=buildCareProposal(assessed,'hours',now,places,30,conflict.id);
  else if(wet)proposal=buildCareProposal(assessed,'rain',now,places,30,wet.id);
 }
 return rpc('journeyhub_care_update',{p_user_id:user.id,p_id:row.id,p_revision:row.revision,p_checks:checks,p_proposal:proposal});
}
export async function careAction(context){
 const {value,user,rpc,env,fetcher,now}=context;
 if(value.action==='care_status'){
  const rows=await rpc('journeyhub_care_list',{p_user_id:user.id});if(!Array.isArray(rows))fail('CARE_UNAVAILABLE','Your trip companion could not be loaded.',503);
  // Status is a saved-data read. Provider calls run only in explicit/scheduled
  // checks, so signing in never waits for maps, search or an LLM.
  return {trips:rows.map(row=>presentCare(row,now,cacheGet(row,now)))};
 }
 let row;
 if(value.action==='care_confirm'){
  if(!!value.historyId===!!value.runId)fail('INVALID_INPUT','Choose one saved itinerary to confirm.');
  row=await rpc('journeyhub_care_confirm',{p_user_id:user.id,p_source_type:value.historyId?'history':'run',p_source_id:historyId(value.historyId||value.runId)});
  // The durable care row enrolls this trip in the background-check queue.
 }else{
  row=await getCare(rpc,user,value.id);
  if(value.action==='care_stop')row=await rpc('journeyhub_care_stop',{p_user_id:user.id,p_id:row.id});
  else if(value.action==='care_check')row=await checkCare(row,context);
  else if(value.action==='care_accept')row=await rpc('journeyhub_care_accept',{p_user_id:user.id,p_id:row.id,p_proposal_id:historyId(value.proposalId)});
  else if(value.action==='care_event'){
   if(!['delay','rain','closure'].includes(value.event))fail('INVALID_INPUT','Choose a delay, rain or closure update.');
   if(row.status!=='active')fail('CARE_PAUSED','This trip companion is not active.',409);
   const minutes=value.minutes??30;if(!Number.isInteger(minutes)||minutes<5||minutes>180)fail('INVALID_INPUT','Choose a delay between 5 and 180 minutes.');
   if(value.stopId!=null&&(typeof value.stopId!=='string'||!row.plan.stops.some(s=>(s.id||s.sessionId)===value.stopId)))fail('INVALID_INPUT','Choose a stop from this trip.');
   await rpc('journeyhub_discovery_quota',{p_user_id:user.id});
   row=await checkCare(row,context);
   const proposal=buildCareProposal(row,value.event,now,cacheGet(row,now),minutes,value.stopId);
   row=await rpc('journeyhub_care_update',{p_user_id:user.id,p_id:row.id,p_revision:row.revision,p_checks:null,p_proposal:proposal});
  }else fail('INVALID_INPUT','Choose a valid trip companion action.');
 }
 return {trip:presentCare(row,now,cacheGet(row,now))};
}
