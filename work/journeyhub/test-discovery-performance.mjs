import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {discoveryAction,readSelection,signSelection} from './supabase/functions/journeyhub-agent/discovery.mjs';
globalThis.crypto??=webcrypto;
const owner='a0000000-0000-4000-8000-000000000001',secret='fixture-signing-only',now=new Date('2026-11-04T03:00:00Z');
const env=n=>({DEEPSEEK_API_KEY:'fixture',AMAP_WEB_SERVICE_KEY:'fixture'}[n]);
const pois=Array.from({length:8},(_,i)=>({id:'B100'+i,name:'博物馆'+i,location:(121.48+i*.001)+',31.23',address:'Verified address '+i,type:'博物馆',typecode:'140100',photos:[{url:'https://store.is.autonavi.com/fixture'+i+'.jpg'}]}));
let calls=[],writes=[];
const rpc=async(name,args)=>{if(name==='journeyhub_plan_dates_check')return {available:true};if(name==='journeyhub_trip_history_save'){writes.push(args);return {id:args.p_id};}return null;};
function transport(){return async(url,options={})=>{
 const u=new URL(url);calls.push(u.pathname);
 if(u.hostname==='api.deepseek.com'){
  const body=JSON.parse(options.body),system=body.messages[0].content,data=JSON.parse(body.messages[1].content);let answer;
  if(system.includes('requirements analyst'))answer={queries:[{category:'Museums',query:'博物馆'}]};
  else if(system.includes('travel curator'))answer={places:pois.map((p,i)=>({id:'amap_'+p.id,category:'Museums',name:'Museum '+i,reason:'Requested culture'}))};
  else if(system.includes('Translate or transliterate'))answer={places:data.places.map(p=>({id:p.id,name:'Museum '+pois.findIndex(raw=>'amap_'+raw.id===p.id)}))};
  else{assert(system.includes('self-guided itinerary'));answer={summary:'A full museum day',stops:data.places.map((p,i)=>({placeId:p.id,day:1,start:i?'12:00':'09:00',end:i?'13:00':'10:00',reason:'Culture'}))};}
  return Response.json({choices:[{message:{content:JSON.stringify(answer)}}]});
 }
 if(u.pathname==='/v5/place/text')return Response.json({status:'1',pois});
 if(u.pathname==='/v5/place/detail')return Response.json({status:'1',pois:pois.filter(p=>p.id===u.searchParams.get('id'))});
 if(u.pathname==='/v3/direction/driving')return Response.json({status:'1',route:{paths:[{distance:'1500',duration:'600',steps:[{polyline:'121.48,31.23;121.481,31.23'}]}]}});
 throw Error('Unexpected provider request');
};}
const context={user:{id:owner},env,rpc,secret,now};
const discovery=await discoveryAction({...context,fetcher:transport(),value:{action:'discover',requestId:'a0000000-0000-4000-8000-000000000002',city:'Shanghai',date:'2026-11-06',days:1,guests:2,prompt:'Museums',transport:'drive',dayStart:'09:00',dayEnd:'18:00'}});
assert.equal(discovery.places.length,8);assert.equal(discovery.targetCardCount,8);assert.deepEqual(discovery.missingCategories,[]);
const selection=await readSelection(discovery.token,secret,owner,now);assert.equal(Object.keys(selection.englishNames).length,8);assert(!JSON.stringify(selection).includes('Verified address'));assert(!JSON.stringify(selection).includes('autonavi'));
assert(writes.length);assert(!JSON.stringify(writes).includes('Museum 0'),'curated labels stay out of durable search history');
const wanted=discovery.places.slice(0,2).map(p=>p.id),value={action:'discover_plan',token:discovery.token,wanted,skipped:[]};
calls=[];const plan=await discoveryAction({...context,fetcher:transport(),value});
assert.equal(calls.filter(p=>p==='/chat/completions').length,1,'signed English labels remove the extra localization call');
assert.equal(calls.filter(p=>p==='/v5/place/detail').length,2,'every selected place is still checked');
assert.equal(calls.filter(p=>p==='/v3/direction/driving').length,1,'full route still fetched');
assert.deepEqual(plan.plan.stops.map(p=>p.id),wanted);assert.deepEqual(plan.plan.stops.map(p=>p.name),['Museum 0','Museum 1']);assert(plan.plan.stops.every(p=>p.photo&&p.address));assert.equal(plan.plan.roadRoutes[0].status,'ready');
// Existing searches without the new optional claim retain the full localization fallback.
const old={...selection};delete old.englishNames;calls=[];
const legacy=await discoveryAction({...context,fetcher:transport(),value:{...value,token:await signSelection(old,secret)}});
assert.equal(calls.filter(p=>p==='/chat/completions').length,2);assert.deepEqual(legacy.plan.stops.map(p=>p.name),plan.plan.stops.map(p=>p.name));
const before=calls.length;
for(const token of [discovery.token+'x',await signSelection({...selection,englishNames:{amap_B999:'Other venue'}},secret),await signSelection({...selection,englishNames:{[wanted[0]]:'中文名称'}},secret)])await assert.rejects(()=>discoveryAction({...context,fetcher:transport(),value:{...value,token}}),e=>e.code==='SEARCH_EXPIRED');
await assert.rejects(()=>discoveryAction({...context,user:{id:'another-user'},fetcher:transport(),value}),e=>e.code==='SEARCH_EXPIRED');
assert.equal(calls.length,before,'tampering and wrong owners never call a provider');
console.log('PASS: 8 complete cards; signed Amap names reduce planning AI calls 2→1; all selected details/photos/routes retained; old-token fallback and tamper/owner validation. No live calls.');
