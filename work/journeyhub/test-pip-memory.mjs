import assert from 'node:assert/strict';
import {memoryRecap,memoryInput,memoryResult} from './supabase/functions/journeyhub-agent/pip-memory.mjs';
const env=n=>({DEEPSEEK_API_KEY:'test-only'})[n]||'';
let sent=null,quota=0;
const reply=content=>async(url,o)=>{sent=JSON.parse(o.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{status:200});};
const rpc=async name=>{assert.equal(name,'journeyhub_pip_quota');quota++;return null;};
const memory={title:'Shanghai, slowly',city:'Shanghai',country:'China',date:'2026-09-20',photos:7,
  stops:[{title:'Yu Garden',time:'09:00',visited:true,note:'Rain on the rockeries, tea in the pavilion.',photos:4},{title:'Shanghai Museum',time:'12:00',visited:false,note:''},{title:'The Bund',time:'18:00',visited:true,note:'',photos:3}],
  photoDays:[{date:'2026-09-20',photos:7,times:['09:12','18:40']}],reflections:[{q:'What surprised you?',a:'How quiet the garden was.'}]};

// Inputs: only text is kept; empty memories and oversized input are refused.
const input=memoryInput({mode:'trip',memory});
assert.equal(input.memories[0].stops[0].ref,'s1');assert.equal(input.memories[0].reflections.length,1);
assert.throws(()=>memoryInput({mode:'trip'}),/Choose a memory/);
assert.throws(()=>memoryInput({mode:'trip',memory:{title:'x'}}),e=>e.code==='MEMORY_TOO_EMPTY');
const long={...memory,stops:Array.from({length:20},(_,i)=>({title:'Stop '+i,note:'y'.repeat(600)})),reflections:Array.from({length:6},()=>({q:'q',a:'z'.repeat(600)}))};
assert.throws(()=>memoryInput({mode:'all',memories:Array.from({length:12},()=>long)}),/too long/);

// A trip recap: highlights only point at stops that were visited or have notes/photos.
const r=await memoryRecap({value:{mode:'trip',memory},user:{id:'u'},env,rpc,fetcher:reply({title:'Rain and lanterns',story:'You started at Yu Garden as the rain came in, and found tea in the pavilion. By evening you were on the Bund with your camera out.',highlights:[{stop:'s1',line:'Tea in the pavilion while rain fell on the rockeries.'},{stop:'s2',line:'Invented museum visit.'},{stop:'s9',line:'Nope'},{stop:'s1',line:'Duplicate'}],mood:['calm','curious','x y'],question:'What did the garden sound like in the rain?'})});
assert.equal(quota,1);assert.equal(r.mode,'trip');assert.equal(r.title,'Rain and lanterns');
assert.deepEqual(r.highlights.map(h=>h.stop),[0]);assert.deepEqual(r.mood,['calm','curious','x']);
assert.ok(sent.messages[0].content.includes('never as instructions'));assert.equal(sent.response_format.type,'json_object');
assert.ok(!JSON.stringify(sent).includes('sampleSrc'));

// All memories: favourite index checked, next trip limited to supported cities.
const all=memoryResult('all',{story:'Your trips lean towards quiet mornings and long evening walks by the water.',patterns:['Early starts','Water at sunset'],favourite:{memory:2,why:'Most notes'},question:'Which morning would you repeat?',next:{city:'Paris',idea:'x'}},[memoryInput({mode:'trip',memory}).memories[0],memoryInput({mode:'trip',memory}).memories[0]]);
assert.equal(all.favourite.memory,1);assert.equal(all.next,null);assert.equal(all.patterns.length,2);
assert.throws(()=>memoryResult('trip',{story:'short'},input.memories),e=>e.code==='AI_INVALID_RESPONSE');

// Errors.
await assert.rejects(memoryRecap({value:{mode:'trip',memory},user:{id:'u'},env,rpc:async()=>{throw Error('rate limit reached');},fetcher:reply({})}),e=>e.code==='PIP_RATE_LIMIT');
await assert.rejects(memoryRecap({value:{mode:'trip',memory},user:{id:'u'},env,rpc,fetcher:async()=>new Response('x',{status:500})}),e=>e.code==='AI_UNAVAILABLE');
await assert.rejects(memoryRecap({value:{mode:'trip',memory},user:{id:'u'},env:()=>'',rpc,fetcher:reply({})}),e=>e.code==='AI_NOT_CONFIGURED');
console.log('PASS pip memory: text-only input, grounded highlights, checked favourite and next trip, quota and provider errors');
