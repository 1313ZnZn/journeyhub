import assert from 'node:assert/strict';
import {discoveryCardCount,selectCurated} from './supabase/functions/journeyhub-agent/curation.mjs';
import {discoveryAction,readSelection,validateFreePlan,scheduleVerifiedStops} from './supabase/functions/journeyhub-agent/discovery.mjs';
import {historyPlan,stableHistoryId,revisionHistoryId} from './supabase/functions/journeyhub-agent/history.mjs';

const now=new Date('2026-11-04T00:00:00Z'),user={id:'card-count-owner'},secret='fixture-secret';
const env=n=>({DEEPSEEK_API_KEY:'fixture-ai',GOOGLE_PLACES_API_KEY:'fixture-places'}[n]);
const categories=['Gardens','Museums','History','Coffee'];
const raw=(group,i)=>({id:'place_'+group+'_'+i,displayName:{text:categories[group]+' venue '+i},location:{latitude:31.23+group*.001+i*.0001,longitude:121.48},formattedAddress:'Verified fixture address',primaryType:'park',businessStatus:'OPERATIONAL'});

function fixture({days,sparse=false,underfillFirst=false,oneCategory=false}={}){
 const input={city:'Shanghai',date:'2026-11-10',prompt:oneCategory?'Quiet gardens':'Gardens, museums, historic sites and coffee',guests:2,days,dayStart:'09:00',dayEnd:'21:00',transport:'drive'};
 const rows=new Map(),calls=[],ranks=[];let rankingCalls=0;
 const rpc=async(name,args)=>{
  if(name==='journeyhub_discovery_quota')return null;
  if(name==='journeyhub_plan_dates_check')return {available:true};
  if(name==='journeyhub_trip_history_get')return rows.get(args.p_id)||null;
  if(name==='journeyhub_trip_history_save'){
   const row={id:args.p_id,userId:args.p_user_id,input:args.p_input,placeIds:args.p_place_ids,wanted:args.p_wanted,skipped:args.p_skipped,plan:args.p_plan,parentId:args.p_parent_id};rows.set(row.id,row);return row;
  }
  if(name==='journeyhub_trip_history_choices'){const row=rows.get(args.p_id);Object.assign(row,{wanted:args.p_wanted,skipped:args.p_skipped});return row;}
  throw Error('Unexpected RPC '+name);
 };
 const fetcher=async(url,init)=>{
  const body=init?.body?JSON.parse(init.body):null;calls.push({url,body});
  if(url.includes('deepseek')){
   const system=body.messages[0].content,data=JSON.parse(body.messages[1].content);let result;
   if(system.includes('requirements analyst'))result={queries:(oneCategory?categories.slice(0,1):categories).map(category=>({category,query:category}))};
   else if(system.includes('travel curator')){
    ranks.push(data);rankingCalls++;
    const count=sparse?2:underfillFirst&&rankingCalls===1?3:data.targetCardCount;
    // Supply candidates grouped by category to exercise the server interleaver.
    result={places:data.places.slice(0,count).map(p=>({id:p.id,name:p.name,category:p.categories[0],reason:'Requested interest'}))};
   }else if(system.includes('self-guided itinerary')){
    assert.match(system,/EVERY requested day/);
    // Real model failure regression: all selected places clustered onto day one.
    result={summary:'Verified places across your trip',stops:data.places.map(p=>({placeId:p.id,day:1,start:'09:00',end:'10:00',reason:'Requested interest'}))};
   }else throw Error('Unexpected AI operation');
   return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});
  }
  if(url.includes('places:searchText')){
   assert.equal(body.maxResultCount,20);assert.equal(body.languageCode,'en');
   const group=categories.findIndex(c=>body.textQuery.endsWith(c));
   return Response.json({places:Array.from({length:sparse?2:oneCategory?20:6},(_,i)=>raw(group,i))});
  }
  if(url.includes('places.googleapis.com/v1/places/')){
   const match=url.match(/place_(\d+)_(\d+)/);return Response.json(raw(Number(match[1]),Number(match[2])));
  }
  if(url.includes('routes.googleapis.com'))return Response.json({routes:[]});
  throw Error('Unexpected provider request '+url);
 };
 const call=value=>discoveryAction({value,user,env,fetcher,rpc,now,secret});
 return {input,call,rows,calls,ranks};
}

