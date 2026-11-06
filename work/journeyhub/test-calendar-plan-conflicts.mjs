import assert from 'node:assert/strict';
import {createAgentHandler} from './supabase/functions/journeyhub-agent/handler.mjs';
import {signSelection} from './supabase/functions/journeyhub-agent/discovery.mjs';
import {revisionHistoryId,safelySave} from './supabase/functions/journeyhub-agent/history.mjs';
import {WorkflowError} from './supabase/functions/journeyhub-agent/planner.mjs';

// Exercise the real HTTP/RPC error adapter, not only injected WorkflowErrors.
const user={id:'10000000-0000-4000-8000-000000000001'},now=new Date('2026-11-04T00:00:00Z');
const root='10000000-0000-4000-8000-000000000002',secret='fixture-signing-key';
const input={city:'Shanghai',date:'2026-12-01',days:2,guests:1,prompt:'Gardens and museums',dayStart:'09:00',dayEnd:'18:00',transport:'drive',preferredExperienceIds:[],excludedExperienceIds:[]};
const ids=['garden','museum'],wanted=[...ids],skipped=[],revision=await revisionHistoryId(root,wanted,skipped);
const structure={summary:'Two scheduled days',stops:ids.map((id,i)=>({id,dayIndex:i+1,start:'09:00',end:'10:00',reason:'Requested interest'}))};
const token=await signSelection({owner:user.id,input,ids,historyId:root,expires:now.getTime()+3600000},secret);
const env=name=>({SUPABASE_URL:'https://database.fixture.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',SUPABASE_ANON_KEY:'fixture-public-key',JOURNEYHUB_DISCOVERY_SIGNING_KEY:secret,GOOGLE_PLACES_API_KEY:'fixture-places-key',DEEPSEEK_API_KEY:'fixture-ai-key'}[name]);

