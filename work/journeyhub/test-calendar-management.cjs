/* End-to-end management interactions against the built app; every transport is mocked. */
const assert=require('node:assert/strict');
const {boot,copy,delay,until,alice,bob,fixture,windows}=require('./test-calendar-ui.cjs');
const loaded=async h=>{h.visit('orders');await until(()=>h.t.th.loaded&&h.t.cm?.loaded&&!h.t.cm.loading,'calendar management loaded');};
const dialog=h=>h.app().querySelector('.cm-confirm');

async function testPlanRemoval(){
  const h=await boot();await loaded(h);h.t.A.calDate('2026-12-31');
  const planCard=h.app().querySelector('[data-act="calOpenHistory"][data-a="plan-one"]').closest('.cal-event');
  assert(planCard.querySelector('.cm-manage-btn'),'plan has a compact management action');
  h.t.A.cmAsk('history','plan-one');assert(dialog(h),'delete confirmation opens');assert.match(dialog(h).textContent,/Delete plan/i);assert.match(dialog(h).textContent,/reservations|bookings/i);assert.equal(h.management.length,0,'opening confirmation never writes');
  h.t.A.cmDismiss();assert(!dialog(h));assert.equal(h.management.length,0,'Keep/Cancel never writes');
  h.t.A.cmAsk('history','plan-one');let release;h.holdManage(new Promise(r=>release=r));
  const first=h.t.A.cmConfirm();await until(()=>h.management.length===1,'delete request starts');const second=h.t.A.cmConfirm();await delay(10);assert.equal(h.management.length,1,'double confirmation sends one request');release();h.holdManage(null);await Promise.all([first,second]);
  assert(!h.t.calEvents().some(e=>e.id==='plan-one'),'deleting a trip removes every day, including care-backed copy');assert(h.t.calEvents().some(e=>e.id==='run-one'),'delete does not cancel an existing reservation in another itinerary');assert.equal(h.cloud.bookings[alice.id][0].status,'confirmed');
  assert.equal(h.cloud.removed[alice.id].length,1);assert.equal(h.management[0].p_action,'remove');
  h.visit('trip-history');assert(!h.app().querySelector('[data-act="thOpen"][data-a="plan-one"]'),'history removes the same plan');
  const reopened=await boot(alice,h.storage(),h.cloud);await loaded(reopened);assert(!reopened.t.calEvents().some(e=>e.id==='plan-one'),'removal survives reload from cloud state');
  reopened.visit('calendar-removed');assert(reopened.app().querySelector('.cm-removed-card'),'Removed items exposes recoverable record');
  reopened.t.A.cmRestore('history','plan-one');assert(dialog(reopened),'restore also confirms');assert.equal(reopened.management.length,0);await reopened.t.A.cmConfirm();assert.equal(reopened.cloud.removed[alice.id].length,0);
  reopened.visit('orders');assert.equal(reopened.t.th.items.find(e=>e.id==='plan-one').input.days,2,'restore retains the whole itinerary');assert.equal(reopened.t.calEvents().filter(e=>e.id==='plan-one').length,1,'the overlapping day keeps its newer booked version');assert.equal(reopened.cloud.bookings[alice.id][0].status,'confirmed','restore does not modify a reservation');
  assert.deepEqual(h.errors,[]);assert.deepEqual(reopened.errors,[]);reopened.close();h.close();
}

