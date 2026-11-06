import assert from 'node:assert/strict';
import {plannerTaskAction,runPlannerTask,plannerRPCError} from './supabase/functions/journeyhub-agent/planner-tasks.mjs';
import {signSelection} from './supabase/functions/journeyhub-agent/discovery.mjs';
import {WorkflowError} from './supabase/functions/journeyhub-agent/planner.mjs';
import {createPlannerWorker} from './supabase/functions/journeyhub-planner/worker.mjs';

const now=new Date('2026-11-05T12:00:00Z'),owner='f6000000-0000-4000-8000-000000000001',taskId='f6000000-1000-4000-8000-000000000001',secret='fixture-signing-key-for-planning';
const env=name=>({DEEPSEEK_API_KEY:'fixture-not-a-real-key',AMAP_WEB_SERVICE_KEY:'fixture-map-key',JOURNEYHUB_DISCOVERY_SIGNING_KEY:secret}[name]);
const input={city:'Shanghai',date:'2026-11-20',days:2,guests:2,dayStart:'09:00',dayEnd:'21:00',transport:'drive',prompt:'Shanghai local food, Italian, matcha and museums'};
let calls=[];const rpc=async(name,args)=>{calls.push({name,args});if(name==='journeyhub_planner_start')return {id:taskId,status:'running',kind:args.p_kind,input:args.p_input,state:{hidden:true},payload:args.p_payload,leaseToken:'secret'};if(name==='journeyhub_planner_status')return null;throw Error('unexpected RPC '+name);};
const result=await plannerTaskAction({value:{action:'planner_start',kind:'discover',requestId:taskId,payload:input},user:{id:owner},env,rpc,now,secret});
assert.deepEqual(result.kickoff,{id:taskId,userId:owner});assert.equal(result.body.task.input.prompt,input.prompt);assert.equal('state'in result.body.task,false);assert.equal('payload'in result.body.task,false);assert.equal('leaseToken'in result.body.task,false);assert.equal(calls[0].args.p_user_id,owner);assert.equal(calls[0].args.p_payload.action,'discover');
calls=[];await assert.rejects(()=>plannerTaskAction({value:{action:'planner_start',kind:'discover',requestId:taskId,payload:{...input,days:5}},user:{id:owner},env,rpc,now,secret}),e=>e.code==='INVALID_INPUT');assert.equal(calls.length,0);
const selection={owner,input,ids:['amap_first','amap_second'],expires:now.getTime()+60000,historyId:taskId};const token=await signSelection(selection,secret);
await plannerTaskAction({value:{action:'planner_start',kind:'discover_plan',requestId:taskId,payload:{token,wanted:selection.ids,selection:{owner:'attacker'}}},user:{id:owner},env,rpc,now,secret});
assert.equal(calls[0].args.p_payload.selection.owner,owner);assert.deepEqual(calls[0].args.p_payload.selection.ids,selection.ids);
calls=[];await assert.rejects(()=>plannerTaskAction({value:{action:'planner_start',kind:'discover_plan',requestId:taskId,payload:{token,wanted:['amap_third']}},user:{id:owner},env,rpc,now,secret}),e=>e.code==='INVALID_INPUT');assert.equal(calls.length,0);
await assert.rejects(()=>plannerTaskAction({value:{action:'planner_status',id:taskId},user:{id:owner},env,rpc,now,secret}),e=>e.code==='PLANNER_NOT_FOUND');assert.equal(calls[0].args.p_user_id,owner);
assert.equal(plannerRPCError({message:'PLANNER_ALREADY_RUNNING'}).status,409);

let current={id:taskId,userId:owner,kind:'discover',payload:{...input},state:{done:['saved_search']},stepCount:1,leaseToken:'fixture-lease'},leased=false,publicStatus='running',checkpoints=[],released=0;
const runnerRPC=async(name,args)=>{
 if(name==='journeyhub_planner_claim'){if(leased||publicStatus!=='running')return null;leased=true;return structuredClone(current);}
 if(name==='journeyhub_planner_checkpoint'){assert.equal(args.p_user_id,owner);assert.equal(args.p_lease,current.leaseToken);checkpoints.push(args);current.state=args.p_state;current.stepCount++;publicStatus=args.p_status;return {stepCount:current.stepCount,status:args.p_status};}
 if(name==='journeyhub_planner_release'){released++;leased=false;return true;}throw Error(name);
};
let executed=0;
const failed=await runPlannerTask({id:taskId,userId:owner},{env,rpc:runnerRPC,now,step:async task=>{assert.deepEqual(task.state.done,['saved_search']);executed++;throw Error('provider raw API key must never leak');}});
assert.equal(failed.status,'failed');assert.equal(executed,1);assert.deepEqual(current.state,{done:['saved_search']});assert.equal(checkpoints[0].p_error.code,'PLANNER_UNAVAILABLE');assert.doesNotMatch(checkpoints[0].p_message,/API key|provider raw/);assert.equal(released,1);
publicStatus='running';checkpoints=[];
const resumed=await runPlannerTask({id:taskId,userId:owner},{env,rpc:runnerRPC,now,step:async(task,context)=>{assert.deepEqual(task.state.done,['saved_search']);assert.equal(context.user.id,owner);assert.ok(context.deadlineAt>Date.now());return {state:{done:['saved_search','curation']},status:'completed',stage:'ready',message:'Your places are ready.',events:[{kind:'tool',tool:'curate_places',summary:'Saved 12 places.'}],result:{places:[],historyId:taskId}};}});
assert.equal(resumed.status,'completed');assert.equal(checkpoints.length,1);assert.deepEqual(current.state.done,['saved_search','curation']);assert.equal((await runPlannerTask({id:taskId,userId:owner},{env,rpc:runnerRPC,step:()=>{throw Error('never');}})).claimed,false);
let staleWrites=0;const stale=await runPlannerTask({id:taskId,userId:owner},{env,now,rpc:async name=>name==='journeyhub_planner_claim'?{...current,state:{}}:name==='journeyhub_planner_checkpoint'?(staleWrites++,null):true,step:async()=>({state:{},status:'running',stage:'checking',message:'Checking',events:[]})});assert.equal(stale.stale,true);assert.equal(staleWrites,1);

const workerSecret='fixture-worker-secret-01234567890123456789';let dueCalls=0,runs=0;
const worker=createPlannerWorker({env:()=>undefined,now:()=>now,rpc:async name=>{if(name==='journeyhub_agent_worker_config')return {worker_secret:workerSecret};if(name==='journeyhub_planner_due'){dueCalls++;return [{id:taskId,userId:owner}];}throw Error(name);},run:async(k,c)=>{runs++;assert.equal(k.userId,owner);assert.equal(c.now(),now);return {processed:2};}});
assert.equal((await worker(new Request('https://fixture',{method:'POST'}))).status,401);
assert.equal((await worker(new Request('https://fixture',{method:'POST',headers:{Authorization:'Bearer '+workerSecret+'wrong'}}))).status,401);assert.equal(dueCalls,0);
const workerResult=await worker(new Request('https://fixture',{method:'POST',headers:{Authorization:'Bearer '+workerSecret}}));assert.deepEqual(await workerResult.json(),{processed:2,failed:0});assert.equal(runs,1);
console.log('PASS traveler planner task API/runner: validated input, signed selection, owner scope, private state, persisted tool checkpoints, failure-safe retry, stale fencing, duplicate worker prevention and authenticated scheduling.');
