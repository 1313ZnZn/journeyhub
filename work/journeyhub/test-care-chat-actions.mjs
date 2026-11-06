import assert from 'node:assert/strict';
import {runCareChat,careChatAction} from './supabase/functions/journeyhub-agent/care-chat.mjs';
import {readTripWallet,prepareVirtualPayment,paymentView,receiptView} from './supabase/functions/journeyhub-agent/care-chat-actions.mjs';
const id='11111111-1111-4111-8111-111111111111',req='22222222-2222-4222-8222-222222222222',quoteId='33333333-3333-4333-8333-333333333333',lease='44444444-4444-4444-8444-444444444444';
const owner='owner',now=new Date('2026-11-05T15:00:00Z'); // Day 1 scheduled times have elapsed, not completed.
const places=[{id:'A',name:'Art Museum',kind:'museum',lat:31.23,lng:121.47},{id:'B',name:'Waitan Jiayan',kind:'restaurant',lat:31.231,lng:121.471},{id:'C',name:'Blue Bottle Coffee',kind:'cafe',lat:31.232,lng:121.472},{id:'D',name:'Local Restaurant',kind:'restaurant',lat:31.233,lng:121.473}];
const row={id,sourceId:id,sourceType:'history',status:'active',revision:1,input:{city:'Shanghai',date:'2026-11-05',days:4,dayStart:'08:00',dayEnd:'22:00',transport:'car',guests:1},plan:{summary:'Saved itinerary',stops:[{id:'A',dayIndex:1,start:'09:00',end:'10:00'},{id:'B',dayIndex:1,start:'12:00',end:'13:00'},{id:'C',dayIndex:2,start:'12:00',end:'13:00'},{id:'D',dayIndex:3,start:'12:00',end:'13:00'}]},places,checks:[],canonicalBookings:['B','C','D'].map((stopId,i)=>({stopId,bookingId:'JH-'+(i+1),status:'confirmed',paymentStatus:'simulated_paid',simulated:true,guests:1,amountMinor:5000}))};
const wallet={currency:'CNY',balanceMinor:85000,demo:true,ledger:[],bookings:row.canonicalBookings.map(b=>({id:'receipt-'+b.stopId,quoteId,bookingId:b.bookingId,sourceType:'history',sourceId:id,stopId:b.stopId,status:'simulated_confirmed',canonicalStatus:'confirmed',paymentStatus:'simulated_paid',amountMinor:b.amountMinor,quantity:1,date:'2026-11-05'}))};
const env=n=>n==='DEEPSEEK_API_KEY'?'test':undefined,clone=v=>structuredClone(v),call=(name,args={})=>({name,args});
function harness(sequence,{care=clone(row),history=[],walletValue=clone(wallet),quote=null,sourceError=null,routeDurations={}}={}){
 let index=0,complete=null,routeCalls=0;const calls=[],observations=[];
 const rpc=async(name,args)=>{
  assert.equal(args.p_user_id,owner);calls.push({name,args});
  if(name==='journeyhub_care_chat_claim')return{lease,care,alternatives:places,conversation:{messages:history},request:{message:'是的',dayIndex:1}};
  if(name==='journeyhub_demo_wallet_state')return walletValue;
  if(name==='journeyhub_demo_source'){if(sourceError)throw Error(sourceError);return{input:care.input,plan:care.plan,quote};}
  if(name==='journeyhub_care_chat_complete'){complete=args;return{care,conversation:{pending:null}};}
  if(name==='journeyhub_care_chat_fail')throw Error(args.p_message);
  throw Error('Unexpected RPC '+name);
 };
 const fetcher=async(url,options)=>{
  assert(url.endsWith('/chat/completions'));
  const body=JSON.parse(options.body),obs=JSON.parse(body.messages[1].content);observations.push(obs);
  assert.equal(body.tool_choice,'auto');assert(!body.tools.some(t=>/^(?:debit|demo_book|topup|real_payment|cancel)/.test(t.function.name)));
  const item=sequence[index++],next=typeof item==='function'?item(obs):item;assert(next,'Unexpected model call');
  return Response.json({choices:[{message:{tool_calls:[{type:'function',function:{name:next.name,arguments:JSON.stringify(next.args)}}]},finish_reason:'tool_calls'}]});
 };
 const routePlanner=async plan=>{routeCalls++;plan.roadRoutes=[{day:1,status:'ready',placeIds:plan.stops.map(s=>s.id),legs:plan.stops.slice(1).map((s,i)=>({fromId:plan.stops[i].id,toId:s.id,durationMinutes:routeDurations[plan.stops[i].id+'|'+s.id]||15,distanceMeters:1000,source:'Amap'})),path:[[121.47,31.23],[121.48,31.24]]}];};
 return {context:{user:{id:owner},env,rpc,fetcher,now},calls,observations,get complete(){return complete},get routeCalls(){return routeCalls},run:()=>runCareChat({id,userId:owner,requestId:req},{env,rpc,fetcher,now,routePlanner})};
}