for(const [days,target] of [[1,8],[2,12],[3,14],[4,16]]){
 assert.equal(discoveryCardCount(days),target);
 const f=fixture({days,oneCategory:true});
 const search=await f.call({action:'discover',...f.input});
 assert.equal(search.places.length,target);assert.equal(search.targetCardCount,target);assert.equal(search.cardCountShortfall,0);
 assert.equal(new Set(search.places.map(p=>p.id)).size,target);
 assert.equal(f.ranks.length,1,'a complete suitable result needs no second ranking pass');
 assert(f.ranks.every(r=>r.targetCardCount===target));
 const signed=await readSelection(search.token,secret,user.id,now);assert.equal(signed.ids.length,target);
 if(days>1){
  const before=f.calls.length;
  await assert.rejects(()=>f.call({action:'discover_plan',token:search.token,wanted:[signed.ids[0]],skipped:[]}),e=>e.code==='INSUFFICIENT_PLACES');
  assert.equal(f.calls.length,before,'insufficient selections cannot buy more provider calls');
  await assert.rejects(()=>f.call({action:'discover_plan',token:search.token,wanted:[],skipped:signed.ids.slice(1)}),e=>e.code==='INSUFFICIENT_PLACES');
 }
 const planned=await f.call({action:'discover_plan',token:search.token,wanted:signed.ids,skipped:[]});
 assert.equal(planned.plan.stops.length,target,'no old 12-stop truncation');
 assert.equal(new Set(planned.plan.stops.map(s=>s.id)).size,target);
 assert.deepEqual([...new Set(planned.plan.stops.map(s=>s.dayIndex))],[...Array(days)].map((_,i)=>i+1));
 const counts=Array.from({length:days},(_,i)=>planned.plan.stops.filter(s=>s.dayIndex===i+1).length);
 assert(Math.max(...counts)-Math.min(...counts)<=1,'repair distributes concrete visits across the requested days');
 assert(planned.plan.stops.every(s=>s.start>='09:00'&&s.end<='21:00'&&s.end>s.start));
 assert.equal(f.rows.get(planned.historyId).plan.stops.length,target,'complete result is saved');
 assert.equal(historyPlan(planned.plan,f.input,signed.ids).stops.length,target);
 assert(f.calls.every(c=>!c.url.includes('booking')&&!c.url.includes('mail')));
}

// Balanced category capping must not let the first category fill the whole deck.
const queries=categories.map(category=>({category,query:category}));
const records=categories.flatMap((category,g)=>Array.from({length:5},(_,i)=>({id:'r'+g+'_'+i,name:category+' '+i,categories:[category]})));
const ranked={places:records.map(p=>({id:p.id,name:p.name,category:p.categories[0]}))};
for(const count of [8,12,14,16]){
 const result=selectCurated(ranked,records,queries,count);
 assert.equal(result.places.length,count);assert.deepEqual(result.places.slice(0,4).map(p=>p.category),categories);assert.deepEqual(result.missingCategories,[]);
}

// A provider shortage is honest and bounded: no fake or unrelated quota padding.
const sparse=fixture({days:4,sparse:true,oneCategory:true}),short=await sparse.call({action:'discover',...sparse.input});
assert.equal(short.places.length,2);assert.equal(short.targetCardCount,16);assert.equal(short.cardCountShortfall,14);
assert.equal(sparse.ranks.length,1,'do not retry an impossible inventory count');

// Verified inventory may be larger than the suitable set selected by the curator.
const selective=fixture({days:1,oneCategory:true,underfillFirst:true});
const few=await selective.call({action:'discover',...selective.input});
assert.equal(few.places.length,3);assert.equal(few.cardCountShortfall,5);
assert.equal(selective.ranks.length,1,'a suitable partial set is not reranked just to fill a quota');

// Reject rather than publish impossible days, unknown venues or duplicate visits.
const places=[0,1,2,3].map(i=>({id:'p'+i,name:'Place '+i,lat:31.23,lng:121.48}));
const input={...sparse.input,days:4},clustered={summary:'Test',stops:places.map(p=>({placeId:p.id,day:1,start:'09:00',end:'10:00'}))};
assert.throws(()=>validateFreePlan(clustered,places,input),e=>e.code==='AI_INVALID_PLAN');
const repaired=scheduleVerifiedStops(clustered,places,input);
assert.equal(validateFreePlan(repaired,places,input).stops.length,4);
assert.throws(()=>validateFreePlan(scheduleVerifiedStops({...clustered,stops:[...clustered.stops.slice(0,3),{...clustered.stops[3],placeId:'invented'}]},places,input),places,input));
assert.throws(()=>validateFreePlan(scheduleVerifiedStops({...clustered,stops:[...clustered.stops.slice(0,3),clustered.stops[0]]},places,input),places,input));
assert.throws(()=>validateFreePlan(scheduleVerifiedStops(clustered,places,{...input,dayEnd:'09:20'}),places,{...input,dayEnd:'09:20'}));

// A stricter policy generates a fresh immutable revision, preserving old history.
const root='11111111-1111-4111-8111-111111111111',wanted=['p1'],skipped=[];
const legacy=await stableHistoryId('itinerary:'+root+':'+JSON.stringify([wanted,skipped]));
assert.notEqual(await revisionHistoryId(root,wanted,skipped),legacy);
assert.equal(await revisionHistoryId(root,wanted,skipped),await revisionHistoryId(root,wanted,skipped));
console.log('PASS: 8/12/14/16-card limits, suitable partial selections, category interleaving, honest shortages, owner-bound selections, all-day route repair, 16-stop persistence, insufficient-choice guards and immutable revision upgrade. All calls mocked; no bookings or emails.');
