import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const source=fs.readFileSync(new URL('./account-reset.js',import.meta.url),'utf8');
function fixture(options={}){
 const calls=[];const store=()=>Object.assign({removeItem(k){delete this[k]}},{'jh-pip:u:one':'x','jh-pip:other:one':'y','auth-token':'keep'});
 const c={A:{},V:{me:()=>({body:''})},TAB_OF:{},jhUser:{id:'u'},jhRevision:1,ui:{},jhPendingWrites:0,pd:{},jmCache:{},cm:{loaded:true},dw:{},ag:{},state:{},th:{},localStorage:store(),sessionStorage:store(),crypto:{randomUUID},document:{getElementById:()=>({value:options.confirm??'RESET'})},traveler:()=>true,isMine:b=>b.owner==='u',cmCanCancel:b=>!b.blocked,DBC:{bookings:{a:{id:'a',owner:'u',demo:true,status:'confirmed'},b:{id:'b',owner:'other',demo:true,status:'confirmed'},c:{id:'c',owner:'u',demo:false,status:'confirmed'}}},go:()=>{},render:()=>{},toast:()=>{},jhFlush:async()=>{},jhRefresh:async()=>{},cmScope:()=>{},cmLoad:async()=>{},thScope:()=>{},cmHidden:()=>false,cmError:e=>e.message,cmRows:()=>[],cmRemovedPlan:()=>{},jhAllowed:['saved'],defaults:()=>({saved:[]}),jhPersonal:()=>({}),jhCommand:async()=>calls.push('personal'),lastPersonal:'',jhPersonalDirty:false,jmRevoke:()=>{},JM:{listTrips:async()=>[{id:'memory'}],deleteTrip:async(owner,id)=>calls.push('memory:'+owner+':'+id)},jpPrefKey:o=>'prefs:'+o,pdFresh:()=>({}),thForgetHydration:()=>{},thFresh:()=>({}),jpNormalize:()=>({}),jpSavePrefs:()=>{},clearTimeout,location:{reload:()=>{}},bar:()=>'',esc:s=>s};
 c.thRequest=async payload=>payload.cursor?{items:[{id:'search2'}]}:{items:[{id:'trip1'}],nextCursor:'page2'};
 c.agRPC=async(name,p)=>{calls.push({name,p});if(options.rpc)return options.rpc(name,p,calls);if(name==='journeyhub_agent_list')return [{id:'run1',status:'completed'}];return p.p_commit===false?{ready:true}:{ok:true};};
 vm.createContext(c);vm.runInContext(source,c);return {c,calls,get:()=>vm.runInContext('ar',c)};
}
{
 const {c,calls,get}=fixture();await c.A.arOpen();assert.equal(get().items.length,3);assert.equal(get().bookings.length,1);assert(!calls.some(x=>x.p?.p_commit===true));await c.A.arConfirm();assert(get().finished);const writes=calls.filter(x=>x.p?.p_action||x.p?.p_commit===true);assert.equal(writes[0].p.p_action,'cancel');assert.equal(writes[1].p.p_commit,true);assert.equal(writes.length,5);assert.equal(c.localStorage['jh-pip:u:one'],undefined);assert.equal(c.localStorage['jh-pip:other:one'],'y');assert.equal(c.localStorage['auth-token'],'keep');assert(!calls.some(x=>typeof x==='string'&&x.startsWith('memory:')));
}
{
 const {c,calls,get}=fixture({confirm:'no'});await c.A.arOpen();await c.A.arConfirm();assert(!get().started);assert(!calls.some(x=>x.p?.p_action));
}
{
 const {c,get}=fixture({rpc:async()=>{throw Error('PGRST202')}});await c.A.arOpen();assert(!get().ready);assert.match(get().error,/server upgrade/);
}
{
 let failed=false;const {c,calls,get}=fixture({rpc:async(name,p)=>{if(name==='journeyhub_agent_list')return [];if(p.p_id==='search2'&&!failed){failed=true;throw Error('offline')}return p.p_commit===false?{ready:true}:{ok:true}}});await c.A.arOpen();await c.A.arConfirm();assert(!get().finished);await c.A.arConfirm();assert(get().finished);assert.equal(calls.filter(x=>x.p?.p_commit===true).length,1);assert.equal(calls.filter(x=>x.p?.p_action==='cancel').length,1);const retries=calls.filter(x=>x.p?.p_id==='search2');assert.equal(retries[0].p.p_request_id,retries[1].p.p_request_id);
}
{
 const {c,calls,get}=fixture();await c.A.arOpen();c.jhRevision++;c.jhUser={id:'other'};await c.A.arConfirm();assert(!get().started);assert(!calls.some(x=>x.p?.p_action));
}
{
 const {c,calls,get}=fixture();await c.A.arOpen();c.A.arMemories();await c.A.arConfirm();assert(get().finished);assert(calls.includes('memory:u:memory'));
}
// Reset must persist an empty cart even when onboarding defaults contain sample products.
for(const initialCart of [{},{tote:3,scarf:2}]){
 const {c,get}=fixture();let persisted;
 const onboarding={cart:{tote:1,scarf:1},saved:{}};
 c.defaults=()=>structuredClone(onboarding);
 c.jhAllowed=['cart','saved'];c.state.cart=initialCart;
 c.jhPersonal=()=>({cart:c.state.cart,saved:c.state.saved});
 c.jhCommand=async(operation,payload)=>{assert.equal(operation,'personal');persisted=JSON.parse(JSON.stringify(payload.body));};
 await c.A.arOpen();await c.A.arConfirm();assert(get().finished);
 assert.deepEqual(persisted.cart,{},'saved cart stays empty after reload');
 assert.equal(Object.keys(c.state.cart).length,0,'current bag is empty');
 assert.deepEqual(JSON.parse(c.lastPersonal).cart,{},'autosave snapshot has no sample items');
 assert.deepEqual(onboarding.cart,{tote:1,scarf:1},'onboarding defaults remain intact');
}
console.log('Account reset UI orchestration: PASS (scope, pagination, confirmation, readiness, retry, identity, memory opt-in, empty cart persistence)');
// Server-classified past and checked-in reservations are retained, while future ones cancel.
{
 const {c,calls,get}=fixture({rpc:async(name,p)=>name==='journeyhub_agent_list'?[]:p.p_commit===false?{ready:true,retainedBookingIds:['past','checked']}:{ok:true}});
 c.DBC.bookings.past={id:'past',owner:'u',demo:true,status:'confirmed',blocked:true};
 c.DBC.bookings.checked={id:'checked',owner:'u',demo:true,status:'confirmed',blocked:true};
 await c.A.arOpen();assert(get().ready);assert.equal(get().retained.length,2);
 await c.A.arConfirm();assert(get().finished);
 assert.deepEqual(calls.filter(x=>x.p?.p_action==='cancel').map(x=>x.p.p_id),['a']);
 assert.match(c.V['account-reset']().body,/2 started or checked-in reservations kept/);
}
// A booking starting between preflight and confirmation is reclassified before cancellation.
{
 let checks=0;const {c,calls,get}=fixture({rpc:async(name,p)=>name==='journeyhub_agent_list'?[]:p.p_commit===false?{ready:true,retainedBookingIds:++checks>1?['a']:[]}:{ok:true}});
 await c.A.arOpen();await c.A.arConfirm();assert(get().finished);assert(!calls.some(x=>x.p?.p_action==='cancel'));assert.equal(get().retained.length,1);
}
console.log('PASS: retained reservations and confirmation-time reclassification');
