import assert from 'node:assert/strict';
import {createAgentHandler} from './supabase/functions/journeyhub-agent/handler.mjs';

const owner='f7000000-0000-4000-8000-000000000001',taskId='f7000000-1000-4000-8000-000000000001',now=new Date('2026-11-05T12:00:00Z');
const envGet=name=>({DEEPSEEK_API_KEY:'fixture-ai-key',AMAP_WEB_SERVICE_KEY:'fixture-map-key',SUPABASE_URL:'https://database.example.invalid',SUPABASE_ANON_KEY:'fixture-public-key',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',JOURNEYHUB_DISCOVERY_SIGNING_KEY:'fixture-signing-key'}[name]);
const payload={city:'Shanghai',date:'2026-11-20',days:2,guests:2,dayStart:'09:00',dayEnd:'21:00',transport:'drive',prompt:'Local food, Italian, matcha and museums'};
const req=(value,headers={})=>new Request('https://journeyhub.example.invalid/functions/v1/journeyhub-agent',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
const start={action:'planner_start',kind:'discover',requestId:taskId,payload};
const task=(status='running')=>({id:taskId,kind:'discover',status,stage:'search_places',message:'Checking your interests.',input:payload,events:[{kind:'tool',tool:'search_places',summary:'Found places for the requested interests.'}],result:status==='completed'?{places:[],historyId:taskId}:null,state:{secretModelState:true},payload:{token:'private-token'},leaseToken:'private-lease',messages:[{role:'system',content:'private-model-prompt'}]});
const authenticate=async()=>({id:owner,email_confirmed_at:'2026-11-01T00:00:00Z'});
const logMetric=()=>{};

// The public task endpoints still pass the shared authentication gate first.
let authFetches=0,authRPCs=0;
const unauthenticated=createAgentHandler({envGet,now:()=>now,logMetric,rpc:async()=>{authRPCs++;throw Error('must not access tasks before auth');},fetchImpl:async()=>{authFetches++;return Response.json({id:owner,email_confirmed_at:null});}});
for(const value of [start,{action:'planner_status',id:taskId},{action:'planner_retry',id:taskId}]){
 const r=await unauthenticated(req(value));assert.equal(r.status,401);assert.equal((await r.json()).error.code,'SIGN_IN_REQUIRED');
}
assert.equal(authFetches,0);assert.equal(authRPCs,0);
const unconfirmed=await unauthenticated(req(start,{Authorization:'Bearer fixture-access-token'}));assert.equal(unconfirmed.status,403);assert.equal((await unconfirmed.json()).error.code,'VERIFIED_ACCOUNT_REQUIRED');assert.equal(authRPCs,0);

// A pending worker claim is intentionally left unresolved. The HTTP response
// must finish while that claim is pending: no AI work blocks the 202 response.
for(const value of [start,{action:'planner_status',id:taskId},{action:'planner_retry',id:taskId}]){
 let releaseClaim;const claimGate=new Promise(resolve=>{releaseClaim=resolve;});const background=[],calls=[];
 const handler=createAgentHandler({envGet,authenticate,now:()=>now,logMetric,waitUntil:promise=>background.push(promise),rpc:async(name,args)=>{
  calls.push({name,args});if(name==='journeyhub_planner_claim')return claimGate;
  if(['journeyhub_planner_start','journeyhub_planner_status','journeyhub_planner_retry'].includes(name))return task();
  throw Error('unexpected task RPC '+name);
 }});
 let timeout;const response=await Promise.race([handler(req(value)),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('HTTP response awaited background execution')),1000);})]);clearTimeout(timeout);
 assert.equal(response.status,202);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(background.length,1);
 const body=await response.json();assert.equal(body.task.id,taskId);assert.equal(body.task.status,'running');
 const serialized=JSON.stringify(body);assert.doesNotMatch(serialized,/secretModelState|private-token|private-lease|private-model-prompt/);
 for(const hidden of ['state','payload','leaseToken','messages'])assert.equal(hidden in body.task,false);
 assert.equal(calls[0].args.p_user_id,owner);assert.equal(calls.find(x=>x.name==='journeyhub_planner_claim').args.p_user_id,owner);
 releaseClaim(null);await Promise.all(background);
}

// Completed, paused and needs-input results never schedule another execution.
for(const status of ['completed','failed','needs_input']){
 let kickoffs=0,claims=0;
 const handler=createAgentHandler({envGet,authenticate,now:()=>now,logMetric,waitUntil:()=>{kickoffs++;},rpc:async(name,args)=>{
  assert.equal(args.p_user_id,owner);if(name==='journeyhub_planner_claim'){claims++;return null;}assert.equal(name,'journeyhub_planner_status');assert.equal(args.p_id,null);return task(status);
 }});
 const r=await handler(req({action:'planner_status'}));assert.equal(r.status,200);assert.equal((await r.json()).task.status,status);assert.equal(kickoffs,0);assert.equal(claims,0);
}
let missingKickoffs=0;
const missing=createAgentHandler({envGet,authenticate,now:()=>now,logMetric,waitUntil:()=>{missingKickoffs++;},rpc:async()=>null});
let r=await missing(req({action:'planner_status'}));assert.deepEqual(await r.json(),{task:null});assert.equal(r.status,200);
r=await missing(req({action:'planner_status',id:taskId}));assert.equal(r.status,404);assert.equal((await r.json()).error.code,'PLANNER_NOT_FOUND');assert.equal(missingKickoffs,0);

// Exercise the real REST RPC adapter so its error mapper, not just the injected
// task module, is responsible for returning safe actionable status codes.
for(const [value,code,status]of[[start,'PLANNER_ALREADY_RUNNING',409],[start,'PLANNER_REQUEST_CONFLICT',409],[{action:'planner_retry',id:taskId},'PLANNER_RETRY_LIMIT',409],[start,'PLANNER_INVALID',400],[start,'PLAN_DATE_CONFLICT:2026-11-20',409]]){
 let kickoffs=0;const seen=[];
 const handler=createAgentHandler({envGet,authenticate,now:()=>now,logMetric,waitUntil:()=>{kickoffs++;},fetchImpl:async(url,options)=>{
  seen.push(String(url));assert.ok(String(url).startsWith('https://database.example.invalid/rest/v1/rpc/journeyhub_planner_'));assert.equal(JSON.parse(options.body).p_user_id,owner);
  return Response.json({message:code+' private-database-diagnostic',details:'private SQL state',hint:'private service hint'},{status:400});
 }});
 const response=await handler(req(value)),body=await response.json();assert.equal(response.status,status);assert.equal(body.error.code,code.split(':')[0]);assert.doesNotMatch(JSON.stringify(body),/private-database|private SQL|private service/);assert.equal(kickoffs,0);assert.equal(seen.length,1);
}
console.log('PASS traveler planner handler: auth before task access; immediate 202 with pending background claim; start/status/retry owner scope; terminal status does not restart; task internals hidden; REST error mapping preserves safe actionable failures.');
