import assert from 'node:assert/strict';
import {careChatAction,runCareChat,careChatRPCError} from './supabase/functions/journeyhub-agent/care-chat.mjs';
import {presentCare} from './supabase/functions/journeyhub-agent/care.mjs';
const id='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222',lease='33333333-3333-4333-8333-333333333333';
const now=new Date('2026-11-05T02:00:00Z'),user={id:'owner'},env=name=>({DEEPSEEK_API_KEY:'test',GOOGLE_PLACES_API_KEY:'test'}[name]);
const places=[{id:'A',name:'Waterfront Park',kind:'park',lat:31.23,lng:121.47},{id:'B',name:'Mercato Italian Restaurant',kind:'restaurant',lat:31.231,lng:121.471},{id:'C',name:'Shanghai Museum',kind:'museum',lat:31.232,lng:121.472},{id:'D',name:'Matcha Tea Room',kind:'cafe',lat:31.233,lng:121.473},{id:'E',name:'BOTTEGA Italian Restaurant',kind:'restaurant',lat:31.234,lng:121.474}];
const base={id,sourceId:id,sourceType:'history',status:'active',revision:1,input:{city:'Shanghai',date:'2026-11-12',days:2,dayStart:'08:00',dayEnd:'21:00',transport:'car',guests:2},plan:{summary:'Food, tea and museums',stops:[{id:'A',dayIndex:1,start:'09:00',end:'10:00'},{id:'B',dayIndex:1,start:'11:00',end:'12:00'},{id:'C',dayIndex:1,start:'13:00',end:'14:00'},{id:'D',dayIndex:2,start:'10:00',end:'11:00'}]},places:places.slice(0,4),checks:[],canonicalBookings:[{stopId:'C',bookingId:'B1',status:'confirmed',paymentStatus:'simulated_paid',simulated:true}]};
const clone=v=>structuredClone(v),call=(name,args)=>({name,args});
function change(overrides={}){return{day:1,reason:'delay',targetId:'A',delayMinutes:37,title:'Start 37 minutes later',summary:'Shift flexible morning visits',replacements:[],stops:[{id:'A',dayIndex:1,start:'09:37',end:'10:37'},{id:'B',dayIndex:1,start:'11:37',end:'12:37'},{id:'C',dayIndex:1,start:'13:00',end:'14:00'},{id:'D',dayIndex:2,start:'10:00',end:'11:00'}],...overrides};}
function harness(sequence,{row=clone(base),message='我第一天会迟到37分钟，请调整行程。',day=1,routeMinutes=[35,20],routeFailure=false,alternatives=clone(places),claimNull=false}={}){
 let response,failed,proposal,claimed=false,routeCalls=0,modelCalls=0;const calls=[],requests=[],observations=[];
 const messages=[{id:'user1',role:'user',text:message,dayIndex:day,createdAt:now.toISOString()}];
 const conversation=()=>({messages,pending:response||failed?null:{requestId,status:'running'}});
 const rpc=async(name,args)=>{
  calls.push({name,args});assert.equal(args.p_user_id,user.id,'every RPC is owner scoped');
  if(name==='journeyhub_care_chat_claim'){if(claimNull||claimed)return null;claimed=true;return{lease,care:clone(row),conversation:conversation(),alternatives,request:{message,dayIndex:day}};}
  if(name==='journeyhub_care_chat_complete'){assert.equal(args.p_lease,lease);response=args.p_response;proposal=args.p_proposal;row.proposal=proposal;messages.push({id:'assistant1',role:'assistant',text:response,dayIndex:day,createdAt:now.toISOString()});return{care:row,conversation:conversation()};}
  if(name==='journeyhub_care_chat_fail'){failed=args.p_message;return null;}
  if(name==='journeyhub_care_chat_read'||name==='journeyhub_care_chat_start')return{care:row,conversation:conversation()};
  if(name==='journeyhub_care_chat_apply'){assert.equal(args.p_proposal_id,row.proposal.id);row.plan=row.proposal.plan;row.places=alternatives;row.revision++;row.proposal=null;return{care:row,conversation:conversation()};}
  if(name==='journeyhub_planner_save_facts')return true;
  throw Error(name);
 };
 const fetcher=async(url,options)=>{
  if(url.includes('/chat/completions')){
   const body=JSON.parse(options.body);requests.push(body);observations.push(JSON.parse(body.messages[1].content));assert.equal(body.tool_choice,'auto');assert.equal(body.parallel_tool_calls,false);assert(!body.tools.some(t=>/^(?:demo_book|pay_wallet|debit|cancel|staff|shell|topup)/.test(t.function.name)));
   const item=sequence[modelCalls++];if(!item)throw Error('Unexpected extra model decision');
   if(item.invalid)return Response.json({choices:[{message:{content:'Malformed'},finish_reason:'stop'}]});
   const current=typeof item==='function'?item(observations.at(-1),body):item;
   return Response.json({choices:[{message:{tool_calls:[{type:'function',function:{name:current.name,arguments:JSON.stringify(current.args)}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:500,completion_tokens:100}});
  }
  throw Error('Unexpected network request '+url);
 };
 const routePlanner=async plan=>{routeCalls++;plan.roadRoutes=[{day:1,placeIds:plan.stops.map(p=>p.id),status:routeFailure?'unavailable':'ready',source:'Amap',legs:plan.stops.slice(1).map((p,i)=>({fromId:plan.stops[i].id,toId:p.id,durationMinutes:routeMinutes[i]||20,durationSeconds:(routeMinutes[i]||20)*60,distanceMeters:1500,source:'Amap',estimated:false})),path:[[121.47,31.23],[121.48,31.24]]}];return plan;};
 return {context:{env,user,rpc,fetcher,now,routePlanner},calls,requests,observations,run:()=>runCareChat({id,userId:user.id,requestId},{env,rpc,fetcher,now,routePlanner}),get response(){return response},get proposal(){return proposal},get row(){return row},get failed(){return failed},get modelCalls(){return modelCalls},get routeCalls(){return routeCalls}};
}

// Actual model-selected adjustment, route conflict fed back, then repaired.
{
 const repair=change();repair.stops[1]={id:'B',dayIndex:1,start:'11:22',end:'12:22'};
 const h=harness([call('propose_change',change()),(obs)=>{assert.equal(obs.recentObservations.at(-1).ok,false);assert.equal(obs.recentObservations.at(-1).issues[0].requiredMinutes,30);return call('propose_change',repair)},call('respond',{items:['Review the updated day.']})]);
 const result=await h.run();assert.equal(result.status,'completed');assert.equal(h.modelCalls,3);assert.equal(h.routeCalls,1,'verified unchanged route order is reused');assert(h.proposal?.canApply);assert.equal(h.proposal.plan.stops[0].start,'09:37');assert.equal(h.proposal.plan.stops[2].start,'13:00','booked stop is immutable');assert.deepEqual(h.proposal.plan.stops[3],base.plan.stops[3],'unaffected day metadata remains unchanged');assert.equal(h.row.plan.stops[0].start,'09:00','preview never applies');assert.match(h.response,/Apply/);assert(!/[\p{Script=Han}]/u.test(h.response));assert.equal(h.proposal.plan.estimate.basis,'illustrative');
 const loaded=await careChatAction({...h.context,value:{action:'care_chat_history',id}});assert.equal(loaded.body.conversation.messages[0].dayIndex,1);assert.equal(loaded.body.trip.proposal.id,h.proposal.id);assert.equal(loaded.body.trip.proposal.dayIndex,1);assert.equal(loaded.kickoff,null);
 const applied=await careChatAction({...h.context,value:{action:'care_chat_apply',id,requestId,proposalId:h.proposal.id}});assert.equal(applied.body.trip.stops[0].start,'09:37');assert.equal(applied.body.trip.stops[2].name,'Shanghai Museum');assert.equal(applied.body.trip.roadRoutes[0].legs[0].durationMinutes,35);assert.equal(h.row.revision,2);
 const again=await h.run();assert.equal(again.claimed,false,'duplicate delivery cannot produce a second proposal');
}
// Saved alternative substitutes a closed venue; no reservation/payment actions.
{
 const plan=change({reason:'closure',targetId:'B',title:'Replace the closed Italian restaurant',replacements:[{fromId:'B',toId:'E'}],stops:base.plan.stops.map(p=>({...p,id:p.id==='B'?'E':p.id}))});
 const h=harness([call('propose_change',plan),call('respond',{items:['Review this alternative.']})],{message:'Mercato is closed on day 1. Can you replace it with another Italian restaurant?',routeMinutes:[20,20]});
 await h.run();assert(h.proposal.canApply);assert.equal(h.proposal.plan.stops[1].id,'E');assert.equal(h.proposal.plan.stops[1].name,'BOTTEGA Italian Restaurant');assert.deepEqual(h.proposal.replacements,[{fromId:'B',toId:'E'}]);assert.equal(h.row.plan.stops[1].id,'B');assert(h.proposal.warnings.length,'unknown hours are not silently declared open');assert(h.response.includes('BOTTEGA'));
 assert(h.calls.every(c=>!/^journeyhub_(?:booking|demo|staff|reservation)/.test(c.name)));
}
// Rain can lead to a real indoor saved replacement instead of a fixed blocked reply.
{
 const plan=change({reason:'rain',targetId:'A',title:'Move indoors on day one',replacements:[{fromId:'A',toId:'E'}],stops:base.plan.stops.map(p=>({...p,id:p.id==='A'?'E':p.id}))});
 const indoor={...places[4],name:'Art Exhibition',kind:'museum'};
 const h=harness([call('propose_change',plan),call('respond',{items:['Indoor option prepared.']})],{message:'下雨了，把第一天公园换成室内活动',alternatives:[...places.slice(0,4),indoor],routeMinutes:[20,20]});await h.run();assert(h.proposal?.canApply);assert.equal(h.proposal.plan.stops[0].id,'E');
}
// Ambiguous requests yield a concise question and preserve both days.
{
 const h=harness([call('ask_follow_up',{question:'Which day and venue is closed: day 1 or day 2?'})],{message:'It is closed.',day:null});await h.run();assert.equal(h.proposal,null);assert.match(h.response,/Which day/);assert.equal(h.routeCalls,0);
}
// Readiness is grounded in saved facts and canonical booking status, with no route/model generation side effects.
{
 const row=clone(base);row.visitFacts=[{id:'C',date:'2026-11-12',fields:{hours:{text:'09:00–17:00',url:'https://museum.example/official',basis:'regular'},documents:{text:'Bring the ID used for your reservation.',url:'https://museum.example/official',basis:'regular'}}}];
 const h=harness([call('read_trip_information',{ids:['C']}),(obs)=>{const item=obs.recentObservations.at(-1).information[0];assert.equal(item.status.bookingId,'B1');assert.equal(item.facts.hours.text,'09:00–17:00');return call('respond',{items:['Shanghai Museum: published hours are 09:00–17:00.','Bring the ID used for your reservation.','Your saved reservation B1 is simulated; virtual payment is recorded.']});}],{row,message:'博物馆几点开门，需要带什么？'});await h.run();assert.equal(h.proposal,null);assert.equal(h.routeCalls,0);assert.match(h.response,/09:00–17:00/);
}
// Protected bookings, other days, invented IDs and no-op proposals are rejected.
for(const kind of ['booking','otherday','invented','noop']){
 const plan=change();
 if(kind==='booking')plan.stops[2].start='14:00';
 if(kind==='otherday')plan.stops[3].start='11:00';
 if(kind==='invented'){plan.replacements=[{fromId:'B',toId:'evil_external'}];plan.stops[1].id='evil_external';}
 if(kind==='noop'){plan.reason='reorder';plan.stops=clone(base.plan.stops);}
 const h=harness([call('propose_change',plan),(obs)=>{assert.equal(obs.recentObservations.at(-1).ok,false);return call('ask_follow_up',{question:'Would you like to adjust the flexible visits on day 1 instead?'})}]);await h.run();assert.equal(h.proposal,null,kind);assert.deepEqual(h.row.plan,base.plan);assert.equal(h.routeCalls,0);
}
// Known official closure refuses replacement, but unknown does not falsely block it.
{
 const row=clone(base);row.visitFacts=[{id:'E',date:'2026-11-12',fields:{hours:{text:'Closed all day.',url:'https://venue.example/official',basis:'dated'}}}];
 const plan=change({reason:'closure',targetId:'B',replacements:[{fromId:'B',toId:'E'}],stops:base.plan.stops.map(p=>({...p,id:p.id==='B'?'E':p.id}))});
 const h=harness([call('propose_change',plan),(obs)=>{assert.equal(obs.recentObservations.at(-1).issues[0].hours.status,'closed');return call('ask_follow_up',{question:'The saved alternative is also closed. Would you like a different day?'})}],{row});await h.run();assert.equal(h.proposal,null);assert.equal(h.routeCalls,0);
}
// Malformed tool call gets a bounded repair turn; arbitrary tools are not executable.
{
 const h=harness([{invalid:true},call('pay_wallet',{amount:40}),call('ask_follow_up',{question:'How many minutes will you be late on day 1?'})],{message:'I am late.'});await h.run();assert.equal(h.modelCalls,3);assert.equal(h.proposal,null);assert.equal(h.calls.filter(c=>c.name.includes('complete')).length,1);
}
// Failed route responses are not cached; a subsequent attempt can genuinely recover.
{
 const plan=change({reason:'reorder',stops:base.plan.stops.map(p=>p.id==='A'?{...p,start:'09:10',end:'10:10'}:clone(p))});
 const h=harness([call('propose_change',plan),call('propose_change',plan),call('ask_follow_up',{question:'The route service is unavailable. Would you like to retry shortly?'})],{routeFailure:true});await h.run();assert.equal(h.routeCalls,2);assert.equal(h.proposal,null);
}
// Request boundary, persisted pending history, and staff/payment APIs stay separate.
{
 const h=harness([]);
 const started=await careChatAction({...h.context,value:{action:'care_chat',id,requestId,message:'Move the first visit 17 minutes later.',day:1}});assert.equal(started.kickoff.requestId,requestId);assert.equal(started.body.conversation.pending.status,'running');
 await assert.rejects(()=>careChatAction({...h.context,user:null,value:{action:'care_chat_history',id}}),e=>e.code==='SIGN_IN_REQUIRED');
 await assert.rejects(()=>careChatAction({...h.context,value:{action:'care_chat',id,requestId,message:'x'.repeat(2001)}}),e=>e.code==='INVALID_INPUT');
 assert.equal(careChatRPCError(Error('CARE_CHAT_RETRY_LIMIT')).status,409);
 const hydrated=presentCare({...base,places:[],plan:{...base.plan,stops:base.plan.stops.map(p=>({...p,...places.find(x=>x.id===p.id)}))}},now);assert.equal(hydrated.stops[0].name,'Waterfront Park');assert.equal(hydrated.stops[0].lat,31.23);
}
console.log('PASS: bilingual tool-selected chat, arbitrary delay, real replacement/reorder previews, route repair/cache, confirmed reservations, immutable other days, owned shortlist, factual information, clarification, explicit Apply, persistence, idempotency and bounded malformed-tool repair.');
