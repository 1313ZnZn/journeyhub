import assert from 'node:assert/strict';
import {pipChat,pipUpdates,pipMessages} from './supabase/functions/journeyhub-agent/pip-chat.mjs';
const env=n=>({DEEPSEEK_API_KEY:'test-only'})[n]||'';
const now=new Date('2026-11-08T10:00:00Z');let sent=null,quota=0;
const reply=content=>async(url,o)=>{sent={url,body:JSON.parse(o.body)};return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{status:200});};
const rpc=async name=>{assert.equal(name,'journeyhub_pip_quota');quota++;return null;};
// A normal turn: valid settings kept, invalid ones dropped.
const r=await pipChat({value:{messages:[{role:'user',text:'3 days in Bangkok with grandma, we love food, budget 800 yuan'}],trip:{city:'Shanghai',days:1,prompt:''}},user:{id:'u'},env,fetcher:reply({reply:'Lovely! Does Grandma prefer **short walks**? 🥟',updates:{city:'Bangkok',days:3,guests:9,budgetAmount:800,budgetCurrency:'CNY',dayStart:'25:00',date:'2020-01-01'},brief:'Food-focused, gentle pace for an older traveler.',ready:true,quick:['Short walks only','She is fine walking','A very long suggestion that should be cut at forty characters']}),rpc,now});
assert.deepEqual(r.updates,{city:'Bangkok',days:3,budgetAmount:800,budgetCurrency:'CNY'});
assert.equal(r.ready,true);assert.equal(r.quick.length,3);assert.ok(r.quick[2].length<=40);
assert.equal(sent.body.response_format.type,'json_object');assert.equal(quota,1);
assert.ok(sent.body.messages.some(m=>m.role==='user'&&/grandma/.test(m.content)));
// Unsupported city in the model's suggestion is ignored; not ready without a city.
const r2=await pipChat({value:{messages:[{role:'user',text:'Paris please'}],trip:{}},user:{id:'u'},env,fetcher:reply({reply:'I can plan Bangkok, Shanghai or Singapore.',updates:{city:'Paris'},ready:true}),rpc,now});
assert.deepEqual(r2.updates,{});assert.equal(r2.ready,false);
// Inputs are validated.
assert.throws(()=>pipMessages([]),/short message/);assert.throws(()=>pipMessages([{role:'pip',text:'hi'}]),/short message/);
assert.deepEqual(pipUpdates({budgetAmount:null}),{budgetAmount:null});
// Quota and provider failures give friendly errors.
await assert.rejects(pipChat({value:{messages:[{role:'user',text:'hi'}]},user:{id:'u'},env,fetcher:reply({}),rpc:async()=>{throw Error('rate limit reached');},now}),e=>e.code==='PIP_RATE_LIMIT');
await assert.rejects(pipChat({value:{messages:[{role:'user',text:'hi'}]},user:{id:'u'},env,fetcher:async()=>new Response('x',{status:500}),rpc,now}),e=>e.code==='AI_UNAVAILABLE');
await assert.rejects(pipChat({value:{messages:[{role:'user',text:'hi'}]},user:{id:'u'},env:()=>'',fetcher:reply({}),rpc,now}),e=>e.code==='AI_NOT_CONFIGURED');
console.log('PASS pip chat: validated settings, unsupported city ignored, input checks, quota and provider errors');
