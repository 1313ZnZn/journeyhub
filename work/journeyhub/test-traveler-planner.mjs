import assert from 'node:assert/strict';
import {plannerStep,explicitInterests} from './supabase/functions/journeyhub-agent/traveler-planner.mjs';
import {signSelection,validateDiscovery} from './supabase/functions/journeyhub-agent/discovery.mjs';

const owner='11111111-1111-4111-8111-111111111111',root='22222222-2222-4222-8222-222222222222',now=new Date('2026-11-05T10:00:00Z'),secret='local-test-signing-secret-only';
const input={city:'Shanghai',date:'2026-11-12',days:2,dayStart:'09:00',dayEnd:'21:00',guests:2,transport:'drive',budget:null,prompt:'Shanghai local food, Italian restaurants, popular matcha and museums.'};
const env=name=>({DEEPSEEK_API_KEY:'test-only',AMAP_WEB_SERVICE_KEY:'test-only'})[name]||'';
const queries=[{category:'Local food',query:'本帮菜'},{category:'Italian',query:'意大利餐厅'},{category:'Matcha',query:'抹茶'},{category:'Museums',query:'博物馆'}];
const cat={本帮菜:'Local food',意大利餐厅:'Italian',抹茶:'Matcha',抹茶甜品:'Matcha',博物馆:'Museums'};
const prefixes={'Local food':'BL','Italian':'BI','Matcha':'BT','Museums':'BM'};
const poi=(category,i)=>({id:prefixes[category]+i,name:category+' Venue '+i,location:(121.47+i*.001)+',31.23',typecode:category==='Museums'?'140100':'050000',type:category==='Museums'?'博物馆':'餐厅',address:'Test Road '+i,cityname:'上海',photos:[{url:'https://aos-cdn-image.amap.com/fixture-'+category.replaceAll(' ','')+i+'.jpg'}]});
const call=(name,args)=>({name,args});
function harness(decisions,{emptyMatcha=false,searchResult=null,facts=[]}={}){
 const history=new Map(),requests=[],tools=[],offeredTools=[];let modelIndex=0,routeCalls=0;
 const rpc=async(name,args)=>{
  if(name==='journeyhub_plan_dates_check')return{available:true};
  if(name==='journeyhub_planner_search_result')return searchResult;
  if(name==='journeyhub_planner_visit_facts')return facts;
  if(name==='journeyhub_planner_save_facts')return{saved:args.p_facts.length};
  if(name==='journeyhub_trip_history_get')return history.get(args.p_id)||null;
  if(name==='journeyhub_trip_snapshot_get')return null;
  if(name==='journeyhub_trip_snapshot_put')return{ok:true};
  if(name==='journeyhub_trip_history_choices')return{id:args.p_id};
  if(name==='journeyhub_trip_history_save'){const row={id:args.p_id,input:args.p_input,placeIds:args.p_place_ids,updatedAt:now.toISOString(),plan:args.p_plan};history.set(row.id,row);return row;}
  throw Error('Unexpected RPC '+name);
 };
 const fetcher=async(url,options={})=>{
  if(url.includes('/chat/completions')){
   const body=JSON.parse(options.body);assert.equal(body.tool_choice,'auto');assert.equal(body.parallel_tool_calls,false);assert.ok(body.tools.length>=2);assert.ok(!body.tools.some(t=>/book|pay|staff|cancel/.test(t.function.name)));offeredTools.push(body.tools.map(t=>t.function.name));
   const d=decisions[modelIndex++];assert.ok(d,'No mocked decision remains');requests.push(JSON.parse(body.messages[1].content));
   if(d.invalid)return Response.json({choices:[{finish_reason:'stop',message:{content:'No tools'}}]});
   const calls=d.calls||[d];tools.push(...calls.map(c=>c.name));return Response.json({choices:[{finish_reason:'tool_calls',message:{tool_calls:calls.map((c,i)=>({id:'c'+modelIndex+'_'+i,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}}],usage:{prompt_tokens:120,completion_tokens:30}});
  }
  const u=new URL(url);
  if(u.pathname.endsWith('/text')){const query=u.searchParams.get('keywords');return Response.json({status:'1',pois:emptyMatcha&&(query==='抹茶'||emptyMatcha==='all'&&query==='抹茶甜品')?[]:Array.from({length:4},(_,i)=>poi(cat[query],i))});}
  if(u.pathname.endsWith('/detail')){const id=u.searchParams.get('id'),category=Object.keys(prefixes).find(k=>id.startsWith(prefixes[k]));return Response.json({status:'1',pois:[poi(category,Number(id.at(-1)))]});}
  if(u.pathname.includes('/direction/')){routeCalls++;return Response.json({status:'1',route:{paths:[{distance:'2000',duration:'5400',steps:[{polyline:'121.47,31.23;121.48,31.24'}]}]}});}
  throw Error('Unexpected URL '+u.origin+u.pathname);
 };
 return{context:{env,fetcher,rpc,now,secret},history,requests,tools,offeredTools,get routeCalls(){return routeCalls;},get modelCount(){return modelIndex;}};
}
const ranked=(categories=['Local food','Italian','Matcha','Museums'])=>({places:categories.flatMap(category=>Array.from({length:3},(_,i)=>({id:'amap_'+prefixes[category]+i,category,name:category+' Venue '+i,addressEnglish:'Test Road '+i,reason:'Matches '+category}))) });
async function run(task,h,limit=30){const outcomes=[];for(let i=0;i<limit;i++){const r=await plannerStep(task,h.context);outcomes.push(r);task={...task,state:JSON.parse(JSON.stringify(r.state))};if(r.status!=='running')return{task,result:r,outcomes};}throw Error('Loop did not finish');}

assert.deepEqual(explicitInterests(input.prompt).map(x=>x.category),['Local food','Italian','Matcha','Museums']);
assert.deepEqual(explicitInterests('Avoid museums. I want matcha.').map(x=>x.category),['Matcha']);
assert.deepEqual(explicitInterests('Not only museums, also Italian food').map(x=>x.category),['Italian','Museums']);

// The first model attempt omits required categories. The guard returns an
// observation, then the MODEL chooses a broader search and later supplements it.
const incomplete=ranked(['Local food','Italian','Museums']);
incomplete.places.push({id:'amap_BL3',category:'Local food',name:'Local food Venue 3',addressEnglish:'Road 3',reason:'Local food'});
const h=harness([call('search_places',{queries:[queries[3]]}),call('search_places',{queries}),call('select_cards',incomplete),call('search_places',{queries:[{category:'Matcha',query:'抹茶甜品'}]}),call('select_cards',ranked())],{emptyMatcha:true});
const searchTask={id:root,userId:owner,kind:'discover',payload:{...input,requestId:root},state:null};
const found=await run(searchTask,h);
assert.equal(found.result.status,'completed');assert.equal(found.result.result.places.length,12);assert.equal(new Set(found.result.result.places.map(p=>p.category)).size,4);
assert.equal(h.requests[1].lastObservation.ok,false);assert.match(h.requests[1].lastObservation.message,/omitted/);
assert.equal(h.requests[3].lastObservation.ok,false);assert.deepEqual(h.requests[3].lastObservation.issues[0].missingCategories,['Matcha']);
assert.equal(found.task.state.searched.length,5);assert.ok(found.result.result.places.every(p=>p.photo&&/[A-Za-z]/.test(p.name)));
const finishedAgain=await plannerStep(found.task,h.context);assert.equal(finishedAgain.status,'completed');assert.equal(h.modelCount,5,'a completed task does not call the model again');

// Restoring the serializable checkpoint must not repeat the successful searches.
assert.equal(h.requests[4].priorQueries.length,5);
const selected=['amap_BM0','amap_BL0','amap_BI0','amap_BT0'];
const selection={owner,input,ids:found.result.result.places.map(p=>p.id),historyId:root,expires:now.getTime()+3600000};
const token=await signSelection(selection,secret);
const schedule=(museumStart='09:00',museumEnd='10:00',teaStart='13:30',teaEnd='14:30')=>({summary:'Two days with food, matcha and a museum.',stops:[{placeId:selected[0],day:1,start:museumStart,end:museumEnd,reason:'Museum visit'},{placeId:selected[1],day:1,start:'12:00',end:'13:00',reason:'Local lunch'},{placeId:selected[2],day:2,start:'12:00',end:'13:00',reason:'Italian lunch'},{placeId:selected[3],day:2,start:teaStart,end:teaEnd,reason:'Matcha break'}]});
const closedHours=schedule('18:00','19:00');closedHours.stops[1]={...closedHours.stops[1],start:'20:00',end:'21:00'};
const facts=[{id:selected[0],date:'2026-11-12',state:'verified',fields:{hours:{text:'09:00–17:00',url:'https://www.shanghaimuseum.net/visit',basis:'regular'}}}];
const ph=harness([call('propose_schedule',closedHours),call('finish_plan',{}),call('propose_schedule',schedule()),call('check_routes',{}),call('finish_plan',{})],{searchResult:found.result.result,facts});
const planned=await run({id:'33333333-3333-4333-8333-333333333333',userId:owner,kind:'discover_plan',payload:{token,selection,wanted:selected,skipped:[]},state:null},ph);
assert.equal(planned.result.status,'completed');assert.equal(planned.result.result.plan.stops.length,4);assert.equal(new Set(planned.result.result.plan.stops.map(p=>p.dayIndex)).size,2);
assert.equal(ph.requests[1].validation.issues[0].type,'opening_hours');
assert.deepEqual(ph.requests[4].validation.routeConflicts,[]);
assert.equal(ph.routeCalls,2,'repair does not fetch the same road routes again');
const repairedTea=planned.result.result.plan.stops.find(p=>p.id==='amap_BT0');
assert.equal(repairedTea.start,'14:40');assert.equal(repairedTea.end,'15:40','repair preserves the full visit duration');
assert.equal(planned.result.result.plan.scheduleAdjusted,true);
const late=schedule('09:00','10:00','20:00','21:00');
late.stops[2]={...late.stops[2],start:'18:00',end:'19:30'};
const blocked=harness([call('propose_schedule',late),call('check_routes',{}),call('report_limit',{})],{searchResult:found.result.result,facts});
const blockedPlan=await run({id:'77777777-7777-4777-8777-777777777777',userId:owner,kind:'discover_plan',payload:{token,selection,wanted:selected,skipped:[]},state:null},blocked);
// The model gave up after one route conflict. The built-in scheduler finishes
// with real road times instead: every must-visit stays, no conflict remains.
assert.equal(blocked.requests[2].validation.routeConflicts[0].placeId,'amap_BT0');
assert.equal(blockedPlan.result.status,'completed');
assert.equal(blocked.modelCount,3,'the scheduler finishes without further model calls');
assert.ok(selected.every(id=>blockedPlan.result.result.plan.stops.some(p=>p.id===id)),'no must-visit place is dropped');assert.ok(blockedPlan.result.result.plan.stops.length<=8,'a 2-day trip holds at most 8 places');
assert.equal(blockedPlan.result.result.plan.stops.some(p=>p.travelConflict),false);
assert.ok(blockedPlan.outcomes.some(o=>o.events?.some(e=>e.tool==='scheduler')),'the switch to the scheduler is visible');
for(const day of [1,2]){const stops=blockedPlan.result.result.plan.stops.filter(p=>p.dayIndex===day);for(let i=1;i<stops.length;i++){const gap=Number(stops[i].start.slice(0,2))*60+Number(stops[i].start.slice(3))-(Number(stops[i-1].end.slice(0,2))*60+Number(stops[i-1].end.slice(3)));assert.ok(gap>=100,'checked 90 min road time plus buffer is respected');}}
// Must-visits that cannot fit the daily window get a clear request, not a vague limit.
const tight={...selection,input:{...input,days:1,dayStart:'09:00',dayEnd:'12:00'}};
const tightHarness=harness([call('propose_schedule',schedule()),call('report_limit',{reason:'Too many places.'})],{searchResult:found.result.result,facts});
const tightPlan=await run({id:'99999999-9999-4999-8999-999999999999',userId:owner,kind:'discover_plan',payload:{token,selection:tight,wanted:selected,skipped:[]},state:null},tightHarness);
assert.equal(tightPlan.result.status,'needs_input');assert.match(tightPlan.result.error.message,/Not enough time for .+ within your daily hours/);assert.equal(tightHarness.history.size,0);
assert.equal(tightPlan.result.error.details.reason,'time','the app is told which fix to offer');assert.equal(tightPlan.result.error.details.dayEnd,'12:00');assert.equal(tightPlan.result.error.details.days,1);
// Places the traveler put on a day in the tray stay on that day, in that order.
const placedHarness=harness([call('propose_schedule',schedule()),call('report_limit',{reason:'Use the scheduler.'})],{searchResult:found.result.result,facts});
const dayPlan=[[selected[2],selected[1]],[selected[3],selected[0]]];
const placedPlan=await run({id:'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb',userId:owner,kind:'discover_plan',payload:{token,selection,wanted:selected,skipped:[],dayPlan},state:null},placedHarness);
if(placedPlan.result.status==='completed'){
 const stopsOf=day=>placedPlan.result.result.plan.stops.filter(p=>p.dayIndex===day).map(p=>p.id);
 for(const [d,ids] of dayPlan.entries()){const got=stopsOf(d+1).filter(id=>ids.includes(id));assert.deepEqual(got,ids,'day '+(d+1)+' keeps the tray order');}
}else assert.equal(placedPlan.result.status,'needs_input');

// A provider outage during planning no longer stops the trip.
const outage=harness([],{searchResult:found.result.result,facts});const outageFetch=outage.context.fetcher;
outage.context.fetcher=async(url,o)=>url.includes('/chat/completions')?new Response('upstream error',{status:503}):outageFetch(url,o);
const outagePlan=await run({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',userId:owner,kind:'discover_plan',payload:{token,selection,wanted:selected,skipped:[]},state:null},outage);
assert.equal(outagePlan.result.status,'completed');assert.ok(selected.every(id=>outagePlan.result.result.plan.stops.some(p=>p.id===id)));
assert.equal(planned.result.result.plan.stops.some(p=>p.travelConflict),false);
assert.equal(planned.result.result.plan.bookable,false);assert.ok(planned.result.result.plan.notice.includes('No reservations or payments'));
assert.ok(ph.history.has(planned.result.result.historyId));

// Missing official museum facts force a real registered research tool decision.
// If the official-source lookup cannot verify them, the outcome stays unknown;
// it is never turned into a closure or an all-clear.
const rh=harness([call('propose_schedule',schedule('09:00','10:00','15:00','16:00')),call('check_routes',{}),call('finish_plan',{}),call('research_venue',{placeId:'amap_BM0',date:'2026-11-12'}),call('finish_plan',{})],{searchResult:found.result.result});
let researchCalls=0;rh.context.researchVenue=async(job)=>{researchCalls++;assert.equal(job.stop_id,'amap_BM0');assert.equal(job.visit_date,'2026-11-12');return{state:'unconfirmed',facts:{}};};
const researched=await run({id:'66666666-6666-4666-8666-666666666666',userId:owner,kind:'discover_plan',payload:{token,selection,wanted:selected,skipped:[]},state:null},rh);
assert.equal(researched.result.status,'completed');assert.equal(researchCalls,1);assert.match(rh.requests[3].lastObservation.message,/official information/);assert.equal(researched.result.result.plan.openingHoursVerified,false);assert.ok(researched.result.result.plan.agent.openingHoursUnknown.includes('amap_BM0'));

// A renewed worker may resume after the original browser selection token expired.
const resumed={...planned.task,state:{...planned.task.state,result:undefined}};resumed.state.decisions=resumed.state.limit;
// At the decision cap the scheduler finishes from the saved state without the model.
const before=ph.modelCount;let capTask=resumed,capped;
for(let i=0;i<20;i++){capped=await plannerStep(capTask,{...ph.context,now:new Date('2026-11-06T10:00:00Z')});capTask={...capTask,state:JSON.parse(JSON.stringify(capped.state))};if(capped.status!=='running')break;}
assert.equal(capped.status,'completed');assert.equal(ph.modelCount,before);
await assert.rejects(()=>plannerStep({...planned.task,userId:'44444444-4444-4444-8444-444444444444'},ph.context),e=>e.code==='TASK_OWNER_MISMATCH');

// A model cannot return ordinary prose or invent a tool and bypass validation.
const mh=harness([{invalid:true},call('delete_reservations',{}),call('search_places',{queries})]);
let mt={...searchTask,id:'55555555-5555-4555-8555-555555555555',state:null};
let mr=await plannerStep(mt,mh.context);assert.equal(mr.status,'running');assert.match(mr.state.observation.message,/tool call/);mt.state=mr.state;
mr=await plannerStep(mt,mh.context);assert.match(mr.state.observation.message,/not available/);

// Production convergence regression:114 candidates and28 attempted inspections
// must not cause every subsequent model prompt to carry114 full POIs or invite
// another exhaustive inspection pass. It still uses auto tool selection and
// the exact target/category guards before successful completion.
const crowded=JSON.parse(JSON.stringify(found.task.state));delete crowded.result;
crowded.records=[...found.result.result.places,...Array.from({length:102},(_,i)=>({...found.result.result.places[i%12],id:'amap_BX'+i,name:'Extra candidate '+i,originalName:'Additional verified venue '+i}))];
crowded.decisions=9;crowded.inspectionCount=28;crowded.inspectedIds=crowded.records.slice(0,28).map(p=>p.id);crowded.usage={inputTokens:90000,outputTokens:5000};
const ch=harness([call('inspect_places',{ids:ranked().places.slice(0,4).map(p=>p.id)}),call('select_cards',ranked())]);
const converged=await run({...searchTask,state:crowded},ch);
assert.equal(converged.result.status,'completed');assert.equal(converged.result.result.places.length,12);assert.equal(converged.task.state.inspectionCount,28);assert.ok(ch.requests.every(r=>r.places.length<=36));assert.ok(ch.requests.every(r=>JSON.stringify(r).length<20000));assert.ok(ch.offeredTools.every(t=>!t.includes('inspect_places')));assert.ok(ch.requests.every(r=>r.inspectionCount===28&&r.inspectedIds.length===28));

// DeepSeek may return parallel search toolcalls even when disabled. Merge only
// registered same-tool searches within the existing six-query tool boundary.
const bh=harness([{calls:queries.map(q=>call('search_places',{queries:[q]}))},call('select_cards',ranked())]);
const batched=await run({...searchTask,state:null},bh);assert.equal(batched.result.status,'completed');assert.equal(batched.task.state.searched.length,4);
// A missing interest after a supplemental search should not discard valid cards.
const partialRank=ranked(['Local food','Italian','Museums']);
const partialHarness=harness([call('search_places',{queries}),call('select_cards',partialRank),call('search_places',{queries:[{category:'Matcha',query:'抹茶甜品'}]}),call('select_cards',partialRank)],{emptyMatcha:'all'});
const partial=await run({...searchTask,state:null},partialHarness);
assert.equal(partial.result.status,'completed');
assert.equal(partial.result.result.places.length,9);
assert.deepEqual(partial.result.result.missingCategories,['Matcha']);
assert.equal(partial.result.result.cardCountShortfall,3);

// One CNY 40 museum plus one CNY 50 meal for two travelers fits
// USD 27 as a group (demo CNY 189), but adding another meal does not.
const budgetInput=validateDiscovery({...input,budgetAmount:27,budgetCurrency:'USD',budgetScope:'group'},now);
const budgetSelection={...selection,input:budgetInput};
const wanted=[selected[0]],skipped=[selected[3]];
const budgetTask={id:'88888888-8888-4888-8888-888888888888',userId:owner,kind:'discover_plan',payload:{token,selection:budgetSelection,wanted,skipped},state:null};
const withStops=(...stops)=>({summary:'An itinerary for your trip.',stops});
const [museum,meal,anotherMeal,tea]=schedule().stops;
const unknown={...anotherMeal,placeId:'amap_BI1'};
const modifiedSearch={...found.result.result,places:found.result.result.places.map(p=>p.id===unknown.placeId?{...p,kind:'other',name:'Unclassified venue'}:p)};
const budgetHarness=harness([
 call('propose_schedule',withStops(meal)),
 call('propose_schedule',withStops(museum,tea)),
 call('propose_schedule',withStops(museum,meal,anotherMeal)),
 call('propose_schedule',withStops(museum,unknown)),
 call('propose_schedule',withStops(museum,meal)),
 call('check_routes',{}),call('finish_plan',{})
],{searchResult:modifiedSearch,facts});
const budgeted=await run(budgetTask,budgetHarness);
assert.equal(budgeted.result.status,'completed');
assert.deepEqual(budgetHarness.requests[0].mustVisitPlaceIds,wanted);
assert.ok(budgetHarness.requests[0].optionalPlaceIds.includes(meal.placeId));
assert.ok(!budgetHarness.requests[0].optionalPlaceIds.includes(tea.placeId));
assert.match(budgeted.outcomes[0].message,/must-visit/);
assert.match(budgeted.outcomes[1].message,/Skipped/);
assert.equal(budgeted.outcomes[2].state.observation.issues[0].type,'over_budget');
assert.equal(budgeted.outcomes[3].state.observation.issues[0].type,'unknown_price');
assert.equal(budgeted.result.result.plan.estimate.budgetCnyMinor,18900);
assert.equal(budgeted.result.result.plan.estimate.totalMinor,18000);
assert.deepEqual(budgeted.result.result.plan.stops.map(s=>s.id),[museum.placeId,meal.placeId]);
const savedBudget=budgetHarness.history.get(budgeted.result.result.historyId);
assert.deepEqual(savedBudget.plan.stops.map(s=>s.id),[museum.placeId,meal.placeId]);
assert.equal(budgeted.result.result.plan.roadRoutes[1].status,'empty','an unfilled day is preserved as free time');

const impossibleInput=validateDiscovery({...input,budgetAmount:5,budgetCurrency:'USD',budgetScope:'person'},now);
assert.equal(impossibleInput.budgetCnyMinor,7000,'per-person budget scales by the party size');
const impossibleHarness=harness([call('propose_schedule',withStops(museum)),call('report_limit',{reason:'The required museum exceeds the group budget.'})],{searchResult:modifiedSearch,facts});
const impossible=await run({...budgetTask,payload:{...budgetTask.payload,selection:{...selection,input:impossibleInput}}},impossibleHarness);
assert.equal(impossible.result.status,'needs_input');
assert.match(impossible.result.error.message,/exceed the group budget/);
if(impossible.result.error.details){assert.equal(impossible.result.error.details.reason,'over_budget');assert.ok(impossible.result.error.details.subtotalCnyMinor>impossible.result.error.details.budgetCnyMinor);}
assert.equal(impossibleHarness.history.size,0,'never save a plan above the budget');

// Discovery: when the model keeps returning malformed calls near its limit,
// cards are chosen from the verified search results instead of failing.
const stalled=JSON.parse(JSON.stringify(found.task.state));delete stalled.result;stalled.decisions=stalled.limit-1;
const sh=harness([]);const stalledResult=await plannerStep({...searchTask,state:stalled},sh.context);
assert.equal(stalledResult.status,'completed');assert.equal(sh.modelCount,0);assert.ok(stalledResult.result.places.length>=8);assert.equal(new Set(stalledResult.result.places.map(p=>p.category)).size,4);

console.log('PASS traveler planner: actual auto tool calls, omitted-interest guard, supplemental matcha search, 12 verified cards, resumable checkpoints, official-hours conflict, actual-route repair/cache, every-day coverage, budget checks and optional stops, partial recommendations, stable save, owner protection, tool allow-list and bounded incomplete results, built-in scheduler recovery (route conflicts, decision cap, provider outage, infeasible day) and discovery fallback.');
