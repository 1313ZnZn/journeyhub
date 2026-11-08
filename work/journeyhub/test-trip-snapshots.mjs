import assert from 'node:assert/strict';
import test from 'node:test';
import {discoveryAction,historyAction,hydrateHistory,readSelection} from './supabase/functions/journeyhub-agent/discovery.mjs';
import {displayPayload,persistDisplaySnapshot} from './supabase/functions/journeyhub-agent/snapshot.mjs';
import {createAgentHandler} from './supabase/functions/journeyhub-agent/handler.mjs';

const USER='00000000-0000-4000-8000-000000000001';
const OTHER='00000000-0000-4000-8000-000000000002';
const ROOT='10000000-0000-4000-8000-000000000001';
const ID='20000000-0000-4000-8000-000000000001';
const REV='2026-11-04T10:12:13.123456+00:00';
const NOW=new Date('2026-11-08T00:00:00Z'); // Past itineraries remain readable.
const SECRET='isolated-snapshot-test-signing-secret';
const ids=['place_a','place_b','place_c','place_d','place_e','place_f'];
const input={city:'Shanghai',date:'2026-11-05',guests:2,prompt:'Museums and restaurants',days:2,dayStart:'09:00',dayEnd:'18:00',transport:'walk'};
const structure={summary:'Two complete days',stops:[
 {id:ids[0],dayIndex:1,start:'09:00',end:'10:30',reason:'History'},
 {id:ids[1],dayIndex:1,start:'11:00',end:'12:00',reason:'Lunch'},
 {id:ids[2],dayIndex:2,start:'09:00',end:'10:30',reason:'Art'},
 {id:ids[3],dayIndex:2,start:'11:00',end:'12:00',reason:'Lunch'}
]};
const allLabels=ids.map((id,i)=>({id,name:'Saved English venue '+(i+1),kind:i%2?'restaurant':'museum',category:i%2?'food':'culture',reason:'Fits the saved preferences'}));
const payload={schemaVersion:1,places:allLabels};
const row={id:ID,userId:USER,parentId:ROOT,input,placeIds:ids,wanted:ids.slice(0,4),skipped:ids.slice(4),plan:structure,updatedAt:REV,createdAt:REV};
const schedule=plan=>plan.stops.map(({id,dayIndex,start,end,reason})=>({id,dayIndex,start,end,reason}));

function fixture(options={}){
 const history=structuredClone(options.row||row),calls=[],writes=[];
 let quota=0;
 const cached=Object.hasOwn(options,'snapshot')?options.snapshot:{payload:structuredClone(payload),savedAt:REV,sourceUpdatedAt:history.updatedAt};
 const rpc=async(name,args)=>{
  calls.push({type:'rpc',name,args});
  if(name==='journeyhub_trip_history_get')return args.p_user_id===history.userId&&args.p_id===history.id?structuredClone(history):null;
  if(name==='journeyhub_trip_snapshot_get'){
   assert.equal(args.p_user_id,history.userId);
   if(options.getError)throw Error('Snapshot database unavailable');
   if(args.p_id===history.id)return structuredClone(cached);
   if(args.p_id===history.parentId&&options.parentSnapshot&&(!options.parentOwner||options.parentOwner===args.p_user_id))return structuredClone(options.parentSnapshot);
   return null;
  }
  if(name==='journeyhub_trip_snapshot_put'){
   writes.push(args);
   if(options.putError)throw Error('Snapshot write unavailable');
   if(options.putResult)return options.putResult;
   return {ok:true,savedAt:REV};
  }
  if(name==='journeyhub_discovery_quota'||name==='journeyhub_refresh_quota'){quota++;return null;}
  throw Error('Unexpected RPC '+name);
 };
 const fetcher=async(url,init={})=>{
  calls.push({type:'fetch',url:String(url),init});
  if(options.noFetch)throw Error('No provider or AI call is allowed during a saved-trip open');
  if(String(url).includes('deepseek'))throw Error('Saved English names must prevent another AI translation');
  if(String(url).includes('routes.googleapis.com'))return Response.json({routes:[{distanceMeters:500,duration:'600s',polyline:{encodedPolyline:'transient-route'},legs:[{distanceMeters:500,duration:'600s'}]}]});
  if(String(url).includes('places.googleapis.com')){
   const id=new URL(url).pathname.split('/').at(-1),i=ids.indexOf(id);
   if(init.headers?.['X-Goog-FieldMask']==='id,reviews')return Response.json({id,reviews:[]});
   return Response.json({id,displayName:{text:'原始地点 '+(i+1)},primaryType:i%2?'restaurant':'museum',formattedAddress:'Transient provider street address',location:{latitude:31.23+i*.001,longitude:121.48+i*.001},businessStatus:'OPERATIONAL',regularOpeningHours:{weekdayDescriptions:['Monday: 09:00–18:00']}});
  }
  throw Error('Unexpected external request '+url);
 };
 const env=name=>({GOOGLE_PLACES_API_KEY:'test-only-map-key',JOURNEYHUB_DISCOVERY_SIGNING_KEY:SECRET}[name]);
 const context={user:{id:USER},now:NOW,secret:SECRET,env,rpc,fetcher};
 return {history,calls,writes,rpc,fetcher,env,context,get quota(){return quota;},run:(action,overrides={})=>historyAction({...context,...overrides,value:{action,id:history.id}})};
}