async function testReservationCancellation(){
  const h=await boot();await loaded(h);h.t.A.calDate('2027-01-01');
  const card=h.app().querySelector('[data-act="ticket"][data-a="ticket-one"]').closest('.cal-event');assert(card.querySelector('.cm-manage-btn'),'reservation has a management option');
  h.t.A.cmAsk('booking','ticket-one');assert.match(dialog(h).textContent,/Cancel reservation/i);assert.equal(h.management.length,0);
  h.setManageError('Temporary network failure');await h.t.A.cmConfirm();assert(dialog(h),'failed mutation leaves the confirmation available');assert(h.t.calEvents().some(e=>e.id==='run-one'),'failure preserves the itinerary and its reservation');assert.match(dialog(h).textContent,/failure|retry|try again/i);
  h.setManageError(null);await h.t.A.cmConfirm();assert.equal(h.management.length,2);assert.equal(h.management[0].p_request_id,h.management[1].p_request_id,'retry reuses the same idempotency key');assert.equal(h.management[1].p_action,'cancel');
  assert.equal(h.cloud.bookings[alice.id].find(x=>x.booking_id==='ticket-one').status,'cancelled');assert(!h.t.calEvents().some(e=>e.id==='ticket-one'),'cancelled reservation is represented inline without duplication');assert(h.t.calEvents().some(e=>e.id==='run-one'),'cancellation retains the booked itinerary and activity');assert(h.app().textContent.includes('Cancelled'),'inline reservation shows cancellation');assert(h.t.calEvents().some(e=>e.id==='plan-one'),'other itinerary preserved');
  const replanned={...copy(h.t.ag.runs.find(x=>x.id==='run-one')),id:'run-replanned',status:'awaiting_confirmation'};h.t.ag.runs.push(replanned);h.t.render();assert(h.t.calEvents().some(e=>e.id==='run-replanned'&&e.tag==='Draft'),'a newly generated draft can offer the previously cancelled session');assert(!h.t.calEvents().some(e=>e.id==='run-one'),'the old booked run still does not resurface');
  assert(!h.cloud.removed[alice.id]?.some(x=>x.id==='ticket-one'),'cancellation is not a reversible soft-delete');
  assert(h.management.every(x=>x.p_kind==='booking'));assert(h.requests.every(x=>['care_status','history_list','history_open','demo_state'].includes(x.action)),'no third-party cancellation, booking, generation or email');assert.deepEqual(h.errors,[]);h.close();
}

async function testCompletedReservation(){
  const cloud={bookings:{[alice.id]:copy(fixture.bookings)}};cloud.bookings[alice.id][0].checked_in_at='2026-11-01T04:00:00Z';
  const h=await boot(alice,{},cloud);await loaded(h);h.t.A.calDate('2027-01-01');h.t.A.cmAsk('booking','ticket-one');
  assert.match(dialog(h).textContent,/Remove from calendar/i,'checked-in booking offers removal, not cancellation');assert.doesNotMatch(dialog(h).textContent,/Cancel reservation/i);await h.t.A.cmConfirm();
  assert.equal(h.management[0].p_action,'remove');assert.equal(cloud.bookings[alice.id][0].status,'confirmed','removing a record preserves historical result');assert(!h.t.calEvents().some(e=>e.id==='ticket-one'));assert(h.t.calEvents().some(e=>e.id==='run-one'),'hiding the reservation record does not delete the itinerary activity');
  h.visit('calendar-removed');h.t.A.cmRestore('booking','ticket-one');await h.t.A.cmConfirm();h.visit('orders');assert(h.t.calEvents().some(e=>e.id==='run-one'),'historical reservation remains attached to the itinerary');assert.equal(cloud.bookings[alice.id][0].status,'confirmed');assert.deepEqual(h.errors,[]);h.close();
}

async function testPastAndNonConfirmed(){
  const h=await boot();await loaded(h);const booking=h.t.db.bookings['ticket-one'],session=h.t.db.sessions[booking.slot],start=session.startsAt;
  session.startsAt='2020-01-01T00:30:00Z';h.t.A.cmAsk('booking','ticket-one');assert.match(dialog(h).textContent,/Remove from calendar/i,'past reservation cannot be cancelled');h.t.A.cmDismiss();session.startsAt=start;
  booking.status='no_show';h.t.A.cmAsk('booking','ticket-one');assert.match(dialog(h).textContent,/Remove from calendar/i,'a no-show is a historical record, not an active cancellable reservation');h.t.A.cmDismiss();assert.equal(h.management.length,0);assert.deepEqual(h.errors,[]);h.close();
}