// The exact production shape: canonical simulated_paid bookings plus wallet receipts.
{
 const h=harness([call('read_wallet'),obs=>{assert.equal(obs.recentObservations.at(-1).paidCount,3);return call('prepare_virtual_payment',{scope:'existing_reservations'})},call('respond',{items:['Paid reservations verified.']})]);
 const result=await h.run();assert.equal(result.status,'completed');assert.match(h.complete.p_response,/3 reservations are already paid/);assert.match(h.complete.p_response,/850\.00/);assert.deepEqual(h.complete.p_result,{payment:{quoteId}});assert(!h.calls.some(c=>c.name==='journeyhub_demo_source'),'past paid trips do not request a new quote');assert(!h.calls.some(c=>/book|topup|cancel/.test(c.name)),'agent never charges credits');
}
// A mixed existing-reservations request cannot silently expand into new bookings.
{
 const care=clone(row);care.canonicalBookings[0].paymentStatus='legacy_unpaid';const h=harness([],{care});
 const result=await prepareVirtualPayment(care,Object.fromEntries(places.map(p=>[p.id,p])),'existing_reservations',h.context);assert.equal(result.ok,false);assert.match(result.message,/whole itinerary/);assert(!h.calls.some(c=>c.name==='journeyhub_demo_source'));
}
// New requested trip checkout uses existing quote validation, and only prepares.
{
 const care=clone(row);care.canonicalBookings=[];care.input.date='2026-11-12';
 const quote={id:quoteId,status:'quoted',currency:'CNY',totalMinor:9000,items:[{stopId:'A',title:'Museum ticket',quantity:1,totalMinor:4000,amountDueMinor:4000,kind:'ticket'},{stopId:'B',title:'Restaurant reservation',quantity:1,totalMinor:5000,amountDueMinor:5000,kind:'restaurant'}],expiresAt:'2026-11-05T16:00:00Z'};
 const h=harness([call('prepare_virtual_payment',{scope:'trip'}),call('respond',{items:['Review the quote.']})],{care,quote});await h.run();assert.deepEqual(h.complete.p_result,{payment:{quoteId}});assert.match(h.complete.p_response,/Confirm virtual payment/);assert(h.calls.some(c=>c.name==='journeyhub_demo_source'));assert(!h.calls.some(c=>c.name==='journeyhub_demo_book'));
 const insufficient=harness([call('prepare_virtual_payment',{scope:'trip'}),call('respond',{items:['Review the quote.']})],{care,quote,walletValue:{...wallet,balanceMinor:500}});await insufficient.run();assert.match(insufficient.complete.p_response,/Add CNY 85\.00/);assert(!insufficient.calls.some(c=>c.name.includes('topup')));
}
// Day swap uses saved conversation, keeps paid stops fixed, tolerates legacy empty day4.
{
 const history=[{role:'user',text:'把行程一和行程二时间互换一下'},{role:'assistant',text:'Do you mean swap day 1 and day 2 while keeping reservations unchanged?'},{role:'user',text:'是的'}];
 const h=harness([obs=>{assert.equal(obs.stops.find(s=>s.id==='A').completed,false,'elapsed schedule is not completion');assert.equal(obs.conversation.at(-1).text,'是的');return call('propose_day_swap',{firstDay:1,secondDay:2,title:'Swap flexible day 1 and day 2 visits'})},call('respond',{items:['Review the partial swap.']})],{history});
 const result=await h.run();assert.equal(result.status,'completed');const proposal=h.complete.p_proposal;assert(proposal?.canApply);assert.deepEqual(proposal.affectedDays,[1,2]);assert.equal(proposal.plan.stops.find(s=>s.id==='A').dayIndex,2);for(const b of ['B','C','D']){const old=row.plan.stops.find(s=>s.id===b),updated=proposal.plan.stops.find(s=>s.id===b);assert.equal(updated.dayIndex,old.dayIndex);assert.equal(updated.start,old.start);assert.equal(updated.end,old.end);}assert(!proposal.plan.stops.some(s=>s.dayIndex===4));assert.match(proposal.changes[0].before,/Day 1/);assert.match(proposal.changes[0].after,/Day 2/);assert.equal(h.routeCalls,1);
}
// A real full swap when both days have flexible visits; explicit completion stays fixed.
{
 const care=clone(row);care.canonicalBookings=care.canonicalBookings.filter(b=>b.stopId!=='C');
 const h=harness([call('propose_day_swap',{firstDay:1,secondDay:2,title:'Swap both days'}),call('respond',{items:['Review the swap.']})],{care});await h.run();assert.equal(h.complete.p_proposal.plan.stops.find(s=>s.id==='C').dayIndex,1);assert.equal(h.complete.p_proposal.plan.stops.find(s=>s.id==='A').dayIndex,2);
 const completed=clone(row);completed.plan.stops[0].status='completed';const blocked=harness([call('propose_day_swap',{firstDay:1,secondDay:2,title:'Swap both days'}),obs=>{assert.match(obs.recentObservations.at(-1).message,/reserved or explicitly completed/);return call('ask_follow_up',{question:'Only reserved or completed visits remain on these days. Would you like to adjust day 3 instead?'})}],{care:completed});await blocked.run();assert.equal(blocked.complete.p_proposal,null);
}
// Exact live failure: legacy day2 fixed 09–10 /10:30–12 /12:15–13:45,
// three day1 flexible visits, immutable lunch/day3 and an already-empty day4.
{
 const live=clone(row);live.input.dayEnd='21:00';
 live.plan.stops=[{id:'bund',dayIndex:1,start:'09:00',end:'11:00'},{id:'rock',dayIndex:1,start:'11:15',end:'12:45'},{id:'waitan',dayIndex:1,start:'13:00',end:'14:30'},{id:'river',dayIndex:1,start:'19:00',end:'21:00'},{id:'blue',dayIndex:2,start:'09:00',end:'10:00'},{id:'view',dayIndex:2,start:'10:30',end:'12:00'},{id:'renhe',dayIndex:2,start:'12:15',end:'13:45'},{id:'azul',dayIndex:3,start:'12:00',end:'13:30'}];
 live.places=live.plan.stops.map((s,i)=>({id:s.id,name:({bund:'The Bund Architecture Exhibition Group',rock:'Rockbund',waitan:'Waitan Jiayan',river:'Huangpu River',blue:'Blue Bottle Coffee',view:'Cafe with a View',renhe:'Renheguan',azul:'AZUL Italian Restaurant'})[s.id],kind:['bund','rock','river'].includes(s.id)?'tourist attraction':'restaurant',lat:31.23+i*.0001,lng:121.47+i*.0001}));
 live.canonicalBookings=['waitan','blue','view','renhe','azul'].map(id=>({stopId:id,bookingId:'PAID-'+id,status:'confirmed',paymentStatus:'simulated_paid',simulated:true}));
 const malformedModelSchedule=[{id:'bund',dayIndex:2,start:'09:00',end:'11:00'},{id:'rock',dayIndex:2,start:'11:15',end:'12:45'},{id:'river',dayIndex:2,start:'19:00',end:'21:00'},{id:'waitan',dayIndex:2,start:'12:00',end:'13:00'}];
 const h=harness([call('propose_day_swap',{firstDay:1,secondDay:2,title:'Swap flexible visits around reservations',stops:malformedModelSchedule}),call('respond',{items:['Review the partial swap.']})],{care:live,routeDurations:{'view|renhe':30,'renhe|bund':35,'bund|rock':10,'rock|river':20}});
 assert.equal((await h.run()).status,'completed');const p=h.complete.p_proposal;assert(p?.canApply,'legacy fixed transfer is warned, not an impossible gate');assert.equal(p.plan.stops.length,8);assert.deepEqual(p.affectedDays,[1,2]);
 for(const id of ['bund','rock','river'])assert.equal(p.plan.stops.find(s=>s.id===id).dayIndex,2);
 for(const id of ['waitan','blue','view','renhe','azul']){const before=live.plan.stops.find(s=>s.id===id),after=p.plan.stops.find(s=>s.id===id);assert.deepEqual([after.dayIndex,after.start,after.end],[before.dayIndex,before.start,before.end]);}
 assert.equal(p.plan.stops.find(s=>s.id==='river').start,'19:00','retain night-walk preference when feasible');assert.equal(p.plan.stops.find(s=>s.id==='bund').start,'14:30','actual 35m drive +10m buffer repairs packing');assert(p.warnings.some(w=>w.type==='retained_transfer'&&w.from==='view'&&w.to==='renhe'));assert.match(h.complete.p_response,/existing transfer between reserved visits is tight/);assert(!p.plan.stops.some(s=>s.dayIndex===4));assert.equal(h.routeCalls,1,'same route order reuses the verified durations during internal repair');
}
// Persisted payment cards, captured receipt balances and both affected-day snapshots.
{
 const paymentAction={quoteId,currency:'CNY',totalMinor:9000,balanceMinor:85000,shortfallMinor:0,status:'ready',expiresAt:'2026-11-05T16:00:00Z',items:[{stopId:'A',title:'Museum ticket',quantity:1,totalMinor:4000,status:'new'}],simulated:true};
 const paymentReceipt={quoteId,totalMinor:9000,balanceMinor:76000,currency:'CNY',bookingIds:['JH-1','JH-2'],simulated:true};
 const days=[1,2].map(dayIndex=>({revision:2,dayIndex,city:'Shanghai',date:'2026-11-0'+(4+dayIndex),stops:[{id:'old'+dayIndex,name:'Saved Museum',kind:'museum',dayIndex,start:'09:00',end:'10:00'}]}));
 const messages=[{id:req+':assistant',role:'assistant',text:'Review virtual payment.',paymentAction},{id:quoteId+':payment',role:'assistant',text:'Virtual payment recorded.',paymentReceipt},{id:lease+':applied',role:'assistant',dayIndex:1,text:'Days adjusted.',itineraries:days}];
 let rpcCalls=0;const rpc=async(name,args)=>{rpcCalls++;assert.equal(args.p_user_id,owner);if(name==='journeyhub_care_chat_payment')assert.equal(args.p_quote_id,quoteId);return{care:{...row,revision:2},conversation:{messages,pending:null}};};
 const context={user:{id:owner},rpc,now,env};
 const result=await careChatAction({...context,value:{action:'care_chat_pay',id,requestId:req,quoteId}});assert.equal(rpcCalls,1);assert.deepEqual(result.body.conversation.messages[0].paymentAction,paymentAction);assert.deepEqual(result.body.conversation.messages[1].paymentReceipt,paymentReceipt);assert.deepEqual(result.body.conversation.messages[2].itineraries,days);
 assert.equal(paymentView({...paymentAction,simulated:false}),null);assert.equal(paymentView({...paymentAction,totalMinor:-1}),null);assert.equal(receiptView({...paymentReceipt,balanceMinor:-1}),null);
 await assert.rejects(()=>careChatAction({...context,user:null,value:{action:'care_chat_pay',id,requestId:req,quoteId}}),e=>e.code==='SIGN_IN_REQUIRED');
}
console.log('PASS Trip Agent actions: grounded already-paid receipts, no duplicate debit/automatic top-up, scoped quote preparation, balance/confirmation cards, bilingual follow-up, actual full/partial day swap, elapsed-vs-completed distinction, booked protections, legacy empty-day preservation and multiday snapshots.');
