// Local HTTP integration: real Edge modules -> FastAPI -> LangChain -> LangGraph
// -> real domain tool execution. Model, map providers and database are fixtures.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {runCareChat} from './supabase/functions/journeyhub-agent/care-chat.mjs';
import {plannerStep} from './supabase/functions/journeyhub-agent/traveler-planner.mjs';
import {validateDiscovery} from './supabase/functions/journeyhub-agent/discovery.mjs';

const cwd=fileURLToPath(new URL('../../services/agent-api/',import.meta.url));
const child=spawn('uv',['run','--frozen','python','-m','tests.contract_server'],{cwd,stdio:['ignore','pipe','pipe']});
let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
const closed=once(child,'close');
try{
 const port=await new Promise((resolve,reject)=>{
  let text='';const timeout=setTimeout(()=>reject(Error('Python fixture startup timed out: '+stderr)),20000);
  child.on('error',error=>{clearTimeout(timeout);reject(error);});
  child.on('close',code=>{clearTimeout(timeout);reject(Error('Python fixture exited '+code+': '+stderr));});
  child.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/SERVER_PORT=(\d+)/);if(match){clearTimeout(timeout);resolve(Number(match[1]));}});
 });
 const origin='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<100;i++){try{ready=(await fetch(origin+'/healthz')).ok;if(ready)break;}catch{}await delay(100);}
 assert(ready,'FastAPI readiness');
 const env=k=>({JOURNEYHUB_AGENT_RUNTIME:'python-langchain',JOURNEYHUB_AGENT_SERVICE_URL:origin,JOURNEYHUB_AGENT_SERVICE_TOKEN:'fixture-service-token-01234567890123456789',JOURNEYHUB_AGENT_ALLOW_LOCAL:'true',AMAP_WEB_SERVICE_KEY:'fixture-map-key'}[k]);
 const now=new Date('2026-11-05T10:00:00Z'),requestId='22222222-2222-4222-8222-222222222222';
 const observed=[];
 const remoteFetch=async(url,options)=>{
  assert.equal(url,origin+'/v1/decide','only the local Python service receives decision requests');
  observed.push(JSON.parse(options.body));return fetch(url,options);
 };
 for(const [owner,id,name] of [['owner-a','11111111-1111-4111-8111-111111111111','Alpha Museum'],['owner-b','33333333-3333-4333-8333-333333333333','Beta Museum']]){
  const care={id,sourceId:id,sourceType:'history',status:'active',revision:1,
   input:{city:'Shanghai',date:'2026-11-12',days:1,dayStart:'09:00',dayEnd:'20:00',transport:'drive',guests:1},
   plan:{summary:'Fixture',stops:[{id:'amap_BM0',dayIndex:1,start:'10:00',end:'11:00'}]},
   places:[{id:'amap_BM0',name,kind:'museum',lat:31.23,lng:121.47}],checks:[],canonicalBookings:[]};
  const initialPlan=structuredClone(care.plan);let saved;
  const rpc=async(action,args)=>{
   assert.equal(args.p_user_id,owner);
   if(action==='journeyhub_care_chat_claim')return{lease:'fixture-lease',care,conversation:{messages:[]},alternatives:care.places,request:{message:'repair-fixture: read my saved visit',dayIndex:1}};
   if(action==='journeyhub_care_chat_complete'){saved=args;return{conversation:{pending:null}};}
   throw Error('Unexpected database action '+action);
  };
  const result=await runCareChat({id,userId:owner,requestId},{env,fetcher:remoteFetch,rpc,now});
  assert.equal(result.status,'completed');assert.match(saved.p_response,new RegExp(name));
  assert.equal(saved.p_proposal,null);assert.deepEqual(care.plan,initialPlan);
  assert(result.tools.includes('read_trip_information'),'Python-selected tool really executed');
  assert.equal(result.usage.inputTokens,400,'two decisions each repair once; all usage counted');
 }
 assert(observed.slice(2).every(r=>!JSON.stringify(r).includes('Alpha Museum')),'account snapshots remain isolated');

 const owner='44444444-4444-4444-8444-444444444444',root='55555555-5555-4555-8555-555555555555',secret='fixture-signing-key';
 const input=validateDiscovery({city:'Shanghai',date:'2026-11-12',days:1,dayStart:'09:00',dayEnd:'20:00',guests:1,transport:'drive',prompt:'Museums'},now);
 const history=new Map();let mapCalls=0;
 const fetcher=async(url,options)=>{
  if(url===origin+'/v1/decide')return remoteFetch(url,options);
  assert(new URL(url).pathname.endsWith('/text'),'only fixture map searches allowed');mapCalls++;
  return Response.json({status:'1',pois:Array.from({length:6},(_,i)=>({id:'BM'+i,name:'Museum '+i,location:(121.47+i*.001)+',31.23',typecode:'140100',type:'博物馆',address:'Fixture Road',cityname:'上海',photos:[{url:'https://aos-cdn-image.amap.com/fixture-'+i+'.jpg'}]}))});
 };
 let discovery;
 const rpc=async(action,args)=>{
  if(args.p_user_id)assert.equal(args.p_user_id,owner);
  if(action==='journeyhub_plan_dates_check')return{available:true};
  if(action==='journeyhub_planner_search_result')return discovery;
  if(action==='journeyhub_planner_visit_facts')return[{id:'amap_BM0',date:'2026-11-12',state:'verified',fields:{hours:{text:'09:00–17:00',url:'https://museum.example.invalid/visit',basis:'regular'}}}];
  if(action==='journeyhub_planner_save_facts')return{saved:args.p_facts.length};
  if(action==='journeyhub_trip_history_get')return history.get(args.p_id)||null;
  if(action==='journeyhub_trip_snapshot_get')return null;
  if(action==='journeyhub_trip_snapshot_put')return{ok:true};
  if(action==='journeyhub_trip_history_choices')return{id:args.p_id};
  if(action==='journeyhub_trip_history_save'){const row={id:args.p_id,input:args.p_input,placeIds:args.p_place_ids,plan:args.p_plan};history.set(row.id,row);return row;}
  throw Error('Unexpected database action '+action);
 };
 let task={id:root,userId:owner,kind:'discover',payload:{...input,requestId:root},state:null};
 let step=await plannerStep(task,{env,fetcher,rpc,now,secret});
 assert.equal(step.stage,'search_places');assert.equal(mapCalls,1);assert.equal(step.state.records.length,6);
 task={...task,state:JSON.parse(JSON.stringify(step.state))}; // Simulate restart from persisted state.
 step=await plannerStep(task,{env,fetcher,rpc,now,secret});
 assert.equal(step.status,'completed');assert.equal(mapCalls,1,'resume does not repeat search');
 assert.equal(step.result.places.length,6);assert.equal(history.size,1);
 discovery=step.result;
 const selection={owner,input,ids:discovery.places.map(p=>p.id),historyId:root,expires:now.getTime()+3600000};
 let planning={id:'66666666-6666-4666-8666-666666666666',userId:owner,kind:'discover_plan',payload:{selection,wanted:['amap_BM0'],skipped:selection.ids.filter(id=>id!=='amap_BM0')},state:null};
 const stages=[];
 for(let i=0;i<4;i++){
  step=await plannerStep(planning,{env,fetcher,rpc,now,secret});stages.push(step.stage);
  planning={...planning,state:JSON.parse(JSON.stringify(step.state))};
  if(step.status==='completed')break;
 }
 assert.equal(step.status,'completed');assert.deepEqual(stages,['propose_schedule','check_routes','complete']);
 assert.equal(step.result.plan.stops[0].id,'amap_BM0');assert.equal(step.state.auto,undefined,'model tools complete planning without scheduler fallback');
 console.log('PASS local cross-language integration: LangChain provider serialization, LangGraph repair, real saved-trip tool execution, owner isolation, discovery search/select, schedule/route/save and checkpoint resume. Providers and database were mocked; no cloud data changed.');
}finally{
 child.kill('SIGTERM');await closed;
}