async function testRunRemoval(){
  const h=await boot();await loaded(h);h.t.A.calDate('2027-01-01');
  h.t.ag.runs[0].plan.stops.push({sessionId:'unbooked-session',title:'A planned visit',startsAt:'2027-01-01T02:00:00Z',endsAt:'2027-01-01T03:00:00Z',timeZone:'Asia/Shanghai'});h.t.render();
  assert(h.t.calEvents().some(e=>e.id==='run-one'));h.t.A.cmAsk('run','run-one');await h.t.A.cmConfirm();assert.equal(h.management[0].p_kind,'run');assert(!h.t.calEvents().some(e=>e.id==='run-one'));assert(h.t.calEvents().some(e=>e.id==='ticket-one'),'deleting a booked plan leaves its real reservation intact');
  h.t.A.cmRestore('run','run-one');await h.t.A.cmConfirm();assert(h.t.calEvents().some(e=>e.id==='run-one'),'run plan restores');assert.equal(h.cloud.bookings[alice.id][0].status,'confirmed');assert.deepEqual(h.errors,[]);h.close();
}

async function testFullyBookedRunRemoval(){
  const h=await boot();await loaded(h);assert(h.t.calEvents().some(e=>e.id==='run-one'),'fully booked itinerary remains in Calendar with inline tickets');h.visit('reserved-trips');
  const open=h.app().querySelector('.cm-run-row [data-act="agOpen"][data-a="run-one"]');assert(open,'fully booked plan remains listed in All reservations');const row=open.closest('.cm-run-row'),remove=row.querySelector('[data-act="cmAsk"][data-a="run"][data-b="run-one"]');assert(remove,'fully booked plan can still be deleted from its list');assert(!open.contains(remove),'delete button is separate from the open button');remove.click();await h.t.A.cmConfirm();assert.equal(h.management[0].p_kind,'run');assert(!h.app().querySelector('[data-act="agOpen"][data-a="run-one"]'));assert.equal(h.cloud.bookings[alice.id][0].status,'confirmed');h.visit('orders');assert(h.t.calEvents().some(e=>e.id==='ticket-one'),'deleting fully booked plan does not cancel its ticket');assert.deepEqual(h.errors,[]);h.close();
}

async function testTicketDialog(){
  const h=await boot();h.visit('journey');assert(!h.t.cm.loaded,'ticket opens before Calendar settings load');h.t.A.ticket('ticket-one');
  await until(()=>h.t.cm.loaded&&!h.t.cm.loading,'ticket loads management settings outside Calendar');
  let ticket=h.app().querySelector('[role="dialog"][aria-label="Ticket"]');assert(ticket,'existing ticket dialog remains');assert(ticket.textContent.includes('CAL123'),'ticket/check-in data retained');assert(ticket.contains(h.w.document.activeElement),'focus remains in the ticket dialog');
  const cancel=ticket.querySelector('.cm-manage-btn');assert(cancel&&!cancel.disabled,'ticket offers cancellation after settings load');assert.equal(cancel.textContent,'Cancel reservation');cancel.click();
  assert.equal(h.app().querySelectorAll('[role="dialog"]').length,1,'management replaces rather than nests the ticket sheet');assert(dialog(h).contains(h.w.document.activeElement),'confirmation gets focus');assert.equal(h.management.length,0,'ticket action only opens confirmation');h.click('cmDismiss');assert.equal(h.app().querySelector('[role="dialog"]'),null,'Keep it dismisses cleanly');assert.equal(h.cloud.bookings[alice.id][0].status,'confirmed');
  h.t.A.ticket('ticket-one');ticket=h.app().querySelector('[role="dialog"][aria-label="Ticket"]');ticket.querySelector('.cm-manage-btn').click();h.click('cmConfirm');await until(()=>h.management.length===1&&!h.t.cm.busy,'ticket cancellation completes');assert.equal(h.cloud.bookings[alice.id][0].status,'cancelled');assert.equal(h.app().querySelector('[role="dialog"]'),null);assert.equal(h.t.state.route,'journey','ticket management preserves surrounding navigation');assert.deepEqual(h.errors,[]);h.close();
}