test('database snapshot opens the complete saved itinerary without providers, AI or quota',async()=>{
 const f=fixture({noFetch:true}),result=await f.run('history_open');
 assert.deepEqual(schedule(result.plan),structure.stops);
 assert.deepEqual(result.plan.stops.map(s=>s.name),allLabels.slice(0,4).map(s=>s.name));
 assert.equal(result.plan.date,input.date);
 assert.equal(result.snapshot.source,'database');
 assert.equal(result.snapshot.refreshNeeded,true);
 assert.equal(f.quota,0);
 assert.equal(f.calls.filter(c=>c.type==='fetch').length,0);
 assert.equal(f.writes.length,0);
 assert.equal(result.plan.bookable,false);
 assert(result.plan.estimate&&Number.isFinite(result.plan.estimate.totalMinor));
 const claims=await readSelection(result.token,SECRET,USER,NOW);
 assert.equal(claims.historyId,ROOT);
 assert.deepEqual(claims.ids,ids);
});

test('legacy missing snapshot opens every day immediately without inventing estimates',async()=>{
 for(const snapshot of [null,undefined]){
  const f=fixture({snapshot,noFetch:true}),result=await f.run('history_open');
  assert.equal(result.snapshot.source,'schedule');
  assert.equal(result.snapshot.refreshNeeded,true);
  assert.deepEqual(schedule(result.plan),structure.stops);
  assert.deepEqual([...new Set(result.plan.stops.map(s=>s.dayIndex))],[1,2]);
  assert.equal(result.plan.estimate,undefined);
  assert.equal(f.calls.filter(c=>c.type==='fetch').length,0);
  assert.equal(f.quota,0);
 }
});

test('snapshot read failure preserves the schedule and does not trigger slow automatic hydration',async()=>{
 const f=fixture({getError:true,noFetch:true}),result=await f.run('history_open');
 assert.deepEqual(schedule(result.plan),structure.stops);
 assert.equal(result.snapshot.source,'schedule');
 assert.equal(f.calls.filter(c=>c.type==='fetch').length,0);
 assert.equal(f.quota,0);
});

test('a snapshot from an earlier row revision is ignored',async()=>{
 const f=fixture({snapshot:{payload,savedAt:REV,sourceUpdatedAt:'2026-11-04T10:12:13.123455+00:00'},noFetch:true});
 const result=await f.run('history_open');
 assert.equal(result.snapshot.source,'schedule');
 assert.deepEqual(schedule(result.plan),structure.stops);
});

test('current child labels override owned parent labels while alternative candidate names are inherited',async()=>{
 const childLabels=allLabels.slice(0,4).map(p=>({...p,name:'Current child '+p.id}));
 const parentPlaces=[...allLabels,{id:'foreign_candidate',name:'Unrelated parent candidate',kind:'museum'}];
 const f=fixture({snapshot:{payload:{schemaVersion:1,places:childLabels},savedAt:REV,sourceUpdatedAt:REV},
  parentSnapshot:{payload:{schemaVersion:1,places:parentPlaces},savedAt:REV,sourceUpdatedAt:REV},noFetch:true});
 const result=await f.run('history_open');
 assert.deepEqual(result.plan.stops.map(s=>s.name),childLabels.map(p=>p.name));
 assert.deepEqual(result.places.slice(4).map(p=>p.name),allLabels.slice(4).map(p=>p.name));
 assert(!result.places.some(p=>p.id==='foreign_candidate'));
 assert.deepEqual(f.calls.filter(c=>c.name==='journeyhub_trip_snapshot_get').map(c=>[c.args.p_user_id,c.args.p_id]),[[USER,ID],[USER,ROOT]]);
 assert.equal(f.calls.filter(c=>c.type==='fetch').length,0);
});

