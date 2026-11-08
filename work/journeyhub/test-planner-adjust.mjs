import assert from 'node:assert/strict';
import {plannerTaskAction} from './supabase/functions/journeyhub-agent/planner-tasks.mjs';
import {signSelection} from './supabase/functions/journeyhub-agent/discovery.mjs';
import {saveSearchAndPlan,historyInput} from './supabase/functions/journeyhub-agent/history.mjs';

// Changing trip details from the "needs a small change" card must still let the finished
// plan be saved: the database only accepts a plan whose details match its parent search.
const now=new Date('2026-11-08T12:00:00Z'),owner='f7000000-0000-4000-8000-000000000001',root='f7000000-1000-4000-8000-000000000001',secret='fixture-key';
const env=n=>({DEEPSEEK_API_KEY:'fixture',AMAP_WEB_SERVICE_KEY:'fixture',JOURNEYHUB_DISCOVERY_SIGNING_KEY:secret}[n]);
const input={city:'Shanghai',date:'2026-11-20',days:2,guests:2,dayStart:'09:00',dayEnd:'21:00',transport:'drive',prompt:'Gardens',preferredExperienceIds:[],excludedExperienceIds:[]};
const ids=['amap_a','amap_b','amap_c'];
const token=await signSelection({owner,input,ids,historyId:root,expires:now.getTime()+600000},secret);
let started=null;
const rpc=async(name,args)=>{if(name==='journeyhub_planner_start'){started=args;return {id:args.p_request_id,status:'running',kind:args.p_kind,input:args.p_input};}throw Error(name);};
const start=adjust=>plannerTaskAction({value:{action:'planner_start',kind:'discover_plan',requestId:'f7000000-2000-4000-8000-00000000000'+(adjust?1:2),payload:{token,wanted:['amap_a'],...(adjust?{adjust}:{})}},user:{id:owner},env,rpc,now,secret});

// Without changes the plan belongs to the original search.
await start(null);
assert.equal(started.p_payload.selection.historyId,root);assert.equal(started.p_payload.selection.baseHistoryId,undefined);

// With changes it gets its own search record (stable for the same changes) that remembers the original.
await start({date:'2026-11-22',dayStart:'10:00'});
const sel=started.p_payload.selection;
assert.equal(sel.baseHistoryId,root);assert.notEqual(sel.historyId,root);assert.equal(sel.input.date,'2026-11-22');assert.equal(sel.input.dayStart,'10:00');
await start({date:'2026-11-22',dayStart:'10:00'});assert.equal(started.p_payload.selection.historyId,sel.historyId);
await start({date:'2026-11-23'});assert.notEqual(started.p_payload.selection.historyId,sel.historyId);

// Emulate the database rule: a child row must have the same input and places as its parent.
const rows=new Map();
const db=async(name,a)=>{
  if(name==='journeyhub_trip_history_save'){
    if(a.p_parent_id){const parent=rows.get(a.p_parent_id);if(!parent||JSON.stringify(parent.input)!==JSON.stringify(a.p_input)||JSON.stringify(parent.placeIds)!==JSON.stringify(a.p_place_ids))throw Error('History request conflict');}
    const old=rows.get(a.p_id);if(old&&JSON.stringify(old.input)!==JSON.stringify(a.p_input))throw Error('History request conflict');
    const row={id:a.p_id,input:a.p_input,placeIds:a.p_place_ids,parentId:a.p_parent_id};if(!old)rows.set(a.p_id,row);return rows.get(a.p_id);
  }
  if(name==='journeyhub_trip_history_choices')return rows.get(a.p_id);
  throw Error(name);
};
// The original search was saved first with the original details.
await saveSearchAndPlan({rpc:db,userId:owner,search:{owner,input,ids,historyId:root},token:'',wanted:['amap_a']});
const plan={summary:'x',stops:[{id:'amap_a',dayIndex:1,start:'10:00',end:'11:00',reason:'r'}]};
// Before the fix the changed details were saved under the original search: refused.
await assert.rejects(saveSearchAndPlan({rpc:db,userId:owner,search:{owner,input:historyInput(sel.input),ids,historyId:root},token:'',wanted:['amap_a'],plan,allowOptional:true}),/History request conflict/);
// Now they go under the new search record and save.
const id=await saveSearchAndPlan({rpc:db,userId:owner,search:sel,token:'',wanted:['amap_a'],plan,allowOptional:true});
assert.equal(rows.get(id).parentId,sel.historyId);assert.equal(rows.get(id).input.date,'2026-11-22');
console.log('PASS planner adjust: changed trip details save under their own search record; unchanged plans keep the original');
