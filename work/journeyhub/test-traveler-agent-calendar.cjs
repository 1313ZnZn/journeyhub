/* Full application integration, all network transports supplied by the Calendar fixture. */
const assert=require('node:assert/strict');
const {boot,until,windows,bob}=require('./test-calendar-ui.cjs');
(async()=>{
 const h=await boot(),{t,app}=h;h.visit('orders');t.A.calDate('2026-12-31');
 await until(()=>app().querySelector('.cal-schedule'),'saved day visible');
 const trip=t.tc.trips.find(x=>x.sourceId==='plan-one');assert(trip);
 const savedSchedule=app().querySelector('.cal-schedule').outerHTML,savedMap=app().querySelector('.cal-inline-map').outerHTML;
 trip.readiness={checking:false,tasks:[{id:'day-one',stopId:'p1',status:'unknown',title:'Garden admission',detail:'The official requirements still need checking.',action:'details'},{id:'day-two',stopId:'p2',status:'attention',title:'Museum visit',detail:'The visit needs adjustment.',action:'review'}]};
 t.render();
 assert.equal(app().querySelectorAll('.ta-card').length,1,'one relevant agent for selected day');
 assert(app().querySelector('.tch-entry [data-act="tchOpen"]'));assert.equal(app().querySelector('[data-act="tchOpen"]').dataset.b,'1');assert(!app().querySelector('.ta-details'));assert(!app().textContent.includes('1 to verify'));assert(!app().textContent.includes('The visit needs adjustment.'));
 assert(app().querySelector('.cal-schedule'),'schedule remains visible');assert(app().querySelector('.cal-inline-map'),'saved route remains beneath schedule');assert(!app().querySelector('.dw-day-agent'),'no second agent strip');
 assert.equal(app().querySelector('.cal-schedule').outerHTML,savedSchedule,'existing itinerary card markup stays unchanged');assert.equal(app().querySelector('.cal-inline-map').outerHTML,savedMap,'existing map stays unchanged');
 // The generic fixture has a newer catalog plan on 1 January. Remove that
 // fixture-only version so this check follows the same two-day history.
 t.ag.runs=[];t.A.calDate('2027-01-01');await until(()=>app().querySelector('.cal-schedule'),'second day visible');t.render();
 assert.equal(app().querySelector('[data-act="tchOpen"]').dataset.b,'2');assert(!app().textContent.includes('The visit needs adjustment.'));assert(!app().textContent.includes('Garden admission'));
 await h.switchUser(bob);h.visit('orders');await until(()=>t.th.loaded,'new account loaded');assert(!app().querySelector('.ta-card'),'no agent state from prior account');
 assert(h.requests.every(r=>['care_status','history_list','history_open','demo_state','planner_status','calendar_weather'].includes(r.action)),'Calendar display only reads saved facts and weather: '+h.requests.map(r=>r.action).join(', '));
 assert.deepEqual(h.errors,[]);h.close();
 console.log('PASS: production Calendar keeps saved schedule/map markup, provides one compact day-scoped Trip agent entry without dense details, and clears on account switch.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>windows.forEach(w=>w.close()));