test('microsecond-stale child labels are ignored when owned parent display labels are available',async()=>{
 const staleLabels=allLabels.map(p=>({...p,name:'Stale child '+p.id}));
 const f=fixture({snapshot:{payload:{schemaVersion:1,places:staleLabels},savedAt:REV,sourceUpdatedAt:'2026-11-04T10:12:13.123455+00:00'},
  parentSnapshot:{payload,savedAt:REV,sourceUpdatedAt:REV},noFetch:true});
 const result=await f.run('history_open');
 assert.deepEqual(result.places.map(p=>p.name),allLabels.map(p=>p.name));
 assert.deepEqual(schedule(result.plan),structure.stops);
 assert.equal(result.snapshot.source,'database');
});

test('a parent snapshot from another account is not inherited',async()=>{
 const f=fixture({snapshot:null,parentSnapshot:{payload,savedAt:REV,sourceUpdatedAt:REV},parentOwner:OTHER,noFetch:true});
 const result=await f.run('history_open');
 assert.equal(result.snapshot.source,'schedule');
 assert(result.places.every(p=>p.labelPending));
 assert(f.calls.filter(c=>c.name==='journeyhub_trip_snapshot_get').every(c=>c.args.p_user_id===USER));
 assert.equal(result.plan.estimate,undefined);
});

test('explicit refresh only hydrates selected stops, reuses English names and refreshes every day route',async()=>{
 const f=fixture(),original=structuredClone(f.history),result=await f.run('history_refresh');
 const details=f.calls.filter(c=>c.type==='fetch'&&c.url.includes('places.googleapis.com')&&c.init.headers?.['X-Goog-FieldMask']!=='id,reviews');
 assert.deepEqual(details.map(c=>new URL(c.url).pathname.split('/').at(-1)).sort(),ids.slice(0,4));
 assert.equal(f.calls.filter(c=>c.type==='fetch'&&c.url.includes('deepseek')).length,0);
 assert.equal(f.calls.filter(c=>c.type==='fetch'&&c.url.includes('routes.googleapis.com')).length,2);
 assert.deepEqual(schedule(result.plan),structure.stops);
 assert.deepEqual(result.plan.stops.map(s=>s.name),allLabels.slice(0,4).map(s=>s.name));
 assert.equal(result.plan.roadRoutes.length,2);
 assert(result.plan.roadRoutes.every(r=>r.status==='ready'));
 assert.equal(result.snapshot.refreshNeeded,false);
 assert.equal(f.quota,1);
 assert.equal(f.writes.length,1);
 assert.equal(f.writes[0].p_expected_updated_at,REV);
 assert.deepEqual(f.history,original,'refresh never alters saved selection, dates or schedule');
 assert(!JSON.stringify(f.writes[0].p_payload).includes('Transient provider street address'));
 assert(!JSON.stringify(f.writes[0].p_payload).includes('transient-route'));
});

test('search history refresh still hydrates the entire saved card collection',async()=>{
 const search={...structuredClone(row),id:ROOT,parentId:null,plan:null,wanted:[],skipped:[]};
 const f=fixture({row:search}),result=await f.run('history_refresh');
 const details=f.calls.filter(c=>c.type==='fetch'&&c.url.includes('places.googleapis.com')&&c.init.headers?.['X-Goog-FieldMask']!=='id,reviews');
 assert.deepEqual(details.map(c=>new URL(c.url).pathname.split('/').at(-1)).sort(),ids);
 assert.equal(result.plan,null);
 assert.equal(result.places.length,ids.length);
 assert.equal(f.calls.filter(c=>c.type==='fetch'&&c.url.includes('routes.googleapis.com')).length,0);
});

test('editor allCandidates refresh hydrates alternatives while the normal itinerary refresh remains selected-only',async()=>{
 for(const allCandidates of [true,false]){
  const f=fixture();
  const result=await historyAction({...f.context,value:{action:'history_refresh',id:ID,allCandidates}});
  const details=f.calls.filter(c=>c.type==='fetch'&&c.url.includes('places.googleapis.com')&&c.init.headers?.['X-Goog-FieldMask']!=='id,reviews');
  assert.deepEqual(details.map(c=>new URL(c.url).pathname.split('/').at(-1)).sort(),allCandidates?ids:ids.slice(0,4));
  assert.deepEqual(schedule(result.plan),structure.stops);
  assert.equal(result.plan.roadRoutes.length,2);
  assert(result.plan.roadRoutes.every(r=>r.status==='ready'));
  assert.equal(f.quota,1);
 }
 for(const allCandidates of ['true',1,null,[],{}]){
  const f=fixture();
  await assert.rejects(()=>historyAction({...f.context,value:{action:'history_refresh',id:ID,allCandidates}}),e=>e.code==='INVALID_INPUT');
  assert.equal(f.calls.length,0,'invalid refresh flag must not query the database or any provider');
 }
});

