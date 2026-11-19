/* Full app, isolated test accounts and mocked transport: never touches customer data. */
const assert=require('node:assert/strict');
const {boot,copy,until,alice,bob,fixture,windows}=require('./test-calendar-ui.cjs');
async function run(){
 const active={...copy(fixture.bookings[0]),booking_id:'reset-future',session_id:'cancelled-session',traveler_id:bob.id,demo:true};
 const cancelled={...active,booking_id:'reset-old-cancelled',status:'cancelled'};
 const retained={...active,booking_id:'reset-checked-in',session_id:'midnight-session',checked_in_at:'2026-11-01T00:00:00Z'};
 const cloud={bookings:{[bob.id]:[active,cancelled,retained],[alice.id]:copy(fixture.bookings)}};
 const untouched=copy(cloud.bookings[alice.id]);
 const h=await boot(bob,{},cloud);
 h.visit('orders');await until(()=>h.t.cm?.loaded&&h.t.th.loaded,'calendar ready');h.t.A.calDate('2027-01-05');
 assert(h.app().querySelector('[data-a="2027-01-05"] .reserved'),'future reservation initially marks the calendar');
 await h.t.A.arOpen();const confirm=h.app().querySelector('#ar-confirm');assert(confirm,'reset readiness');confirm.value='RESET';await h.t.A.arConfirm();
 assert(h.app().textContent.includes('Account content reset'),'reset finishes');
 assert.equal(cloud.bookings[bob.id].find(b=>b.booking_id===active.booking_id).status,'cancelled');
 assert.equal(h.t.db.bookings[active.booking_id].status,'cancelled','completed reset refreshes in-memory snapshot before navigation');
 const check=async client=>{
  client.visit('orders');await until(()=>client.t.th.loaded&&client.t.cm?.loaded,'calendar reload');client.t.A.calDate('2027-01-05');
  assert(!client.t.calEvents().some(e=>[active.booking_id,cancelled.booking_id].includes(e.id)));
  assert(!client.app().querySelector('[data-a="2027-01-05"] .reserved'),'no green reservation marker for cancelled-only date');
  assert(!client.app().querySelector('.cal-agenda [data-kind="reservation"]'),'no cancelled reservation card');
  assert(client.t.calEvents().some(e=>e.id===retained.booking_id),'checked-in reservation is retained');
  client.visit('reserved-trips');client.t.A.ubMyFilter('cancelled');
  for(const id of [active.booking_id,cancelled.booking_id])assert(client.app().querySelector('[data-act="ticket"][data-a="'+id+'"]'),'cancelled history stays accessible');
  assert.equal(cloud.bookings[bob.id].length,3,'no reservation records deleted');
 };
 await check(h);await h.t.A.ubReservationsRefresh();await check(h);
 const reopened=await boot(bob,h.storage(),cloud);await check(reopened);
 assert.deepEqual(cloud.bookings[alice.id],untouched,'other account untouched');
 assert(!h.management.some(x=>x.p_id===retained.booking_id),'checked-in record never cancelled or removed');
 assert.deepEqual(h.errors,[]);assert.deepEqual(reopened.errors,[]);
 console.log('PASS full-bundle test-account reset: cancelled cards and dots absent immediately and after reload; cancelled history and checked-in records retained; other account unchanged. Transport mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>windows.forEach(w=>w.close()));
