import assert from 'node:assert/strict';
import {plannerStep} from './supabase/functions/journeyhub-agent/traveler-planner.mjs';
import {runPlannerTask} from './supabase/functions/journeyhub-agent/planner-tasks.mjs';

const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const input={city:'Shanghai',date:'2026-11-20',days:1,guests:2,dayStart:'09:00',dayEnd:'21:00',transport:'drive',prompt:'Museums'};
const now=new Date('2026-11-12T10:00:00Z'),env=n=>({DEEPSEEK_API_KEY:'fixture',AMAP_WEB_SERVICE_KEY:'fixture',GOOGLE_PLACES_API_KEY:'fixture'}[n]);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const tick=()=>new Promise(r=>setTimeout(r,5));
const model=(name,args)=>Response.json({choices:[{message:{tool_calls:[{type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});

// The three independent reads must start before any one resolves. No provider
// call may begin while the date guard or either metadata read is outstanding.
for(const allowed of [true,false]){
 const waits=new Map(),reads=[],providers=[];
 const task={id,userId:owner,kind:'discover_plan',payload:{selection:{owner,input,ids:['amap_B1'],historyId:id},wanted:['amap_B1']}};
 const run=plannerStep(task,{env,now,secret:'fixture',rpc:async(name,args)=>{
  assert.equal(args.p_user_id,owner);reads.push(name);const d=deferred();waits.set(name,d);return d.promise;
 },fetcher:async()=>{providers.push('model');return model('inspect_places',{ids:[]});}});
 const checked=allowed?run:assert.rejects(run,e=>e.code==='WORKFLOW_UNAVAILABLE');
 for(let n=0;n<30&&waits.size<3;n++)await tick();
 assert.equal(waits.size,3,'start all reads together');assert.equal(providers.length,0);
 waits.get('journeyhub_planner_search_result').resolve({places:[{id:'amap_B1',name:'Museum',kind:'museum',lat:31.2,lng:121.4}]});
 waits.get('journeyhub_planner_visit_facts').resolve([]);await tick();assert.equal(providers.length,0);
 waits.get('journeyhub_plan_dates_check').resolve({available:allowed});await checked;
 assert.equal(providers.length,allowed?1:0,'date rejection never starts model work');
}

// Seven Google photos take three bounded batches, not seven serial waits.
// Provider failure leaves the verified card present without a fabricated photo.
const places=Array.from({length:7},(_,i)=>({id:'p'+i,name:'Museum '+i,kind:'museum',categories:['Museums'],lat:31.2,lng:121.4,photoReference:{id:'p'+i,photos:[{name:'places/p'+i+'/photos/a'}]}}));
const state={version:1,owner,kind:'discover',input,root:id,queries:[{category:'Museums',query:'museum'}],searched:[{category:'Museums',query:'museum'}],records:places,target:8,hints:[],decisions:1,limit:12,inspectionCount:0,usage:{},useAmap:false};
const photos=[],pending=[];let active=0,peak=0;
const cards=plannerStep({id,userId:owner,kind:'discover',state},{env,now,secret:'fixture',rpc:async(name,args)=>name==='journeyhub_trip_history_save'?{id:args.p_id,placeIds:args.p_place_ids,updatedAt:now.toISOString()}:{ok:true},fetcher:async(url)=>{
 if(url.includes('/chat/completions'))return model('select_cards',{places:places.map(p=>({id:p.id,name:p.name,category:'Museums',reason:'Museum visit'}))});
 assert(url.includes('/photos/'));active++;peak=Math.max(peak,active);photos.push(url);const d=deferred();pending.push(d);await d.promise;active--;
 return Response.json({photoUri:photos.indexOf(url)===2?'https://untrusted.invalid/photo':'https://lh3.googleusercontent.com/photo'});
}});
for(const [start,count] of [[0,3],[3,3],[6,1]]){
 for(let n=0;n<30&&pending.length<start+count;n++)await tick();
 assert.equal(pending.length,start+count);assert.equal(active,count);
 pending.slice(start,start+count).forEach(d=>d.resolve());
}
const result=await cards;assert.equal(result.status,'completed');assert.equal(peak,3);assert.equal(result.result.places.length,7);
assert.deepEqual(result.result.places.map(p=>p.id),places.map(p=>p.id));assert.equal(result.result.places[2].photo,null);
assert(result.result.places.every(p=>!p.photoReference));

// Eight quick steps can complete in one lease. Slow steps still yield with the
// existing headroom; each step checkpoints and stale leases stop immediately.
async function worker({steps=7,cost=1000,stale=false}={}){
 let clock=0,checks=0,releases=0;
 const result=await runPlannerTask({id,userId:owner},{env,clock:()=>clock,now,rpc:async(name,args)=>{
  if(name==='journeyhub_planner_claim')return{id,userId:owner,state:{},leaseToken:'lease'};
  if(name==='journeyhub_planner_release'){releases++;return true;}
  assert.equal(name,'journeyhub_planner_checkpoint');assert.equal(args.p_lease,'lease');checks++;return stale?null:{stepCount:checks};
 },step:async()=>{clock+=cost;return{state:{},status:checks+1>=steps?'completed':'running',result:checks+1>=steps?{ok:true}:null};}});
 assert.equal(releases,1);return{result,checks};
}
assert.equal((await worker()).result.status,'completed');
assert.equal((await worker({steps:99})).checks,8);
assert.equal((await worker({steps:99,cost:21000})).checks,2);
assert.equal((await worker({stale:true})).checks,1);
console.log('PASS: parallel owner-scoped reads; date guard blocks provider calls; 7 photos in 3 bounded batches with fallback; 7 quick steps finish on one lease; 85s deadline/headroom, checkpoint and stale-lease protections retained. No live calls.');