test('legacy Amap fast-open tokens never sign generic Saved visit labels as verified English names',async()=>{
 const amapIds=ids.map((id,i)=>'amap_B100'+i),mapId=id=>amapIds[ids.indexOf(id)];
 const amapRow={...structuredClone(row),placeIds:amapIds,wanted:row.wanted.map(mapId),skipped:row.skipped.map(mapId),
  plan:{...structure,stops:structure.stops.map(s=>({...s,id:mapId(s.id)}))}};
 const f=fixture({row:amapRow,snapshot:null,noFetch:true}),result=await f.run('history_open');
 assert(result.places.every(p=>p.labelPending&&p.name.startsWith('Saved visit ')));
 const claims=await readSelection(result.token,SECRET,USER,NOW);
 assert.equal(claims.englishNames,undefined);
 assert(!JSON.stringify(claims).includes('Saved visit'));
 const partial={schemaVersion:1,places:[{id:amapIds[0],name:'Saved Shanghai Museum',kind:'museum'}]};
 const known=fixture({row:amapRow,snapshot:{payload:partial,savedAt:REV,sourceUpdatedAt:REV},noFetch:true});
 const partialResult=await known.run('history_open'),partialClaims=await readSelection(partialResult.token,SECRET,USER,NOW);
 assert.deepEqual(partialClaims.englishNames,{[amapIds[0]]:'Saved Shanghai Museum'});
 assert(!JSON.stringify(partialClaims).includes('Saved visit'));
});

test('selectedOnly hydrate preserves stop order, travel buffers and English labels independently of the action',async()=>{
 const f=fixture();
 const result=await hydrateHistory(f.history,f.context,{selectedOnly:true,labels:allLabels});
 assert.deepEqual(schedule(result.plan),structure.stops);
 assert.deepEqual(result.places.filter(p=>!p.detailsPending).map(p=>p.id),ids.slice(0,4));
 assert(result.plan.stops.filter(s=>s.travel).every(s=>s.travel.durationMinutes===10));
 assert(result.plan.roadRoutes.every(r=>r.status==='ready'));
});

test('snapshot persistence keeps only bounded display fields and saved place IDs',async()=>{
 const dirty=[...allLabels.map(p=>({...p,lat:31.2,lng:121.4,address:'Do not store',originalName:'Do not store',photo:{url:'Do not store'},review:{text:'Do not store'},openingHours:['Do not store'],sourceURL:'Do not store',token:'Do not store',bookable:true,travel:{encodedPolyline:'Do not store'}})),{id:'foreign_id',name:'Foreign venue',kind:'museum'},allLabels[0]];
 const clean=displayPayload(row,dirty);
 assert.equal(clean.schemaVersion,1);
 assert.equal(clean.places.length,ids.length);
 assert.equal(new Set(clean.places.map(p=>p.id)).size,clean.places.length);
 for(const p of clean.places){
  assert(ids.includes(p.id));
  assert(Object.keys(p).every(k=>['id','name','kind','category','reason'].includes(k)));
 }
 assert(!JSON.stringify(clean).includes('Do not store'));
 assert(Object.keys(clean).every(k=>['schemaVersion','places'].includes(k)));
 const f=fixture();await persistDisplaySnapshot(f.rpc,USER,row,dirty);
 assert.equal(f.writes.length,1);
 assert.equal(f.writes[0].p_user_id,USER);
 assert.equal(f.writes[0].p_id,ID);
 assert.equal(f.writes[0].p_expected_updated_at,REV);
 assert.deepEqual(f.writes[0].p_payload,clean);
});

test('failed display snapshot write cannot erase a generated or refreshed itinerary',async()=>{
 const f=fixture({putError:true}),before=structuredClone(f.history);
 await assert.doesNotReject(()=>persistDisplaySnapshot(f.rpc,USER,f.history,allLabels));
 const result=await f.run('history_refresh');
 assert.deepEqual(schedule(result.plan),structure.stops);
 assert.deepEqual(f.history,before);
 assert(result.plan.roadRoutes.every(r=>r.status==='ready'));
});

