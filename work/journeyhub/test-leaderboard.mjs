import assert from 'node:assert/strict';
import {leaderboard,debateResult} from './supabase/functions/journeyhub-agent/leaderboard.mjs';
import {signSelection} from './supabase/functions/journeyhub-agent/discovery.mjs';

// Boards: city checked, rows cleaned, impossible rows dropped.
let asked=null;
const boards=await leaderboard({value:{city:'Shanghai'},rpc:async(name,args)=>{asked={name,args};return {mustGo:[{placeId:'amap_a',name:'Yu Garden',kind:'tourist_attraction',city:'Shanghai',travelers:3,trips:5},{placeId:'amap_b',name:'',travelers:2},{placeId:'amap_c',name:'Ghost',travelers:0}],
  debates:[{placeId:'amap_a',name:'Yu Garden',wins:3,debates:4,city:'Shanghai'},{placeId:'amap_d',name:'Broken',wins:5,debates:2}]};}});
assert.deepEqual(asked,{name:'journeyhub_leaderboard',args:{p_city:'Shanghai'}});
assert.deepEqual(boards.mustGo.map(r=>r.placeId),['amap_a']);assert.deepEqual(boards.debates.map(r=>r.placeId),['amap_a']);
await leaderboard({value:{city:'all'},rpc:async(n,a)=>{asked=a;return {};}});assert.equal(asked.p_city,null);
await assert.rejects(leaderboard({value:{city:'Paris'},rpc:async()=>({})}),e=>e.code==='INVALID_INPUT');

// Debate results: two places from the traveler's own search, names from the search record.
const user={id:'10000000-0000-4000-8000-000000000001'},now=new Date('2026-11-08T10:00:00Z'),secret='k',root='10000000-0000-4000-8000-000000000002';
const input={city:'Shanghai',date:'2026-12-01',days:2,guests:2,prompt:'x',dayStart:'09:00',dayEnd:'18:00',transport:'drive',preferredExperienceIds:[],excludedExperienceIds:[]};
const ids=['amap_a','amap_b','amap_c'];
const expired=await signSelection({owner:user.id,input,ids,historyId:root,expires:now.getTime()-60000},secret);
let recorded=null;
const rpc=async(name,args)=>{if(name==='journeyhub_planner_search_result')return {places:[{id:'amap_a',name:'Yu Garden',kind:'tourist_attraction'},{id:'amap_b',name:'Shanghai Museum',kind:'museum'}]};if(name==='journeyhub_debate_record'){recorded=args;return {recorded:true};}throw Error(name);};
// An expired card token still records the outcome (it needs no live data).
assert.deepEqual(await debateResult({value:{token:expired,ids:['amap_a','amap_b'],choice:'a'},user,rpc,now,secret}),{recorded:true});
assert.equal(recorded.p_city,'Shanghai');assert.equal(recorded.p_choice,'a');assert.deepEqual(recorded.p_places.map(p=>p.name),['Yu Garden','Shanghai Museum']);
// Unknown names are not recorded; foreign ids and bad choices are refused.
recorded=null;assert.deepEqual(await debateResult({value:{token:expired,ids:['amap_a','amap_c'],choice:'both'},user,rpc,now,secret}),{recorded:false});assert.equal(recorded,null);
await assert.rejects(debateResult({value:{token:expired,ids:['amap_a','amap_x'],choice:'a'},user,rpc,now,secret}),e=>e.code==='INVALID_INPUT');
await assert.rejects(debateResult({value:{token:expired,ids:['amap_a','amap_b'],choice:'maybe'},user,rpc,now,secret}),e=>e.code==='INVALID_INPUT');
await assert.rejects(debateResult({value:{token:expired+'x',ids:['amap_a','amap_b'],choice:'a'},user,rpc,now,secret}),e=>e.code==='SEARCH_EXPIRED');
// Hitting the hourly cap is quiet: the choice still happened in the app.
assert.deepEqual(await debateResult({value:{token:expired,ids:['amap_a','amap_b'],choice:'a'},user,rpc:async n=>{if(n==='journeyhub_debate_record')throw Error('rate limit reached');return rpc(n);},now,secret}),{recorded:false});
console.log('PASS leaderboard: boards cleaned and city-checked; debate results recorded from the traveler\'s own search');
