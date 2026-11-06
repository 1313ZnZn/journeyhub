/* Built UI integration. All database/provider calls are mocked; no real orders. */
const assert=require('node:assert/strict');
const {boot,copy,delay,until,alice,bob,fixture,windows}=require('./test-calendar-ui.cjs');
const canonicalId='BK-UNIFIED-001',sourceId='45000000-0000-4000-8000-000000000001';
for(const id of ['silk','herbal'])fixture.experiences.push({...copy(fixture.experiences[0]),experience_id:id,name:id+' historical workshop'});
fixture.metrics=['craft','silk','herbal'].flatMap(id=>[1,2,3,4].map(week=>({experience_id:id,month:'2026-09-01',week,seats_offered:30,booked:25,cancelled:2,attended:21,price:1400,cost:250})));
fixture.experiences.push({...copy(fixture.experiences[0]),experience_id:'private-demo',name:'Private virtual museum',details:{demo:true}});
fixture.sessions.push({...copy(fixture.sessions[0]),session_id:'private-demo-session',experience_id:'private-demo'});
fixture.bookings.push({...copy(fixture.bookings[0]),booking_id:'private-demo-booking',session_id:'private-demo-session',demo:true,payment_status:'simulated_paid',amount_cny_minor:4000,unit_price_cny_minor:2000});
fixture.sessionPlans.push({plan_id:'private-staff-plan',experience_id:'private-demo',session_date:'2027-01-08',start_time:'10:00:00',capacity:30,price_thb:1400,promo_budget_thb:0,reason:'Private plan must not be published',status:'draft',version:1,events:[]},{plan_id:'public-staff-plan',experience_id:'craft',session_date:'2027-01-08',start_time:'10:00:00',capacity:30,price_thb:1400,promo_budget_thb:0,reason:'Public catalog draft',status:'draft',version:1,events:[]});
fixture.liveMetrics.push({month:new Date().toISOString().slice(0,7)+'-01',experience_id:'private-demo',confirmed:2,seats_offered:12,booked_value_thb:200,sessions:1,cancelled:0,attended:0,other_channel_held:0});
(async()=>{
 const h=await boot(),{t,app,w}=h,baseFetch=w.fetch,baseRPC=w.fixtureRPC,calls=[];
 let wallet={currency:'CNY',balanceMinor:50000,ledger:[],bookings:[]},quote=null,bookCalls=0,refunds=0;
 w.fetch=async(url,init={})=>{
  if(init.method!=='POST')return baseFetch(url,init);
  const p=JSON.parse(init.body);if(!p.action.startsWith('demo_'))return baseFetch(url,init);calls.push(copy(p));
  if(p.action==='demo_state')return Response.json({wallet:copy(wallet)});
  if(p.action==='demo_session_quote'){
   assert.equal(p.sessionId,'unbooked-session');assert.equal(p.guests,3);assert(!('price'in p));assert(!('userId'in p));
   quote={id:'quote-unified',sourceType:'session',sourceId,sessionId:p.sessionId,guests:p.guests,status:'quoted',currency:'CNY',totalMinor:12000,items:[{stopId:p.sessionId,sessionId:p.sessionId,title:'Shanghai craft session',kind:'ticket',quantity:3,unitMinor:4000,totalMinor:12000,date:'2027-01-05',start:'10:00',end:'11:30',availableSeats:12,requiresBooking:true}]};
   return Response.json({quote:copy(quote),wallet:copy(wallet)});
  }
  if(p.action==='demo_book'){
   bookCalls++;assert.equal(p.quoteId,quote.id);assert(p.requestId);assert.equal(Object.keys(p).length,3,'only approved quote ID and request ID are submitted');await delay(15);
   if(quote.status!=='booked'){
    quote.status='booked';wallet.balanceMinor-=12000;
    wallet.bookings=[{...quote.items[0],id:'demo-detail-one',bookingId:canonicalId,checkinCode:'UNIT42',quoteId:quote.id,sourceType:'session',sourceId,status:'simulated_confirmed',canonicalStatus:'confirmed',paymentStatus:'virtual_paid',amountMinor:12000,reference:'DEMO-UNIT42'}];
    wallet.ledger=[{id:'debit-one',kind:'payment',amountMinor:-12000,bookingId:canonicalId}];
    h.cloud.bookings[alice.id].push({booking_id:canonicalId,session_id:'unbooked-session',traveler_id:alice.id,guest_name:'Alice',guests:3,channel:'app',status:'confirmed',unit_price_thb:200,checkin_code:'UNIT42',created_at:'2026-11-04T12:00:00Z',demo:true,source_type:'session',source_id:sourceId,stop_id:'unbooked-session',payment_status:'virtual_paid',amount_cny_minor:12000,unit_price_cny_minor:4000});
   }
   return Response.json({quote:copy(quote),bookings:copy(wallet.bookings),wallet:copy(wallet)});
  }
  assert.fail('Wallet cancellation must use canonical calendar service, not '+p.action);
 };
 w.fixtureRPC=async(name,args={})=>{
  const result=await baseRPC(name,args);
  if(name==='journeyhub_calendar_manage'&&args.p_action==='cancel'&&args.p_id===canonicalId&&!result.error){
   const b=wallet.bookings[0];if(b.canonicalStatus!=='cancelled'){refunds++;b.status=b.canonicalStatus='cancelled';b.paymentStatus='refunded';wallet.balanceMinor+=12000;wallet.ledger.unshift({id:'refund-one',kind:'refund',amountMinor:12000,bookingId:canonicalId});h.cloud.bookings[alice.id].find(b=>b.booking_id===canonicalId).payment_status='refunded';}
  }
  return result;
 };
 h.visit('orders');await until(()=>t.th.loaded&&t.cm.loaded&&!t.cm.loading,'saved calendar loads');
 t.A.destination('Shanghai');assert(!app().textContent.includes('Private virtual museum'),'Explore excludes generated private activities');h.visit('catalog');assert(!app().textContent.includes('Private virtual museum'));t.state.saved['private-demo']=true;h.visit('saved');assert(!app().textContent.includes('Private virtual museum'));assert(t.db.experiences['private-demo'],'private experience remains available for record resolution');h.visit('orders');
 t.A.ticket('ticket-cancelled');let sheet=app().querySelector('.ub-ticket');assert(sheet);assert(sheet.textContent.includes('Cancelled'));assert(!sheet.querySelector('.qr-wrap'));assert(!sheet.textContent.includes('CANCEL'),'cancelled code is not rendered');assert(!sheet.textContent.includes('Valid'));t.A.closeSheet();
 t.A.ticket('ticket-one');sheet=app().querySelector('.ub-ticket');assert(sheet.querySelector('.qr-wrap'));assert(sheet.textContent.includes('No payment taken'),'legacy unpaid booking must never look paid');t.A.closeSheet();
 t.A.calDate('2027-01-01');assert(app().textContent.includes('Shanghai craft session'));const showCraft=()=>{const card=[...app().querySelectorAll('.cv-open')].find(el=>el.getAttribute('aria-label').includes('Shanghai craft session'));assert(card,'calendar has a clickable craft visit');t.A.cvOpen(card.dataset.a,card.dataset.b);};showCraft();assert(app().querySelector('.cv-sheet [data-act="cvTicket"][data-a="ticket-one"]'),'day detail opens the canonical ticket');t.A.closeSheet();
 h.visit('reserved-trips');assert(app().querySelector('[data-act="cmAsk"][data-b="ticket-one"]'),'cancel is visible directly in the reservation library');assert(app().textContent.includes('ticket-cancelled'),'previously cancelled records are retained');
 app().querySelector('[data-act="cmAsk"][data-b="ticket-one"]').click();assert(app().querySelector('.cm-confirm'));await t.A.cmConfirm();assert(app().textContent.includes('ticket-one'));assert(app().textContent.includes('Ticket invalid · Seats released'));
 t.A.ubMyFilter('cancelled');assert(!app().querySelector('[data-act="cmAsk"][data-b="ticket-one"]')?.textContent.includes('Cancel reservation'),'cancelled record cannot be cancelled again');t.A.ubMyFilter('all');h.visit('orders');t.A.calDate('2027-01-01');assert(app().textContent.includes('Shanghai craft session'),'cancellation does not delete the itinerary activity');assert(app().textContent.includes('Cancelled'));
 t.A.ticket('ticket-one');assert(!app().querySelector('.qr-wrap'));t.A.closeSheet();
 h.cloud.bookings[alice.id].push({...copy(h.cloud.bookings[alice.id][0]),booking_id:'ticket-rebooked',status:'confirmed',checkin_code:'NEW123',created_at:'2026-11-04T13:00:00Z'});await t.jhRefresh();t.A.calDate('2027-01-01');showCraft();assert(app().querySelector('.cv-sheet [data-act="cvTicket"][data-a="ticket-rebooked"]'),'a new active booking wins over the older cancelled booking for the same session');assert(!app().querySelector('.cv-sheet [data-act="cvTicket"][data-a="ticket-one"]'));t.A.closeSheet();

 // Manual experience -> one exact quote -> explicit confirmation -> canonical ticket.
 t.state.expSel.craft={slot:'unbooked-session',guests:3};t.A.book('craft','unbooked-session');assert.equal(t.state.route,'demo-booking');assert.equal(bookCalls,0);
 await until(()=>app().querySelector('[data-act="dwBook"]'),'session quote renders');assert(app().textContent.includes('2027-01-05'));assert(app().textContent.includes('3 guests'));assert(app().textContent.includes('CNY 120.00'));assert.equal(bookCalls,0,'review is read-only');
 await Promise.all([t.A.dwBook(),t.A.dwBook()]);assert.equal(bookCalls,1,'double click sends one confirmation');assert.equal(wallet.balanceMinor,38000);assert.equal(t.db.bookings[canonicalId].paymentStatus,'virtual_paid');assert.equal(t.db.bookings[canonicalId].amountMinor,12000);assert(app().textContent.includes(canonicalId),'receipt returns the canonical ID');
 t.A.ticket(canonicalId);sheet=app().querySelector('.ub-ticket');assert(sheet.querySelector('.qr-wrap'));assert(sheet.textContent.includes('UNIT42'));assert(sheet.textContent.includes('CNY 120.00'));assert(sheet.textContent.includes('Virtual payment'));t.A.closeSheet();
 const before=calls.length;t.A.book('craft','unbooked-session');assert.equal(t.ui.sheet.type,'ticket','existing confirmed session opens its ticket instead of a second quote');assert.equal(calls.length,before);t.A.closeSheet();
 t.A.dwWallet();t.A.dwAskCancel('demo-detail-one');assert(app().querySelector('.cm-confirm'),'wallet uses the common cancellation confirmation');await t.A.cmConfirm();assert.equal(refunds,1);assert.equal(wallet.balanceMinor,50000);assert.equal(t.db.bookings[canonicalId].status,'cancelled');assert(app().textContent.includes('Virtual credits returned'));t.A.dwAskCancel('demo-detail-one');await t.A.cmConfirm();assert.equal(refunds,1);assert(!calls.some(p=>p.action==='demo_cancel'));
 t.A.ticket(canonicalId);sheet=app().querySelector('.ub-ticket');assert(!sheet.querySelector('.qr-wrap'));assert(!sheet.textContent.includes('UNIT42'));assert(sheet.textContent.includes('Virtual credits returned'));t.A.closeSheet();
 const reopened=await boot(alice,h.storage(),h.cloud);reopened.visit('reserved-trips');await until(()=>reopened.t.cm.loaded,'reservation settings survive reload');reopened.t.A.ubMyFilter('cancelled');assert(reopened.app().textContent.includes(canonicalId),'cancelled reservation reloads from the saved snapshot');assert(reopened.app().textContent.includes('3 guests'));assert(reopened.app().textContent.includes('2027-01-05'));reopened.t.A.ticket(canonicalId);assert(!reopened.app().querySelector('.qr-wrap'),'reload never reactivates a cancelled ticket');reopened.close();

 // Staff sees the same cancellation and payments across sessions, separate from orders.
 fixture.staff={id:'STAFF-UI',name:'Demo Manager',role:'duty_manager'};await t.jhRefresh();t.state.role='staff';t.go('s-today');assert(app().querySelector('[data-a="s-bookings"]'),'visible independent staff entry');
 app().querySelector('.tabbar [data-a="s-orders"]').click();assert(app().querySelector('.ub-staff-booking'),'Orders opens experiences by default');assert(app().textContent.includes(canonicalId));assert.equal(app().querySelector('.tabbar [aria-current="page"]').dataset.a,'s-orders');
 app().querySelector('[data-act="ubOrderSection"][data-a="products"]').click();assert(app().querySelector('[data-act="staffFilter"]'),'original product order filters remain usable');assert(!app().querySelector('.ub-staff-booking'));assert(app().textContent.includes('Product orders'));
 app().querySelector('[data-act="ubOrderSection"][data-a="experiences"]').click();assert(app().querySelector('.ub-staff-booking'));t.go('s-bookings');assert.equal(app().querySelector('.tabbar [aria-current="page"]').dataset.a,'s-orders');assert(app().textContent.includes('Experience Bookings'));assert(app().textContent.includes(canonicalId));assert(app().textContent.includes('No payment taken'));assert(app().querySelector('[data-act="ubOrderSection"][data-a="products"]'),'product orders remain separate');
 assert(app().textContent.includes('Private virtual museum'),'staff bookings keep private simulated records');t.go('s-session',{id:'private-demo-session'});assert(app().textContent.includes('Private virtual museum'),'private session roster remains reachable');t.go('s-plan');assert(!app().querySelector('option[value="private-staff-plan"]'),'private activities cannot be chosen for session publication');assert(app().querySelector('option[value="public-staff-plan"]'));t.state.insightsAct='all';t.go('s-insights');assert(app().querySelector('.sf-live').textContent.includes('Private virtual museum'),'private demo bookings contribute to live operations, not forecasts');t.go('s-compare');assert(!app().querySelector('.ctable').textContent.includes('Private virtual museum'),'historical comparison still uses original catalog');t.go('s-bookings');
 const search=app().querySelector('[data-in="ubBookingQuery"]');search.value=canonicalId;search.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(app().querySelectorAll('.ub-staff-booking').length,1);assert(app().querySelector('.ub-staff-booking').textContent.includes('Cancelled'));
 t.ui.codeText='UNIT42';await t.A.checkInCode();assert(t.ui.codeMsg.text.includes('cannot be checked in'));assert(!h.commands.some(c=>c.p_operation==='checkin'));
 fixture.staff=null;wallet={currency:'CNY',balanceMinor:0,ledger:[],bookings:[]};await h.switchUser(bob);h.visit('orders');await until(()=>t.th.loaded,'new user calendar');assert(!app().textContent.includes(canonicalId));t.A.ticket(canonicalId);assert(!app().querySelector('.ub-ticket'),'another account cannot open a cached ticket');assert.deepEqual(h.errors,[]);h.close();
 console.log('PASS: canonical ticket/payment state, cancelled credentials disabled, retained Calendar visits, exact manual budget review, single confirmation, wallet/common cancellation with refund, independent staff cross-session search, cancelled check-in guard, account isolation. All transports mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{fixture.staff=null;windows.forEach(w=>w.close());});