test('a partial legacy label set never fabricates a complete cost estimate',async()=>{
 const f=fixture({snapshot:{payload:{schemaVersion:1,places:allLabels.slice(0,1)},savedAt:REV,sourceUpdatedAt:REV},noFetch:true});
 const result=await f.run('history_open');
 assert.deepEqual(schedule(result.plan),structure.stops);
 assert.equal(result.plan.stops[0].name,allLabels[0].name);
 assert(result.plan.stops.slice(1).every(s=>s.labelPending));
 assert.equal(result.plan.estimate,undefined);
});

test('provider outage retains all visits and existing English labels with truthful unavailable routes',async()=>{
 const f=fixture({noFetch:true}),result=await f.run('history_refresh');
 assert.deepEqual(schedule(result.plan),structure.stops);
 assert.deepEqual(result.plan.stops.map(s=>s.name),allLabels.slice(0,4).map(s=>s.name));
 assert(result.plan.stops.every(s=>s.unavailable));
 assert(result.plan.roadRoutes.every(r=>r.status==='unavailable'));
 assert.equal(result.snapshot.stale,true);
 assert.equal(f.calls.filter(c=>c.type==='fetch'&&c.url.includes('deepseek')).length,0);
});

test('refresh cannot publish a result invalidated by editing, removal or deletion',async()=>{
 for(const reason of ['revision_changed','removed','not_found']){
  const f=fixture({putResult:{ok:false,reason}});
  await assert.rejects(()=>f.run('history_refresh'),e=>e.code==='HISTORY_CHANGED');
  assert.deepEqual(f.history.plan,structure);
 }
});

test('another account cannot open or refresh this history, including its display labels',async()=>{
 for(const action of ['history_open','history_refresh']){
  const f=fixture({noFetch:true});
  await assert.rejects(()=>f.run(action,{user:{id:OTHER}}),e=>e.code==='HISTORY_NOT_FOUND');
  assert.equal(f.calls.filter(c=>c.type==='fetch').length,0);
  assert.equal(f.calls.filter(c=>c.name==='journeyhub_trip_snapshot_get').length,0);
  assert.equal(f.quota,0);
 }
});

