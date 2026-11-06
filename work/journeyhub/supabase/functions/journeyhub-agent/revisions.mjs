// Itinerary edits never create, cancel or change a booking. The signed preview
// binds verified place IDs, owner, original row version and the exact new schedule.
import {fail,validateInput,estimateTravel} from './planner.mjs';
import {historyId,historyPlan,getHistory} from './history.mjs';
import {hydrateHistory,signSelection,readSelection,validateFreePlan,addPlanEstimate} from './discovery.mjs';
import {isAmap,addAmapRoutes} from './amap.mjs';
import {addRoadRoutes} from './roads.mjs';
import {persistDisplaySnapshot} from './snapshot.mjs';
const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
export function reflowStops(selected,places,input,oldPlan){
 if(!Array.isArray(selected)||selected.length<input.days||selected.length>16)fail('INVALID_EDIT','Keep at least one place on every travel day.');
 const lookup=new Map(places.map(p=>[p.id,p])),old=new Map((oldPlan?.stops||[]).map(s=>[s.id,s])),seen=new Set(),endByDay=new Map(),lastByDay=new Map();
 const stops=selected.map(s=>{
  const place=lookup.get(s?.id);
  if(!place||place.unavailable||seen.has(s.id)||!Number.isInteger(s.dayIndex)||s.dayIndex<1||s.dayIndex>input.days)fail('INVALID_EDIT','Choose distinct available places from this saved search.');
  seen.add(s.id);const previous=lastByDay.get(s.dayIndex),previousEnd=endByDay.get(s.dayIndex),original=old.get(s.id);
  const duration=original?Math.min(240,Math.max(30,minutes(original.end)-minutes(original.start))):/restaurant|dining/.test(place.kind)?90:/cafe|coffee/.test(place.kind)?45:60;
  const from=previous?previousEnd+estimateTravel(previous,place,input.transport).durationMinutes:minutes(input.dayStart),to=from+duration;
  if(to>minutes(input.dayEnd))fail('EDIT_TIME_WINDOW','These visits and transfers do not fit. Remove a stop or extend your activity hours.',409);
  endByDay.set(s.dayIndex,to);lastByDay.set(s.dayIndex,place);
  return {placeId:s.id,day:s.dayIndex,start:clock(from),end:clock(to),reason:'Adjusted to your trip preferences.'};
 });
 if(endByDay.size!==input.days)fail('INVALID_EDIT','Keep at least one place on every travel day.');
 return validateFreePlan({summary:'Your updated itinerary.',stops},places,input);
}
function allowRouteTimes(plan,input){
 for(let day=1;day<=input.days;day++){
  let prev=null;
  for(const stop of plan.stops.filter(s=>s.dayIndex===day)){
   const duration=minutes(stop.end)-minutes(stop.start),transfer=prev?Math.max(estimateTravel(prev,stop,input.transport).durationMinutes,stop.travel?.durationMinutes?stop.travel.durationMinutes+10:0):0;
   const from=prev?Math.max(minutes(stop.start),minutes(prev.end)+transfer):minutes(stop.start);
   if(from+duration>minutes(input.dayEnd))fail('EDIT_TIME_WINDOW','The refreshed route needs more time. Remove a stop or extend your activity hours.',409);
   stop.start=clock(from);stop.end=clock(from+duration);stop.travelConflict=false;prev=stop;
  }
 }
}
export async function revisionAction(context){
 const {value,user,now,rpc,secret,env,fetcher}=context,id=historyId(value.historyId);
 historyId(value.requestId);
 if(value.action==='discover_revise_apply'){
  const preview=await readSelection(value.revisionToken,secret,user.id,now);
  if(preview.kind!=='itinerary_revision'||preview.historyId!==id||!preview.baseVersion)fail('INVALID_EDIT','Preview this itinerary again before applying it.',409);
  const structure=historyPlan(preview.plan,preview.input,preview.ids);
  const row=await rpc('journeyhub_trip_history_revise',{p_user_id:user.id,p_id:id,p_expected_updated_at:preview.baseVersion,p_input:preview.input,p_plan:structure,p_request_id:value.requestId});
  if(!row||row.id!==id)fail('HISTORY_UNAVAILABLE','Your updated itinerary could not be saved. Retry applying this preview.',503);
  const hydrated=await hydrateHistory(row,context);await persistDisplaySnapshot(rpc,user.id,row,hydrated.places);
  return {...hydrated,bookingsUnchanged:true};
 }
 const row=await getHistory(rpc,user.id,id);
 if(!row.plan||row.placeIds.some(id=>id.startsWith('jh_sample_')))fail('INVALID_EDIT','Open a saved AI itinerary to edit it.',409);
 const input=validateInput({...row.input,...value.input,action:'plan',requestId:value.requestId,preferredExperienceIds:[],excludedExperienceIds:[]},now).input;
 if(input.city!==row.input.city||input.date!==row.input.date||input.days!==row.input.days)fail('INVALID_EDIT','Keep this itinerary’s city and travel dates. Start a new trip to change them.',409);
 await rpc('journeyhub_discovery_quota',{p_user_id:user.id});
 // The original route is not shown in this preview. Refresh every place, then
 // calculate only the edited route rather than the route being replaced.
 const hydrated=await hydrateHistory(row,context,{skipRoutes:true}),plan=reflowStops(value.stops,hydrated.places,input,row.plan);
 await (context.measure||((_stage,task)=>task()))('revision_routes',()=>plan.stops.every(s=>isAmap(s.id))?addAmapRoutes(plan,env('AMAP_WEB_SERVICE_KEY'),fetcher):addRoadRoutes(plan,env('GOOGLE_ROUTES_API_KEY')||env('GOOGLE_PLACES_API_KEY'),fetcher));
 allowRouteTimes(plan,input);addPlanEstimate(plan,input);
 const structure=historyPlan(plan,input,row.placeIds),expires=now.getTime()+15*60000;
 const revisionToken=await signSelection({kind:'itinerary_revision',owner:user.id,historyId:id,baseVersion:row.updatedAt,input,ids:row.placeIds,plan:structure,expires},secret);
 if(revisionToken.length>9000)fail('INVALID_EDIT','Shorten your trip notes before previewing this edit.');
 return {historyId:id,input,plan,revisionToken,expires,bookingsUnchanged:true};
}
