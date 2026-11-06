import assert from 'node:assert/strict';
import {demoAction,demoPrice,demoDatabaseError} from './supabase/functions/journeyhub-agent/demo-wallet.mjs';
import {createAgentHandler} from './supabase/functions/journeyhub-agent/handler.mjs';

const user={id:'60000000-0000-4000-8000-000000000001'},sourceId='60000000-0000-4000-8000-000000000002',quoteId='60000000-0000-4000-8000-000000000003',requestId='60000000-0000-4000-8000-000000000004';
assert.deepEqual(demoPrice({kind:'museum'}),{kind:'ticket',unitMinor:4000});
assert.deepEqual(demoPrice({kind:'restaurant',name:'Local dining'}),{kind:'restaurant',unitMinor:5000});
assert.deepEqual(demoPrice({kind:'restaurant',name:'抹茶茶馆'}),{kind:'cafe',unitMinor:2000});
assert.deepEqual(demoPrice({kind:'park'}),{kind:'free',unitMinor:0});
assert.deepEqual(demoPrice({kind:'tourist attraction'},{reason:'Historic Bund architecture walk'}),{kind:'free',unitMinor:0});
assert.deepEqual(demoPrice(null),{kind:'unavailable',unitMinor:0});
assert.deepEqual(demoPrice({kind:'place'}),{kind:'unavailable',unitMinor:0});

const calls=[],network=[],wallet={demo:true,currency:'CNY',balanceMinor:20000,ledger:[],bookings:[]};
let savedQuote=null,lastItems=null,providerRecovered=false;
const rpc=async(name,args)=>{
 calls.push({name,args});assert.equal(args.p_user_id,user.id,'RPC owner must be authenticated account');
 if(name==='journeyhub_demo_wallet_state')return structuredClone(wallet);
 if(name==='journeyhub_demo_source')return {input:{city:'Singapore',date:'2026-12-01',days:1,guests:2},plan:{stops:[{id:'place_museum',dayIndex:1,start:'09:00',end:'10:00'},{id:'place_restaurant',dayIndex:1,start:'12:00',end:'13:00'},{id:'place_failed',dayIndex:1,start:'14:00',end:'15:00'}]},quote:savedQuote};
 if(name==='journeyhub_demo_quote_save'){lastItems=args.p_items;return savedQuote={id:quoteId,status:'quoted',items:lastItems,totalMinor:18000,demo:true};}
 if(name==='journeyhub_demo_wallet_topup')return {...wallet,balanceMinor:wallet.balanceMinor+args.p_amount_minor};
 if(name==='journeyhub_demo_book')return {wallet,quote:savedQuote,demo:true};
 if(name==='journeyhub_demo_cancel')return {wallet,demo:true};
 throw Error('Unexpected RPC '+name);
};
const fetcher=async(url,init)=>{network.push(url);assert.match(url,/^https:\/\/places\.googleapis\.com\/v1\/places\//);assert.equal(init.redirect,'error');assert.equal(init.headers['X-Goog-FieldMask'],'id,displayName,primaryType');if(url.includes('failed')&&!providerRecovered)return Response.json({}, {status:503});const id=url.match(/places\/([^?]+)/)[1];return Response.json({id,primaryType:id.endsWith('museum')?'museum':id.endsWith('failed')?'park':'restaurant',displayName:{text:'A venue'}});};
const base={user,rpc,fetcher,env:n=>n==='GOOGLE_PLACES_API_KEY'?'test-key':'',now:new Date('2026-11-04')};
const result=await demoAction({...base,value:{action:'demo_quote',historyId:sourceId,userId:'another-account',items:[{unitMinor:1}],amountMinor:1}});
assert.equal(result.wallet.balanceMinor,20000);assert.equal(lastItems[0].unitMinor,4000);assert.equal(lastItems[1].unitMinor,5000);assert.equal(lastItems[2].kind,'unavailable');
assert(!calls.some(c=>/book$|topup$|care_confirm/.test(c.name)),'review must never charge or confirm');
providerRecovered=true;
await demoAction({...base,value:{action:'demo_quote',historyId:sourceId}});assert.equal(network.length,6,'unavailable metadata can recover after refreshing');
assert.equal(lastItems[2].kind,'free');
await demoAction({...base,value:{action:'demo_quote',historyId:sourceId}});assert.equal(network.length,6,'fresh complete cached quote must avoid provider calls');
await demoAction({...base,value:{action:'demo_book',quoteId,requestId,amountMinor:1}});
assert.deepEqual(calls.at(-1).args,{p_user_id:user.id,p_quote_id:quoteId,p_request_id:requestId});
assert(!network.some(u=>/booking|payment|purchase/.test(u)),'no supplier purchase endpoint');
await demoAction({...base,value:{action:'demo_topup',amountMinor:10000,requestId}});
for(const amountMinor of [-1,0,1.5,1000001,'10000'])await assert.rejects(demoAction({...base,value:{action:'demo_topup',amountMinor,requestId}}),e=>e.code==='DEMO_INVALID_TOPUP');
await assert.rejects(demoAction({...base,value:{action:'demo_quote',historyId:sourceId,runId:sourceId}}),e=>e.code==='INVALID_INPUT');
await assert.rejects(demoAction({...base,rpc:async()=>{throw Error('DEMO_INSUFFICIENT_FUNDS sql private diagnostics');},value:{action:'demo_book',quoteId,requestId}}),e=>e.code==='DEMO_INSUFFICIENT_FUNDS'&&!e.message.includes('diagnostics'));
assert.equal(demoDatabaseError(Error('ordinary error')),null);

const handler=createAgentHandler({envGet:()=>'',authenticate:async()=>user,rpc});
const response=await handler(new Request('https://example.invalid/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'demo_state'})}));
assert.equal(response.status,200);assert.equal((await response.json()).wallet.currency,'CNY');
let forbiddenCalls=0;
const denied=createAgentHandler({envGet:()=>'',rpc:async()=>{forbiddenCalls++;}});
const noAuth=await denied(new Request('https://example.invalid/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'demo_book',quoteId,requestId})}));
assert.equal(noAuth.status,401);assert.equal(forbiddenCalls,0);
console.log('PASS: demo prices are illustrative, owner-bound actions, fresh quote reuse, provider failure stays unavailable, client prices ignored, review never charges, sanitized errors and authentication. Mock services only.');