test('HTTP handler exposes fast history_open and explicit history_refresh through authenticated routing',async()=>{
 const f=fixture(),handler=createAgentHandler({envGet:f.env,fetchImpl:f.fetcher,rpc:f.rpc,authenticate:async()=>({id:USER}),now:()=>NOW});
 const request=action=>new Request('https://fixture.invalid/journeyhub-agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:ID})});
 const opened=await handler(request('history_open'));
 assert.equal(opened.status,200);
 assert.equal((await opened.json()).snapshot.source,'database');
 assert.equal(f.calls.filter(c=>c.type==='fetch').length,0);
 const refreshed=await handler(request('history_refresh'));
 assert.equal(refreshed.status,200);
 assert.equal((await refreshed.json()).snapshot.refreshNeeded,false);
});

test('initial discovery and newly generated plan both persist labels, including unselected alternatives',async()=>{
 const records=new Map(),snapshots=new Map(),writes=[],calls=[];
 const places=Array.from({length:8},(_,i)=>({id:'new_place_'+i,displayName:{text:'Museum '+(i+1)},
  primaryType:'museum',formattedAddress:'Transient original address '+i,
  location:{latitude:31.23,longitude:121.48+i*.001},businessStatus:'OPERATIONAL'}));
 let version=0;
 const rpc=async(name,a)=>{
  if(name==='journeyhub_discovery_quota'||name==='journeyhub_refresh_quota')return null;
  if(name==='journeyhub_plan_dates_check')return {available:true};
  if(name==='journeyhub_trip_history_get'){const h=records.get(a.p_id);return h?.userId===a.p_user_id?structuredClone(h):null;}
  if(name==='journeyhub_trip_history_save'){
   if(!records.has(a.p_id))records.set(a.p_id,{id:a.p_id,userId:a.p_user_id,input:a.p_input,placeIds:a.p_place_ids,wanted:a.p_wanted,skipped:a.p_skipped,plan:a.p_plan,parentId:a.p_parent_id,createdAt:REV,updatedAt:REV});
   return structuredClone(records.get(a.p_id));
  }
  if(name==='journeyhub_trip_history_choices'){
   const h=records.get(a.p_id);assert.equal(h.userId,a.p_user_id);
   h.wanted=a.p_wanted;h.skipped=a.p_skipped;
   h.updatedAt='2026-11-04T10:12:14.'+String(++version).padStart(6,'0')+'+00:00';
   if(snapshots.has(h.id))snapshots.get(h.id).sourceUpdatedAt=h.updatedAt;
   return structuredClone(h);
  }
  if(name==='journeyhub_trip_snapshot_get'){
   const h=records.get(a.p_id);
   return h?.userId===a.p_user_id?structuredClone(snapshots.get(a.p_id)||null):null;
  }
  if(name==='journeyhub_trip_snapshot_put'){
   const h=records.get(a.p_id);assert.equal(h.userId,a.p_user_id);assert.equal(a.p_expected_updated_at,h.updatedAt);
   writes.push(structuredClone(a));snapshots.set(h.id,{payload:a.p_payload,savedAt:REV,sourceUpdatedAt:h.updatedAt});
   return {ok:true,savedAt:REV};
  }
  throw Error('Unexpected generation RPC '+name);
 };
 const fetcher=async(url,init={})=>{
  const u=new URL(url);calls.push(u.hostname+u.pathname);
  if(u.hostname==='api.deepseek.com'){
   const body=JSON.parse(init.body),system=body.messages[0].content,data=JSON.parse(body.messages[1].content);
   let answer;
   if(system.includes('requirements analyst'))answer={queries:[{category:'Museums',query:'Shanghai museums'}]};
   else if(system.includes('travel curator'))answer={places:places.map(p=>({id:p.id,name:p.displayName.text,category:'Museums',reason:'Requested culture'}))};
   else {assert(system.includes('self-guided itinerary'));answer={summary:'A complete museum day',stops:data.places.map((p,i)=>({placeId:p.id,day:1,start:i?'12:00':'09:00',end:i?'13:00':'10:00',reason:'Requested culture'}))};}
   return Response.json({choices:[{message:{content:JSON.stringify(answer)}}]});
  }
  if(u.pathname.endsWith('places:searchText'))return Response.json({places});
  if(u.hostname==='places.googleapis.com')return Response.json(places.find(p=>p.id===u.pathname.split('/').at(-1)));
  if(u.hostname==='routes.googleapis.com')return Response.json({routes:[{distanceMeters:500,duration:'600s',polyline:{encodedPolyline:'transient-only-route'},legs:[{distanceMeters:500,duration:'600s'}]}]});
  throw Error('Unexpected generation provider '+url);
 };
 const env=name=>({DEEPSEEK_API_KEY:'fixture-only-ai',GOOGLE_PLACES_API_KEY:'fixture-only-map'}[name]);
 const context={user:{id:USER},secret:SECRET,now:NOW,rpc,fetcher,env};
 const found=await discoveryAction({...context,value:{action:'discover',requestId:ROOT,...input,date:'2026-11-12',days:1,prompt:'Museums'}});
 assert.equal(found.historyId,ROOT);
 assert.equal(found.places.length,8);
 assert.equal(writes.length,1);
 assert.equal(snapshots.get(ROOT).payload.places.length,8);
 const selected=found.places.slice(0,2).map(p=>p.id),unselected=found.places.slice(2).map(p=>p.id);
 const planned=await discoveryAction({...context,value:{action:'discover_plan',token:found.token,wanted:selected,skipped:unselected}});
 assert(planned.historyId&&planned.historyId!==ROOT);
 assert.deepEqual(planned.plan.stops.map(s=>s.id),selected);
 assert.equal(writes.length,2,'one search snapshot plus one itinerary snapshot');
 assert.equal(snapshots.get(planned.historyId).payload.places.length,8,'child stores selected and unselected display labels');
 assert.deepEqual(new Set(snapshots.get(planned.historyId).payload.places.map(p=>p.id)),new Set(found.places.map(p=>p.id)));
 assert(!JSON.stringify(writes).includes('Transient original address'));
 assert(!JSON.stringify(writes).includes('transient-only-route'));
 const providerCount=calls.length;
 const reopened=await historyAction({...context,value:{action:'history_open',id:planned.historyId}});
 assert.equal(calls.length,providerCount,'reopening the newly generated itinerary buys no provider or AI call');
 assert.deepEqual(reopened.places.map(p=>p.name),found.places.map(p=>p.name));
 assert.deepEqual(schedule(reopened.plan),schedule(planned.plan));
});
