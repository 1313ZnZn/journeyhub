/* Bulk itinerary deletion against the app bundle; no live service requests. */
const assert=require('node:assert/strict');
const {boot,until,alice,bob,windows}=require('./test-calendar-ui.cjs');
async function ready(h){h.visit('orders');await until(()=>h.t.cm.loaded&&!h.t.cm.loading&&h.t.th.loaded,'calendar ready');}
async function allPages(){
  const h=await boot();await ready(h);
  assert(h.app().querySelector('[data-act="cmAskAll"]'),'Calendar entry');
  h.visit('trip-history');assert(h.app().querySelector('[data-act="cmAskAll"]'),'History entry');
  await h.t.A.cmAskAll();assert.equal(h.management.length,0,'listing never deletes');
  assert.equal(h.t.cm.confirm.items.length,4,'all pages plus agent itinerary, excluding search-only');
  h.t.A.cmDismiss();assert.equal(h.management.length,0,'Back is non-destructive');
  await h.t.A.cmAskAll();await Promise.all([h.t.A.cmConfirm(),h.t.A.cmConfirm()]);
  assert.equal(h.management.length,4,'double clicks execute once');
  assert(h.management.some(x=>x.p_id==='older-plan'),'older page removed');
  assert(h.management.every(x=>x.p_action==='remove'&&x.p_kind!=='booking'));
  assert(!h.cloud.removed[alice.id].some(x=>x.id==='search-only'));
  assert.equal(h.cloud.bookings[alice.id][0].status,'confirmed','tickets unchanged');
  await h.t.A.cmRefresh();assert.equal(h.t.cm.removed.length,4,'cloud refresh retains deletions');
  h.visit('calendar-removed');assert.equal(h.app().querySelectorAll('.cm-removed-card').length,4,'recoverable');
  assert.deepEqual(h.errors,[]);h.close();
}
async function partialRetry(){
  const h=await boot();await ready(h);await h.t.A.cmAskAll();
  const original=h.w.fixtureRPC;let failed=false;
  h.w.fixtureRPC=async(name,args)=>{if(name==='journeyhub_calendar_manage'&&args.p_id==='sample-plan'&&!failed){failed=true;return {data:null,error:{message:'Temporary network failure'}};}return original(name,args);};
  await h.t.A.cmConfirm();assert.equal(h.t.cm.confirm.items.filter(x=>x.done).length,1);
  assert.match(h.t.cm.confirm.error,/1 of 4 plans deleted/);const ids=h.t.cm.confirm.items.map(x=>x.requestId);
  await h.t.A.cmConfirm();assert.equal(h.management.length,4,'completed records are not repeated');
  assert.deepEqual(h.management.map(x=>x.p_request_id),Array.from(ids),'retry preserves per-plan idempotency');
  assert.equal(h.t.cm.confirm,null);assert.deepEqual(h.errors,[]);h.close();
}
async function failureAndOwner(){
  const h=await boot();await ready(h);h.setListError(true);await h.t.A.cmAskAll();
  assert(h.t.cm.error);assert.equal(h.management.length,0);assert.equal(h.t.cm.confirm,null);
  h.setListError(false);await h.t.A.cmAskAll();let release;h.holdManage(new Promise(r=>release=r));
  const work=h.t.A.cmConfirm();await until(()=>h.management.length===1,'first removal sent');
  await h.switchUser(bob);h.holdManage(null);release();await work;await ready(h);
  assert.equal(h.management.length,1,'account switch stops remaining writes');assert.equal(h.t.cm.removed.length,0);
  assert(!h.t.cm.confirm);await h.switchUser(null);h.visit('orders');assert(!h.app().querySelector('[data-act="cmAskAll"]'));
  assert.deepEqual(h.errors,[]);h.close();
}
async function cappedRuns(){
  const h=await boot();await ready(h);const original=h.w.fixtureRPC;
  h.w.fixtureRPC=async(name,args)=>name==='journeyhub_agent_list'?{data:Array.from({length:50},(_,i)=>({id:'run-'+i,plan:{stops:[{}]}})),error:null}:original(name,args);
  await h.t.A.cmAskAll();assert.match(h.t.cm.error,/too many agent records/);assert.equal(h.management.length,0,'truncated enumeration fails closed');assert(!h.t.cm.confirm);h.close();
}
(async()=>{await allPages();await partialRetry();await failureAndOwner();await cappedRuns();console.log('PASS bulk deletion: confirmation, pagination, exclusions, recovery, duplicate clicks, partial retry/idempotency, account isolation, listing failures and list-cap guard. Mocked only.');})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>windows.forEach(w=>w.close()));
