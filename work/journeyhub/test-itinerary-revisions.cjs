/* Authoritative revision and budget tests. All provider transport and DB RPCs mocked. */
const assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
globalThis.crypto??=webcrypto;
const copy=x=>JSON.parse(JSON.stringify(x)),uuid=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
 const {revisionAction,reflowStops}=await import('./supabase/functions/journeyhub-agent/revisions.mjs');
 const {validateInput,WorkflowError}=await import('./supabase/functions/journeyhub-agent/planner.mjs');
 const {validateDiscovery,readSelection,hydrateHistory}=await import('./supabase/functions/journeyhub-agent/discovery.mjs');
 const {createAgentHandler}=await import('./supabase/functions/journeyhub-agent/handler.mjs');
 const now=new Date('2026-11-04T03:00:00Z'),owner={id:uuid(1)},secret='local-test-signing-secret',historyId=uuid(2);
 const input={city:'Shanghai',date:'2026-11-08',days:2,guests:2,prompt:'',dayStart:'09:00',dayEnd:'18:00',transport:'drive',budgetCurrency:'USD',budgetAmount:50,budgetScope:'group'};
 const valid=value=>validateInput({action:'plan',requestId:uuid(3),...input,...value},now).input;
 assert.equal(valid({}).budgetCnyMinor,35000);assert.equal(valid({budgetScope:'person',guests:3}).budgetCnyMinor,105000);assert.equal(valid({budgetScope:'person',guests:3}).budgetThb,5250);
 assert.equal(valid({budgetCurrency:'THB',budgetAmount:500,budgetScope:'group',guests:6}).budgetCnyMinor,10000,'whole-trip group budget never multiplied by days or guests');
 assert.equal(valid({budgetCurrency:'SGD',budgetAmount:10,budgetScope:'person',guests:2}).budgetCnyMinor,10000);
 assert.equal(valid({budgetCurrency:'CNY',budgetAmount:100,budgetCnyMinor:99999999,budgetThb:99999999}).budgetCnyMinor,10000,'caller canonical totals ignored');
 assert.equal(valid({budgetAmount:null,budgetCnyMinor:999999}).budgetCnyMinor,null);
 for(const value of [{budgetCurrency:'EUR'},{budgetScope:'day'},{budgetAmount:-1},{budgetAmount:0},{budgetAmount:1.234},{budgetAmount:1000001},{budgetAmount:'100'}])assert.throws(()=>valid(value),e=>e.code==='INVALID_INPUT');
 assert.equal(valid({}).prompt,'');assert(validateDiscovery(input,now).prompt.length>0,'discovery supplies a balanced fallback for optional prompt');
 const ids=['museum_a','museum_b','cafe_c','restaurant_d'];
 const raw=id=>({id,displayName:{text:id==='museum_a'?'Museum Alpha':id==='museum_b'?'Museum Beta':id==='cafe_c'?'Cafe Gamma':'Restaurant Delta'},formattedAddress:'Provider street address',location:{latitude:31.23+ids.indexOf(id)*.001,longitude:121.48},primaryType:id==='restaurant_d'?'restaurant':id==='cafe_c'?'cafe':'museum',businessStatus:'OPERATIONAL'});
 const record={id:historyId,owner:owner.id,input:valid({}),placeIds:ids,wanted:ids.slice(0,3),skipped:[],plan:{summary:'Original plan',stops:[{id:ids[0],dayIndex:1,start:'09:00',end:'10:00',reason:'Original museum'},{id:ids[1],dayIndex:1,start:'10:30',end:'11:30',reason:'Second museum'},{id:ids[2],dayIndex:2,start:'09:00',end:'10:00',reason:'Coffee'}]},updatedAt:'2026-11-04T02:00:00.000001Z'};
 let row=copy(record),rpcCalls=[],fetchCalls=[],routeMinutes=35,missingId=null;const receipts=new Map();
 const env=n=>({GOOGLE_PLACES_API_KEY:'fixture-places',GOOGLE_ROUTES_API_KEY:'fixture-routes'}[n]);
 const fetcher=async(url,options={})=>{
  fetchCalls.push({url:String(url),body:options.body?JSON.parse(options.body):null});
  if(String(url).includes('routes.googleapis.com')){const body=JSON.parse(options.body),count=1+(body.intermediates?.length||0);return Response.json({routes:[{distanceMeters:count*3000,duration:count*routeMinutes*60+'s',polyline:{encodedPolyline:'fixture-polyline'},legs:Array.from({length:count},()=>({distanceMeters:3000,duration:routeMinutes*60+'s'}))}]});}
  const id=new URL(url).pathname.split('/').at(-1);assert(ids.includes(id),'no forged places sent to provider');if(id===missingId)return Response.json({error:'Unavailable'},{status:503});
  return Response.json(raw(id));
 };
 const rpc=async(name,args)=>{
  rpcCalls.push({name,args:copy(args)});
  if(name==='journeyhub_trip_history_get')return args.p_user_id===owner.id&&args.p_id===historyId?copy(row):null;
  if(name==='journeyhub_discovery_quota')return null;
  if(name==='journeyhub_trip_history_revise'){
   assert.equal(args.p_user_id,owner.id);assert.equal(args.p_id,historyId);
   if(receipts.has(args.p_request_id))return copy(receipts.get(args.p_request_id));
   if(args.p_expected_updated_at!==row.updatedAt)throw new WorkflowError('PLAN_EDIT_STALE','This itinerary changed. Preview again.',409);
   row={...row,input:copy(args.p_input),plan:copy(args.p_plan),wanted:args.p_plan.stops.map(s=>s.id),updatedAt:'2026-11-04T03:10:00.000002Z'};receipts.set(args.p_request_id,copy(row));return copy(row);
  }
  throw Error('Unexpected RPC: '+name);
 };
 const call=(value,overrides={})=>revisionAction({value,user:owner,now,rpc,secret,env,fetcher,...overrides});
 const stops=[{id:ids[3],dayIndex:1},{id:ids[1],dayIndex:1},{id:ids[2],dayIndex:2}];
 const request={action:'discover_revise',historyId,requestId:uuid(4),stops,input:{...input,guests:3,dayStart:'10:00',budgetScope:'person'}};
 const unchanged=JSON.stringify(row),preview=await call(request);assert.equal(preview.historyId,historyId);assert.equal(preview.bookingsUnchanged,true);assert.equal(JSON.stringify(row),unchanged,'preview is read-only');assert(!rpcCalls.some(c=>c.name==='journeyhub_trip_history_revise'));
 assert.equal(fetchCalls.filter(c=>c.url.includes('routes.googleapis.com')).length,1,'preview calculates the changed route once, without first routing the old itinerary');
 assert.equal(preview.input.budgetCnyMinor,105000);assert.equal(preview.plan.stops[0].id,ids[3]);assert.equal(preview.plan.stops[0].name,'Restaurant Delta');assert.equal(preview.plan.stops[0].start,'10:00');assert.equal(preview.plan.stops[0].end,'11:30','new restaurant gets actual visit duration');
 assert.equal(preview.plan.stops[1].start,'12:15','fresh route plus buffer shifts the next visit');assert.equal(preview.plan.stops[1].travel.durationMinutes,35);assert.equal(preview.plan.stops[1].travelConflict,false);assert.equal(preview.plan.roadRoutes[0].status,'ready');
 assert.equal(preview.plan.estimate.totalMinor,33000,'server recomputes 3 guests × (50 restaurant + 40 museum + 20 cafe)');assert.equal(preview.plan.estimate.budgetCnyMinor,105000);assert.equal(preview.plan.estimate.budgetExceeded,false);
 const signed=await readSelection(preview.revisionToken,secret,owner.id,now);assert.equal(signed.baseVersion,record.updatedAt);assert.equal(signed.historyId,historyId);assert(!JSON.stringify(signed).includes('Provider street'),'token stores trusted structure only');assert.deepEqual(signed.plan.stops.map(s=>s.id),stops.map(s=>s.id));
 const beforeApplyRPC=rpcCalls.length;
 for(const overrides of [{user:{id:uuid(99)}},{now:new Date(now.getTime()+16*60000)}])await assert.rejects(()=>call({action:'discover_revise_apply',historyId,requestId:uuid(5),revisionToken:preview.revisionToken},overrides),e=>e.code==='SEARCH_EXPIRED');
 await assert.rejects(()=>call({action:'discover_revise_apply',historyId,requestId:uuid(5),revisionToken:preview.revisionToken+'x'}),e=>e.code==='SEARCH_EXPIRED');assert.equal(rpcCalls.length,beforeApplyRPC,'bad signatures, owners and expiry never reach save RPC');
 await assert.rejects(()=>call({...request,stops:[{id:'forged',dayIndex:1},{id:ids[2],dayIndex:2}]}),e=>e.code==='INVALID_EDIT');
 await assert.rejects(()=>call({...request,stops:[{id:ids[0],dayIndex:1},{id:ids[1],dayIndex:1}]}),e=>e.code==='INVALID_EDIT');
 await assert.rejects(()=>call({...request,stops:[{id:ids[0],dayIndex:1},{id:ids[0],dayIndex:2}]}),e=>e.code==='INVALID_EDIT');
 await assert.rejects(()=>call({...request,input:{...request.input,city:'Singapore'}}),e=>e.code==='INVALID_EDIT');
 await assert.rejects(()=>call(request,{user:{id:uuid(90)}}),e=>e.code==='HISTORY_NOT_FOUND');
 missingId=ids[3];await assert.rejects(()=>call(request),e=>e.code==='INVALID_EDIT');missingId=null;
 await assert.rejects(()=>call({...request,input:{...request.input,dayEnd:'12:00'}}),e=>e.code==='EDIT_TIME_WINDOW');
 routeMinutes=200;await assert.rejects(()=>call({...request,input:{...request.input,dayEnd:'14:00'}}),e=>e.code==='EDIT_TIME_WINDOW','authoritative road travel can make a formerly fitting route infeasible');routeMinutes=35;
 row.updatedAt='2026-11-04T03:01:00.000002Z';await assert.rejects(()=>call({action:'discover_revise_apply',historyId,requestId:uuid(6),revisionToken:preview.revisionToken}),e=>e.code==='PLAN_EDIT_STALE');row.updatedAt=record.updatedAt;
 const applied=await call({action:'discover_revise_apply',historyId,requestId:uuid(7),revisionToken:preview.revisionToken});assert.equal(applied.historyId,historyId);assert.equal(applied.plan.stops[0].name,'Restaurant Delta');assert.equal(applied.plan.estimate.totalMinor,33000);assert.equal(applied.bookingsUnchanged,true);assert.equal(row.plan.stops[0].start,'10:00');assert.equal(row.plan.stops[1].start,'12:15');
 const reopened=await hydrateHistory(row,{user:owner,env,fetcher,now,secret});assert.deepEqual(reopened.plan.stops.map(s=>[s.id,s.dayIndex,s.start,s.end]),applied.plan.stops.map(s=>[s.id,s.dayIndex,s.start,s.end]));
 const repeated=await call({action:'discover_revise_apply',historyId,requestId:uuid(7),revisionToken:preview.revisionToken});assert.equal(repeated.historyId,historyId);assert.equal(receipts.size,1,'same apply request uses one saved revision');
 assert(rpcCalls.every(c=>['journeyhub_trip_history_get','journeyhub_discovery_quota','journeyhub_trip_history_revise','journeyhub_trip_snapshot_put'].includes(c.name)),'revision path cannot reserve, charge, cancel or reschedule');assert(fetchCalls.every(c=>/places\.googleapis\.com|routes\.googleapis\.com/.test(c.url)),'no AI or booking transport during revision');
 const plain=[{id:'a',lat:31.23,lng:121.48,kind:'museum'},{id:'b',lat:31.231,lng:121.48,kind:'restaurant'}];assert.throws(()=>reflowStops([{id:'a',dayIndex:1}],plain,{...input,days:2},null),e=>e.code==='INVALID_EDIT');
 const http=value=>new Request('https://journey.fixture/functions/v1/journeyhub-agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
 const handler=createAgentHandler({envGet:n=>n==='JOURNEYHUB_DISCOVERY_SIGNING_KEY'?secret:env(n),authenticate:async()=>owner,rpc,fetchImpl:fetcher,now:()=>now});
 const response=await handler(http({...request,requestId:uuid(8),input:{...request.input,budgetCurrency:'CNY',budgetAmount:1,budgetScope:'group'}}));assert.equal(response.status,200);const overBudget=await response.json();assert.equal(overBudget.plan.estimate.budgetExceeded,true);assert.equal(overBudget.plan.estimate.budgetCnyMinor,100);assert.equal(overBudget.historyId,historyId);
 const rejected=await handler(http({...request,requestId:uuid(9),stops:[{id:'fake',dayIndex:1}]}));assert.equal(rejected.status,400);assert.equal((await rejected.json()).error.code,'INVALID_EDIT');
 const beforeDenied=rpcCalls.length,denied=createAgentHandler({envGet:env,authenticate:async()=>{throw new WorkflowError('SIGN_IN_REQUIRED','Sign in.',401);},rpc,fetchImpl:fetcher,now:()=>now});assert.equal((await denied(http(request))).status,401);assert.equal(rpcCalls.length,beforeDenied,'unauthenticated revision never reaches database');
 console.log('PASS: authoritative whole-trip raw budget conversion and optional prompt; signed same-history revision preview/apply; ID/day/owner/tamper/expiry/stale checks; route/window/cost rebuild; reopening/idempotent RPC contract; no booking side effects. Providers and persistence mocked.');
})().catch(error=>{console.error(error);process.exitCode=1;});