function fixture(options={}){
 const calls=[],rows=new Map();
 const row=(id,plan=null)=>({id,userId:user.id,input,placeIds:ids,wanted:plan?wanted:[],skipped:[],plan,parentId:plan?root:null});
 rows.set(root,row(root));if(options.cached)rows.set(revision,row(revision,structure));
 const conflict=()=>Response.json({message:'PLAN_DATE_CONFLICT:2026-12-02 private database diagnostics',code:'P0001'},{status:400});
 const fetcher=async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,body});
  if(url.includes('/rest/v1/rpc/')){
   const name=url.split('/').at(-1);
   if(name==='journeyhub_discovery_quota')return Response.json(null);
   if(name==='journeyhub_plan_dates_check'){
    assert.equal(body.p_user_id,user.id);assert.equal(body.p_kind,'history');assert.equal(body.p_id,revision);
    assert.equal(body.p_input.date,input.date);assert.equal(body.p_input.days,2);
    if(options.preflightConflict)return conflict();
    return Response.json({available:!options.invalidCheck});
   }
   if(name==='journeyhub_trip_history_get')return Response.json(rows.get(body.p_id)||null);
   if(name==='journeyhub_trip_history_save'){
    if(body.p_plan&&options.saveConflict)return conflict();
    const saved={id:body.p_id,userId:body.p_user_id,input:body.p_input,placeIds:body.p_place_ids,wanted:body.p_wanted,skipped:body.p_skipped,plan:body.p_plan,parentId:body.p_parent_id};
    rows.set(saved.id,saved);return Response.json(saved);
   }
   if(name==='journeyhub_trip_history_choices')return Response.json(rows.get(body.p_id));
   if(name==='journeyhub_agent_begin'&&options.catalogConflict)return conflict();
   throw Error('Unexpected RPC '+name);
  }
  if(url.includes('places.googleapis.com/v1/places/')){
   const id=new URL(url).pathname.split('/').at(-1);
   return Response.json({id,displayName:{text:id==='garden'?'Verified Garden':'Verified Museum'},formattedAddress:'Provider address',location:{latitude:31.23,longitude:121.48},businessStatus:'OPERATIONAL',primaryType:'park'});
  }
  if(url.includes('deepseek'))return Response.json({choices:[{message:{content:JSON.stringify({summary:structure.summary,stops:structure.stops.map(s=>({placeId:s.id,day:s.dayIndex,start:s.start,end:s.end,reason:s.reason}))})}}]});
  throw Error('Unexpected provider '+url);
 };
 const handler=createAgentHandler({envGet:env,fetchImpl:fetcher,authenticate:async()=>user,now:()=>now});
 const call=async(value={action:'discover_plan',token,wanted,skipped})=>{
  const response=await handler(new Request('https://edge.fixture.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}));
  return {status:response.status,body:await response.json()};
 };
 return {calls,rows,call};
}

const assertConflict=result=>{
 assert.equal(result.status,409);assert.equal(result.body.error.code,'PLAN_DATE_CONFLICT');
 assert.equal(result.body.plan,undefined,'a rejected second itinerary is never presented as generated');
 assert.match(result.body.error.message,/2026-12-02/);assert.match(result.body.error.message,/Open Calendar/);
 assert(!JSON.stringify(result.body).includes('private database diagnostics'));
};
const blocked=fixture({preflightConflict:true});assertConflict(await blocked.call());
assert(blocked.calls.every(c=>c.url.includes('/rest/v1/rpc/')),'conflict rejected before paid place/AI calls');
const malformed=fixture({invalidCheck:true});assert.equal((await malformed.call()).status,503);
assert(malformed.calls.every(c=>c.url.includes('/rest/v1/rpc/')));
const race=fixture({saveConflict:true});assertConflict(await race.call());
assert(race.calls.some(c=>c.url.includes('deepseek')),'concurrent conflict occurs after the original preflight');
assert(!race.rows.has(revision),'no duplicate revision was persisted');
const success=fixture(),created=await success.call();assert.equal(created.status,200);assert.equal(created.body.historyId,revision);
assert.equal(created.body.plan.stops.length,2);
const checks=success.calls.filter(c=>c.url.endsWith('/journeyhub_plan_dates_check')).length;
const aiCalls=success.calls.filter(c=>c.url.includes('deepseek')).length;
assert.equal((await success.call()).status,200,'same-id retry reopens the existing plan');
assert.equal(success.calls.filter(c=>c.url.endsWith('/journeyhub_plan_dates_check')).length,checks,'exact existing revision bypasses conflicting-new-plan preflight');
assert.equal(success.calls.filter(c=>c.url.includes('deepseek')).length,aiCalls);
const imported=fixture({saveConflict:true});assertConflict(await imported.call({action:'history_import',token,wanted,skipped,plan:structure}));
assert(imported.calls.every(c=>c.url.includes('/rest/v1/rpc/')),'import conflict makes no provider calls');
const search=fixture({saveConflict:true});assert.equal((await search.call({action:'history_import',token,wanted,skipped})).status,200,'search-only history does not occupy dates');
const catalog=fixture({catalogConflict:true});assertConflict(await catalog.call({action:'plan',...input,requestId:'10000000-0000-4000-8000-000000000003'}));
assert(catalog.calls.every(c=>c.url.includes('/rest/v1/rpc/')),'catalog conflict rejected at begin before providers');
const conflictError=new WorkflowError('PLAN_DATE_CONFLICT','Conflict',409);
await assert.rejects(()=>safelySave(async()=>{throw conflictError;}),e=>e===conflictError);
assert.equal((await safelySave(async()=>{throw Error('Temporary outage');})).historyId,null,'ordinary persistence failure keeps its existing recoverable behavior');
console.log('PASS: date preflight blocks paid work, concurrent save conflict is not downgraded, same-revision retry is idempotent, search/import/catalog boundaries and sanitized 409 errors. All services mocked.');