async function testRestoreOlderHistory(){
  const cloud={removed:{[alice.id]:[{kind:'history',id:'older-plan',title:'Shanghai trip',date:'2026-10-01',city:'Shanghai',removedAt:'2026-11-04T01:00:00Z'}]}};
  const h=await boot(alice,{},cloud);await loaded(h);assert(!h.t.th.items.some(x=>x.id==='older-plan'),'older itinerary is outside the first history page');assert(h.t.th.cursor);
  h.visit('calendar-removed');const before=h.requests.length;h.t.A.cmRestore('history','older-plan');await h.t.A.cmConfirm();
  assert.equal(h.management.length,1);assert.equal(h.management[0].p_action,'restore');assert.equal(cloud.removed[alice.id].length,0);assert(h.t.th.items.some(x=>x.id==='older-plan'),'restore loads the missing saved history summary');
  const reads=h.requests.slice(before);assert(reads.some(x=>x.action==='history_list'&&x.cursor),'restore follows the summary cursor');assert(reads.every(x=>x.action==='history_list'),'restore does not reopen/hydrate places, generate a plan or start trip support');assert.equal(h.t.state.route,'calendar-removed','restore does not force itinerary navigation');
  h.visit('orders');h.t.A.calDate('2026-10-01');const rows=h.t.calEvents().filter(e=>e.id==='older-plan');assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-10-01');assert(h.app().querySelector('[data-act="calOpenHistory"][data-a="older-plan"]'),'restored old itinerary is immediately available in Calendar');await until(()=>h.t.cal.details['older-plan']?.plan,'restored selected day hydrates inline');assert.deepEqual(h.errors,[]);h.close();
}

async function testAuthIsolation(){
  const h=await boot();await loaded(h);h.t.A.calDate('2026-12-31');h.t.A.cmAsk('history','plan-one');let release;h.holdManage(new Promise(r=>release=r));const mutation=h.t.A.cmConfirm();await until(()=>h.management.length===1,'held mutation started');
  await h.switchUser(bob);await loaded(h);h.holdManage(null);release();await mutation;assert.equal(h.t.cm.owner,bob.id);assert.equal(h.t.cm.removed.length,0,'late Alice mutation cannot inject Alice removal into Bob');assert.equal(h.t.calEvents().length,0);assert(!dialog(h));
  h.visit('calendar-removed');assert(!h.app().querySelector('.cm-removed-card'),'other account cannot see removed titles');await h.switchUser(alice);await loaded(h);assert(h.t.cm.removed.some(x=>x.id==='plan-one'),'original account receives its persisted removal');
  let releaseState;h.holdState(new Promise(r=>releaseState=r));const refresh=h.t.A.cmRefresh();await until(()=>h.t.cm.loading,'held state read starts');await h.switchUser(bob);h.holdState(null);releaseState({data:{removed:[{kind:'history',id:'private-stale',title:'Alice private itinerary',date:'2026-12-31'}]},error:null});await refresh;await loaded(h);assert(!h.t.cm.removed.some(x=>x.id==='private-stale'),'late old-account state is ignored');
  await h.switchUser(null);h.visit('orders');assert(!h.app().querySelector('.cm-manage-btn'));assert(!dialog(h));assert.equal(h.t.calEvents().length,0);assert.deepEqual(h.errors,[]);h.close();
}

async function testMockAuthAtRequestStart(){
  const h=await boot();const privateBody={plan:{savedStops:[{slot:'unbooked-session',title:'Alice private draft'}],savedMeta:{}}};
  const pending=h.w.fixtureRPC('journeyhub_command',{p_operation:'personal',p_payload:{body:privateBody}});await h.switchUser(bob);await pending;await loaded(h);
  assert.deepEqual(h.cloud.personal[alice.id],privateBody,'delayed mock personal writes keep the identity that sent the request');assert.notDeepEqual(h.cloud.personal[bob.id],privateBody,'mock must never retarget pending writes at the newly signed-in account');assert.equal(h.t.calEvents().length,0,'Bob cannot receive Alice draft through a late mock autosave');assert.deepEqual(h.errors,[]);h.close();
}

(async()=>{await testPlanRemoval();await testRunRemoval();await testFullyBookedRunRemoval();await testReservationCancellation();await testCompletedReservation();await testPastAndNonConfirmed();await testTicketDialog();await testRestoreOlderHistory();await testAuthIsolation();await testMockAuthAtRequestStart();console.log('PASS: Calendar management confirmation/cancel, whole-plan removal, recoverable cloud state and restore, old-history restore through summary pagination without provider reads, real cancellation intent, historical-record hiding, no reservation recreation, ticket-sheet cancellation/focus/navigation, retry idempotency, duplicate-click guards, refresh persistence and cross-account stale-response isolation. All transports mocked; no live records changed.');})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>windows.forEach(w=>w.close()));
