import assert from 'node:assert/strict';
import {careChatAction} from './supabase/functions/journeyhub-agent/care-chat.mjs';

const careId='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222',proposalId='33333333-3333-4333-8333-333333333333';
const now=new Date('2026-11-05T02:00:00Z'),owner='snapshot-owner';
const snapshot={revision:2,dayIndex:2,city:'Shanghai',date:'2026-11-13',stops:[{id:'amap_B00001',name:'Shanghai Museum',kind:'museum',category:'Museums',dayIndex:2,start:'09:30',end:'11:00',reason:'Visit the collections'},{id:'amap_B00002',name:'BOTTEGA Italian Restaurant',kind:'restaurant',category:'Italian',dayIndex:2,start:'12:00',end:'13:00',reason:'Lunch'}]};
let care={id:careId,sourceId:careId,sourceType:'history',status:'active',revision:2,input:{city:'Shanghai',date:'2026-11-12',days:2},plan:{stops:[{id:'amap_B00001',dayIndex:1,start:'09:00',end:'10:00'},{id:'amap_B00002',dayIndex:2,start:'12:00',end:'13:00'}]},places:[],checks:[]};
const originalMessage={id:requestId+':applied',role:'assistant',dayIndex:2,text:'Your approved changes are saved.',createdAt:now.toISOString(),itinerary:structuredClone(snapshot)};
let messages=[structuredClone(originalMessage)];
const calls=[];
const rpc=async(name,args)=>{calls.push({name,args});if(args.p_user_id!==owner||args.p_care_id!==careId)return null;return{care,conversation:{messages,pending:null}};};
const context={user:{id:owner},rpc,now,env:()=>undefined,fetcher:()=>{throw Error('Saved snapshots must not invoke a provider');}};
const history=()=>careChatAction({...context,value:{action:'care_chat_history',id:careId}});

// Both Apply and reload serialize the actual immutable accepted revision.
const applied=await careChatAction({...context,value:{action:'care_chat_apply',id:careId,requestId,proposalId}});
assert.deepEqual(applied.body.conversation.messages[0].itinerary,snapshot);
assert.deepEqual((await history()).body.conversation.messages[0].itinerary,snapshot);
assert(calls.some(c=>c.name==='journeyhub_care_chat_apply'&&c.args.p_proposal_id===proposalId));

// A later revision can replace a place and retime it, without changing the old message.
care={...care,revision:3,plan:{stops:[{id:'amap_B00003',dayIndex:1,start:'10:00',end:'11:00'},{id:'amap_B00004',dayIndex:2,start:'15:00',end:'16:00'}]}};
messages.push({...originalMessage,id:proposalId+':applied',itinerary:{...structuredClone(snapshot),revision:3,stops:[{id:'amap_B00004',name:'New Tea Room',kind:'cafe',dayIndex:2,start:'15:00',end:'16:00'}]}});
const loaded=(await history()).body.conversation.messages;
assert.deepEqual(loaded[0].itinerary,snapshot,'old message never reads the current plan');
assert.equal(loaded[1].itinerary.revision,3);
assert.equal(loaded[1].itinerary.stops[0].start,'15:00');
loaded[0].itinerary.stops[0].name='Changed by caller';
assert.equal((await history()).body.conversation.messages[0].itinerary.stops[0].name,'Shanghai Museum','serializer creates a fresh minimal projection');

// Extra supplier, internal and security fields never leak through the projection.
messages=[{...originalMessage,itinerary:{...structuredClone(snapshot),userId:'private-owner',rawProvider:{secret:'hidden'},stops:snapshot.stops.map(s=>({...s,lat:31.2,photo:{url:'https://provider.example'},raw:{token:'hidden'},bookingId:'internal'}))}}];
assert.deepEqual((await history()).body.conversation.messages[0].itinerary,snapshot);

// Missing/backfill-ineligible snapshots stay absent; the current plan is not a fallback.
for(const mutate of [
 m=>delete m.itinerary,
 m=>m.role='user',
 m=>m.role='tool',
 m=>m.id=requestId+':assistant',
 m=>m.id='fake:applied',
 m=>m.dayIndex=1,
 m=>m.itinerary.revision=4,
 m=>m.itinerary.revision=0,
 m=>m.itinerary.dayIndex=3,
 m=>m.itinerary.date='2026-02-30',
 m=>m.itinerary.date='2026-11-12',
 m=>m.itinerary.city='Singapore',
 m=>m.itinerary.stops=[],
 m=>m.itinerary.stops=Array.from({length:17},()=>structuredClone(snapshot.stops[0])),
 m=>m.itinerary.stops[1].id=m.itinerary.stops[0].id,
 m=>m.itinerary.stops[0].id='https://malicious.example',
 m=>m.itinerary.stops[0].dayIndex=1,
 m=>m.itinerary.stops[0].name='上海博物馆',
 m=>m.itinerary.stops[0].name='x'.repeat(161),
 m=>m.itinerary.stops[0].kind={raw:'museum'},
 m=>m.itinerary.stops[0].reason='<script>untrusted</script>',
 m=>m.itinerary.stops[0].start='25:00',
 m=>m.itinerary.stops[0].end='09:00',
 m=>m.itinerary.stops[1].start='10:30'
]){
 const message=structuredClone(originalMessage);mutate(message);messages=[message];
 assert.equal(Object.hasOwn((await history()).body.conversation.messages[0],'itinerary'),false,'invalid snapshot must be omitted');
}

// An account-scoped read cannot acquire another account's snapshot.
messages=[structuredClone(originalMessage)];
await assert.rejects(()=>careChatAction({...context,user:{id:'other-account'},value:{action:'care_chat_history',id:careId}}),e=>e.code==='TRIP_NOT_FOUND');
await assert.rejects(()=>careChatAction({...context,user:null,value:{action:'care_chat_history',id:careId}}),e=>e.code==='SIGN_IN_REQUIRED');
assert(calls.every(c=>c.args.p_care_id===careId));
console.log('PASS applied chat snapshots: Apply/reload retention, immutable earlier revisions, strict minimal projection, English bounded labels, valid day/date/time/order, malformed omission and account isolation.');
