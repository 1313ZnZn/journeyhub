import assert from 'node:assert/strict';
import {plannerStep,explicitInterests} from './supabase/functions/journeyhub-agent/traveler-planner.mjs';
import {signSelection} from './supabase/functions/journeyhub-agent/discovery.mjs';

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
  if(u.pathname.endsWith('/text')){const query=u.searchParams.get('keywords');return Response.json({status:'1',pois:emptyMatcha&&query==='抹茶'?[]:Array.from({length:4},(_,i)=>poi(cat[query],i))});}
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
const ph=harness([call('propose_schedule',closedHours),call('finish_plan',{}),call('propose_schedule',schedule()),call('check_routes',{}),call('finish_plan',{}),call('propose_schedule',schedule('09:00','10:00','15:00','16:00')),call('check_routes',{}),call('finish_plan',{})],{searchResult:found.result.result,facts});
const planned=await run({id:'33333333-3333-4333-8333-333333333333',userId:owner,kind:'discover_plan',payload:{token,selection,wanted:selected,skipped:[]},state:null},ph);
assert.equal(planned.result.status,'completed');assert.equal(planned.result.result.plan.stops.length,4);assert.equal(new Set(planned.result.result.plan.stops.map(p=>p.dayIndex)).size,2);
assert.equal(ph.requests[1].validation.issues[0].type,'opening_hours');
assert.equal(ph.requests[4].validation.routeConflicts[0].placeId,'amap_BT0');
assert.equal(ph.routeCalls,2,'unchanged order reuses the first checked routes after time repair');
assert.equal(planned.result.result.plan.stops.find(p=>p.id==='amap_BT0').start,'15:00');
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
const capped=await plannerStep(resumed,{...ph.context,now:new Date('2026-11-06T10:00:00Z')});assert.equal(capped.status,'needs_input');
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
console.log('PASS traveler planner: actual auto tool calls, omitted-interest guard, supplemental matcha search, 12 verified cards, resumable checkpoints, official-hours conflict, actual-route repair/cache, every-day coverage, stable save, owner protection, tool allow-list and bounded incomplete results.');
