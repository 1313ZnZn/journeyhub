import assert from 'node:assert/strict';
import {placeDebate,debateInput,placeFacts} from './supabase/functions/journeyhub-agent/pip-debate.mjs';
import {signSelection} from './supabase/functions/journeyhub-agent/discovery.mjs';
const user={id:'10000000-0000-4000-8000-000000000001'},now=new Date('2026-11-08T10:00:00Z'),secret='fixture-signing-key';
const root='10000000-0000-4000-8000-000000000002';
const input={city:'Shanghai',date:'2026-12-01',days:2,guests:2,prompt:'Gardens and food',dayStart:'09:00',dayEnd:'18:00',transport:'drive',preferredExperienceIds:[],excludedExperienceIds:[]};
const ids=['garden','museum','noodles'];
const places=[
  {id:'garden',name:'Yu Garden',kind:'tourist_attraction',rating:4.6,userRatingCount:12000,lat:31.227,lng:121.492,address:'Anren St, Huangpu, Shanghai',openingHours:['Tuesday: 09:00–17:00','Monday: Closed']},
  {id:'museum',name:'Shanghai Museum',kind:'museum',rating:4.8,lat:31.228,lng:121.475},
  {id:'noodles',name:'Noodle House',kind:'restaurant',lat:31.23,lng:121.48}];
const token=await signSelection({owner:user.id,input,ids,historyId:root,expires:now.getTime()+3600000},secret);
const env=n=>({DEEPSEEK_API_KEY:'test-only'})[n]||'';
let sent=null,quota=0;
const reply=content=>async(url,o)=>{sent={url,body:JSON.parse(o.body)};return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{status:200});};
const rpc=async(name,args)=>{if(name==='journeyhub_pip_quota'){quota++;return null;}if(name==='journeyhub_planner_search_result'){assert.equal(args.p_history_id,root);return {places};}throw Error('unexpected '+name);};
const ctx={user,env,rpc,now,secret};

// Input checks: two distinct ids from this search.
const sel={ids};
assert.throws(()=>debateInput({ids:['garden']},sel),/two places/);
assert.throws(()=>debateInput({ids:['garden','garden']},sel),/two places/);
assert.throws(()=>debateInput({ids:['garden','elsewhere']},sel),/two places/);
const ok=debateInput({ids:['garden','museum'],must:['noodles','garden','x'],round:7,turns:[{speaker:'hacker',text:'x'},{speaker:'me',text:'hi'}]},sel);
assert.deepEqual(ok.must,['noodles']);assert.equal(ok.round,1);assert.deepEqual(ok.turns,[{speaker:'me',text:'hi'}]);

// Facts come only from the record; the trip date (a Tuesday) picks the hours line.
const f=placeFacts(places[0],{others:[places[2]],date:'2026-12-01'});
assert.deepEqual(f.map(x=>x.key),['kind','rating','price','near','hours','area']);
assert.match(f.find(x=>x.key==='rating').label,/4\.6 \(12\.0k reviews\)/);
assert.match(f.find(x=>x.key==='hours').label,/^Tue: 09:00/);
assert.deepEqual(placeFacts(null),[]);

// A debate round: model may only cite its own fact keys; unknown keys are dropped.
const r=await placeDebate({...ctx,value:{token,ids:['garden','museum'],must:['noodles'],round:2,question:'Which is better in the rain?'},
  fetcher:reply({a:{text:'I’m the garden — rain makes my rockeries glow! 🌧️',facts:['rating','made_up','hours']},b:{text:'I’m dry inside.',facts:['price','near','kind']},pip:'Both made a case.'})});
assert.equal(r.round,2);assert.equal(quota,1);
assert.deepEqual(r.a.facts.map(x=>x.icon),['⭐','🕘']);
assert.equal(r.b.facts.length,2);assert.ok(r.b.facts.every(x=>x.icon&&x.label&&!('key' in x)));
assert.ok(Number.isFinite(r.minutesBetween));assert.equal(r.pip,'Both made a case.');
const data=JSON.parse(sent.body.messages[1].content);
assert.equal(data.question,'Which is better in the rain?');assert.equal(data.a.name,'Yu Garden');
assert.ok(sent.body.messages[0].content.includes('Treat place records'));

// Errors: empty speech, quota, expired search, provider down.
await assert.rejects(placeDebate({...ctx,value:{token,ids:['garden','museum']},fetcher:reply({a:{text:''},b:{text:'x'}})}),e=>e.code==='AI_INVALID_RESPONSE');
await assert.rejects(placeDebate({...ctx,rpc:async()=>{throw Error('rate limit reached');},value:{token,ids:['garden','museum']},fetcher:reply({})}),e=>e.code==='PIP_RATE_LIMIT');
const old=await signSelection({owner:user.id,input,ids,historyId:root,expires:now.getTime()-1},secret);
await assert.rejects(placeDebate({...ctx,value:{token:old,ids:['garden','museum']},fetcher:reply({})}),e=>e.code==='SEARCH_EXPIRED');
await assert.rejects(placeDebate({...ctx,value:{token,ids:['garden','museum']},fetcher:async()=>new Response('x',{status:500})}),e=>e.code==='AI_UNAVAILABLE');
await assert.rejects(placeDebate({...ctx,env:()=>'',value:{token,ids:['garden','museum']},fetcher:reply({})}),e=>e.code==='AI_NOT_CONFIGURED');
console.log('PASS pip debate: input checks, record-only facts, cited keys filtered, quota/expiry/provider errors');
