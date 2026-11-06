import assert from 'node:assert/strict';
import {createAgentHandler} from './supabase/functions/journeyhub-agent/handler.mjs';

const owner='f7000000-0000-4000-8000-000000000001',id='f7000000-1000-4000-8000-000000000001',requestId='f7000000-2000-4000-8000-000000000001',proposalId='f7000000-3000-4000-8000-000000000001';
const now=new Date('2026-11-05T12:00:00Z');
const envGet=name=>({DEEPSEEK_API_KEY:'fixture-ai',SUPABASE_URL:'https://database.example.invalid',SUPABASE_ANON_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'}[name]);
const authenticate=async()=>({id:owner,email_confirmed_at:'2026-11-01T00:00:00Z'}),logMetric=()=>{};
const input={city:'Shanghai',date:'2026-11-12',days:2,dayStart:'09:00',dayEnd:'21:00'};
const care={id,sourceId:id,sourceType:'history',status:'active',revision:1,input,plan:{stops:[{id:'a',dayIndex:1,start:'10:00',end:'11:00'},{id:'b',dayIndex:2,start:'10:00',end:'11:00'}]},places:[{id:'a',name:'Museum'},{id:'b',name:'Restaurant'}]};
const request=(value,headers={})=>new Request('https://journeyhub.example.invalid/functions/v1/journeyhub-agent',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
const start={action:'care_chat',id,requestId,message:'Move the museum visit 30 minutes later.',day:1};
const quoteId='f7000000-4000-4000-8000-000000000001';
const actions=[start,{action:'care_chat_history',id},{action:'care_chat_apply',id,requestId,proposalId},{action:'care_chat_pay',id,requestId,quoteId}];
const result=(status=null)=>({care,conversation:{messages:[{id:requestId,role:'user',text:start.message,dayIndex:1}],pending:status?{requestId,status,dayIndex:1}:null},lease:'private-lease',alternatives:[{secret:'internal'}]});

let rpcCount=0,providerCount=0;
const anonymous=createAgentHandler({envGet,now:()=>now,logMetric,rpc:async()=>{rpcCount++;},fetchImpl:async()=>{providerCount++;return Response.json({});}});
for(const value of actions){const r=await anonymous(request(value));assert.equal(r.status,401);assert.equal((await r.json()).error.code,'SIGN_IN_REQUIRED');}
assert.equal(rpcCount,0);assert.equal(providerCount,0);

// A claimed model request may be slow; start/status HTTP must not wait for it.
for(const value of actions.slice(0,2)){
 let release;const gate=new Promise(resolve=>release=resolve),background=[],calls=[];
 const handler=createAgentHandler({envGet,authenticate,now:()=>now,logMetric,waitUntil:p=>background.push(p),rpc:async(name,args)=>{
  calls.push({name,args});assert.equal(args.p_user_id,owner);assert.equal(args.p_care_id,id);
  if(name==='journeyhub_care_chat_claim')return gate;
  assert(['journeyhub_care_chat_start','journeyhub_care_chat_read'].includes(name));return result('pending');
 }});
 let timer;const r=await Promise.race([handler(request(value)),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('chat HTTP waited on model work')),1000))]);clearTimeout(timer);
 assert.equal(r.status,202);assert.equal(background.length,1);const body=await r.json();assert.equal(body.trip.id,id);assert.equal(body.conversation.pending.requestId,requestId);
 assert.doesNotMatch(JSON.stringify(body),/private-lease|internal|alternatives/);assert.equal(body.conversation.messages[0].dayIndex,1);
 release(null);await Promise.all(background);
}

// Saved history, explicit Apply and virtual payment confirmation use canonical RPCs, never the model.
for(const value of actions.slice(1)){
 const calls=[];let scheduled=0;
 const handler=createAgentHandler({envGet,authenticate,now:()=>now,logMetric,waitUntil:()=>scheduled++,rpc:async(name,args)=>{calls.push({name,args});assert.equal(args.p_user_id,owner);return result();},fetchImpl:async()=>{throw Error('No provider work for saved history or Apply');}});
 const r=await handler(request(value));assert.equal(r.status,200);assert.equal(scheduled,0);assert.equal(calls.length,1);
 assert.equal(calls[0].name,({care_chat_apply:'journeyhub_care_chat_apply',care_chat_pay:'journeyhub_care_chat_payment'})[value.action]||'journeyhub_care_chat_read');
 if(value.action==='care_chat_apply'){assert.equal(calls[0].args.p_request_id,requestId);assert.equal(calls[0].args.p_proposal_id,proposalId);}
 if(value.action==='care_chat_pay'){assert.equal(calls[0].args.p_request_id,requestId);assert.equal(calls[0].args.p_quote_id,quoteId);}
}

for(const [code,status] of [['CARE_CHAT_BUSY',409],['CARE_CHAT_REQUEST_CONFLICT',409],['CARE_CHAT_NOT_FOUND',404],['CARE_PROPOSAL_STALE',409],['CARE_RESERVATION_PROTECTED',409],['CARE_CHAT_INVALID',400]]){
 const handler=createAgentHandler({envGet,authenticate,now:()=>now,logMetric,fetchImpl:async(url,options)=>{
  assert(String(url).includes('/rest/v1/rpc/journeyhub_care_chat_'));assert.equal(JSON.parse(options.body).p_user_id,owner);
  return Response.json({message:code+' private-diagnostic',details:'private SQL state'},{status:400});
 }});
 const r=await handler(request(start)),body=await r.json();assert.equal(r.status,status);assert.doesNotMatch(JSON.stringify(body),/private-diagnostic|private SQL/);
}
for(const [code,status] of [['DEMO_INSUFFICIENT_FUNDS',409],['DEMO_QUOTE_EXPIRED',409],['DEMO_QUOTE_NOT_FOUND',404],['DEMO_REQUEST_REUSED',409]]){
 const handler=createAgentHandler({envGet,authenticate,now:()=>now,logMetric,rpc:async(name,args)=>{
  assert.equal(name,'journeyhub_care_chat_payment');assert.equal(args.p_user_id,owner);throw Error(code+' private-ledger-diagnostic');
 }});
 const r=await handler(request(actions[3])),body=await r.json();assert.equal(r.status,status);assert.equal(body.error.code,code);assert.doesNotMatch(JSON.stringify(body),/private-ledger/);
}
console.log('PASS Trip Agent handler: authenticated owner boundaries, asynchronous start/poll, saved-only history, explicit Apply/pay canonical RPCs, safe payment failure and private internals protected.');
