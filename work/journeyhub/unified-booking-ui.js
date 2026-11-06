/* One canonical reservation across Calendar, tickets, the wallet and staff. */
function ubApplyMetadata(data){
  for(const e of Object.values(EXPS))if(e.details?.demo===true)e.details.browseOnly=true;
  for(const raw of data?.bookings||[]){
    const b=DBC.bookings[raw.booking_id];if(!b)continue;
    Object.assign(b,{demo:raw.demo===true,sourceType:raw.source_type||null,sourceId:raw.source_id||null,stopId:raw.stop_id||null,paymentStatus:raw.payment_status||'legacy_unpaid',amountMinor:Number.isSafeInteger(raw.amount_cny_minor)?raw.amount_cny_minor:null,unitMinor:Number.isSafeInteger(raw.unit_price_cny_minor)?raw.unit_price_cny_minor:null});
  }
}
const ubPreviousApply=jhApply;
jhApply=function(data,...args){const result=ubPreviousApply(data,...args);ubApplyMetadata(data);return result;};
ubApplyMetadata(jhLastSnapshot);
const ubPublicExperience=e=>!!e&&e.details?.demo!==true;
// Public browsing is a catalog projection. Private venue records remain available
// by ID to their tickets, Calendar, staff booking records and session rosters.
function ubPublicCatalog(draw,...args){
  const all=EXPS;EXPS=Object.fromEntries(Object.entries(all).filter(([,e])=>ubPublicExperience(e)));
  try{return draw(...args);}finally{EXPS=all;}
}
for(const route of ['home','catalog','city-map','saved']){
  const old=V[route];if(old)V[route]=(...args)=>ubPublicCatalog(old,...args);
}
for(const name of ['homeResults','jcResults']){
  const old=REGIONS[name];if(old)REGIONS[name]=(...args)=>ubPublicCatalog(old,...args);
}
const ubOldValidIDs=jpValidIDs;
jpValidIDs=(ids,city)=>ubOldValidIDs(ids,city).filter(id=>ubPublicExperience(EXPS[id]));
const ubOldStaffPlan=sfPlan;
sfPlan=function(){
  const all=DBC.sessionPlans;DBC.sessionPlans=Object.fromEntries(Object.entries(all||{}).filter(([,p])=>ubPublicExperience(EXPS[p.exp])));
  try{return ubOldStaffPlan();}finally{DBC.sessionPlans=all;}
};
const ubOldStaffValidate=sfValidate;
sfValidate=(p,options)=>p&&EXPS[p.exp]?.details?.demo===true?'Private demo activities cannot be published as public sessions.':ubOldStaffValidate(p,options);
const ubOldStaffPlanView=V['s-plan'];
V['s-plan']=()=>{
  const view=ubOldStaffPlanView(),template=document.createElement('template');template.innerHTML=view.body;
  for(const option of template.content.querySelectorAll('[data-ch="sfPlanSelect"] option'))if(!ubPublicExperience(EXPS[DBC.sessionPlans[option.value]?.exp]))option.remove();
  view.body=template.innerHTML;return view;
};
// The live panel includes demo reservations; historical comparisons and the
// original craft/silk/herbal forecast calculations are unchanged.
upcomingHtml=()=>sfLiveHTML(state.insightsAct==='all'?null:[state.insightsAct]);
const ubStatus=b=>b.status==='cancelled'?'Cancelled':b.status==='no_show'?'No-show':b.checkedIn?'Checked in':b.status==='confirmed'?'Reserved':'Pending';
function ubPayment(b){
  if(b.paymentStatus==='refunded')return 'Virtual credits returned';
  if(['virtual_paid','demo_paid','paid','simulated_paid'].includes(b.paymentStatus))return (b.amountMinor!==null?dwMoney(b.amountMinor)+' · ':'')+'Virtual payment';
  if(['not_required','free'].includes(b.paymentStatus))return 'No virtual charge';
  return 'No payment taken';
}
function ubOwnedBooking(id){const b=DBC.bookings[id];return b&&(me()||isMine(b))?b:null;}
function ubStopBooking(event,stop){
  return Object.values(DBC.bookings).filter(isMine).filter(b=>(b.sourceType===event.manageKind&&b.sourceId===event.manageId&&b.stopId===(stop.id||stop.sessionId))||(stop.sessionId&&b.slot===stop.sessionId)).sort((a,b)=>Number(b.status==='confirmed')-Number(a.status==='confirmed')||Number(b.createdAt||0)-Number(a.createdAt||0))[0];
}
function ubStopStatusHTML(event,stop){
  const b=ubStopBooking(event,stop);if(!b)return stop.sessionId?'<button class="dw-text" data-act="ubSession" data-a="'+esc(stop.sessionId)+'">Review & book '+ic('right',14)+'</button>':'';
  if(cmHidden('booking',b.id))return '<p class="cap">Reservation record hidden. <button class="dw-text" data-act="go" data-a="calendar-removed">View removed items</button></p>';
  return '<div class="dw-stop-status '+(b.status==='cancelled'?'is-cancelled':'is-reserved')+'"><strong>'+esc(ubStatus(b))+'</strong><span>'+esc(ubPayment(b))+'</span><small class="ub-booking-id">Booking '+esc(b.id)+'</small><button class="dw-text" data-act="ticket" data-a="'+esc(b.id)+'">'+(b.status==='cancelled'?'View cancelled record':'View ticket')+' '+ic('right',14)+'</button>'+cmActionButton('booking',b.id)+'</div>';
}

// Opening a session or review is read-only. Only the budget confirmation writes.
A.book=(experienceId,sessionId)=>{
  if(ui.busy||dw.busy)return;
  const session=DBC.sessions[sessionId];if(!session||session.exp!==experienceId){toast('This session is unavailable. Refresh and choose another date.');return;}
  if(needTraveler('Sign in to review your reservation.'))return;
  const existing=Object.values(DBC.bookings).find(b=>isMine(b)&&b.slot===sessionId&&b.status==='confirmed');
  if(existing){A.ticket(existing.id);return;}
  const guests=Math.max(1,Math.min(6,Number(state.expSel[experienceId]?.guests||state.planner.travelers||1)));
  dwScope();delete dw.quotes[dwKey('session',sessionId)];
  go('demo-booking',{sourceType:'session',sourceId:sessionId,guests});
};
A.ubSession=id=>{
  const session=DBC.sessions[id];if(!session){toast('This session is no longer available.');return;}
  const run=typeof agRun==='function'?agRun():null,plan=run?agPlan(run):null;
  const event=state.route==='orders'?calEvents().find(e=>e.stops.some(s=>s.sessionId===id)):null,history=event?.manageKind==='history'?th.items.find(h=>h.id===event.manageId):null;
  const guests=history?.input?.guests||plan?.stops?.find(s=>s.sessionId===id)?.guests||plan?.guests||state.planner.travelers||1;
  state.expSel[session.exp]={...(state.expSel[session.exp]||{}),slot:id,guests};
  go('exp',{id:session.exp});
};
const ubOldAgSession=A.agSession;
A.agSession=id=>DBC.sessions[id]?A.ubSession(id):ubOldAgSession(id);
A.agReview=()=>{const run=agRun();if(run&&!ag.busy)A.dwReview('run',run.id);};
A.agConfirm=A.agReview;
const ubOldReview=V['ai-review'];
V['ai-review']=()=>{const run=agRun();if(!run)return ubOldReview();return {bar:bar({title:'Review reservation budget'}),tabs:true,body:'<main class="dw-page"><h2>Review before booking</h2><p>Check the current sessions, group total and virtual wallet balance.</p><button class="btn btn-primary btn-block" data-act="agReview">Review budget</button></main>'};};
A.bookPlan=()=>{
  const run=agRun();if(run&&state.plan?.aiDraft?.agentRunId===run.id){A.agReview();return;}
  const plan=currentPlan(),stop=plan?.stops.find(s=>s.kind==='exp'&&!bookingFor(s.slot));
  if(!stop){toast('No unreserved sessions in this plan.');return;}
  state.expSel[stop.exp]={...(state.expSel[stop.exp]||{}),slot:stop.slot,guests:plan.T};
  toast('Review this saved session first. Other sessions remain unreserved.');
  A.book(stop.exp,stop.slot);
};

// A cancelled record remains readable, but cannot display a usable credential.
const ubPreviousTicket=A.ticket;
A.ticket=id=>{if(!ubOwnedBooking(id)){toast('This reservation is not available in your account.');return;}ubPreviousTicket(id);};
const ubPreviousSheet=sheetView;
sheetView=function(){
  if(ui.sheet?.type!=='ticket')return ubPreviousSheet();
  const b=ubOwnedBooking(ui.sheet.id),session=b&&DBC.sessions[b.slot],experience=b&&EXPS[b.exp];
  if(!b||!session||!experience)return '';
  const valid=b.status==='confirmed',credential=valid&&b.code;
  const status='<div class="ub-ticket-status '+(valid?'is-active':'is-cancelled')+'"><strong>'+esc(ubStatus(b))+'</strong><span>'+esc(ubPayment(b))+'</span></div>';
  const code=credential?'<div class="ub-ticket-code"><div class="qr-wrap">'+qrHtml(ticketPayload(b))+'</div><span>Check-in code</span><strong class="mono">'+esc(b.code)+'</strong></div>':'<p class="ub-ticket-inactive">'+(b.status==='cancelled'?'This reservation is cancelled. Its ticket cannot be used for check-in.':'There is no active check-in ticket for this reservation.')+'</p>';
  return '<div class="scrim" data-act="scrim"><section class="sheet ub-ticket" role="dialog" aria-modal="true" aria-label="Ticket"><span class="handle" aria-hidden="true"></span><div class="row-between"><h2>'+esc(experience.name)+'</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">'+ic('x',20)+'</button></div><p>'+esc([session.date,session.time,b.guests+' guest'+(b.guests===1?'':'s')].join(' · '))+'</p>'+status+code+'<p class="ub-booking-id">Booking '+esc(b.id)+'</p>'+(b.demo?'<p class="cap">Virtual credits only. This is not a venue-issued ticket.</p>':'')+(isMine(b)?cmActionButton('booking',b.id):'')+'<button class="btn btn-soft btn-block" data-act="closeSheet">Done</button></section></div>';
};

const ubCheckIn=A.checkIn;
A.checkIn=id=>{const b=DBC.bookings[id];if(!b||b.status!=='confirmed'){toast('Only an active reservation can be checked in.');return;}return ubCheckIn(id);};
const ubCheckInCode=A.checkInCode;
A.checkInCode=()=>{
  const raw=String(ui.codeText||'').trim().toUpperCase(),parts=raw.split('|'),code=parts.length>=3?parts[2]:raw;
  const b=bookingsList().find(row=>row.code===code&&(parts.length<3||row.id===parts[1]));
  if(b&&b.status!=='confirmed'){ui.codeMsg={ok:false,text:'This reservation is '+ubStatus(b).toLowerCase()+'. Its ticket cannot be checked in.'};render();return;}
  return ubCheckInCode();
};

// Agent summaries derive reservation/payment state from canonical records.
function ubRunBookings(run){return Object.values(DBC.bookings).filter(b=>isMine(b)&&(b.sourceType==='run'&&b.sourceId===run.id||(run.bookings||[]).some(row=>(row.id||row.bookingId)===b.id)));}
const ubOldRunNotice=agRunNotice;
agRunNotice=function(run){
  const rows=ubRunBookings(run);if(!rows.length)return ubOldRunNotice(run);
  const active=rows.filter(b=>b.status==='confirmed').length,cancelled=rows.filter(b=>b.status==='cancelled').length,paid=rows.some(b=>['virtual_paid','demo_paid','paid','simulated_paid'].includes(b.paymentStatus));
  return '<div class="ag-run-status"><div><strong>'+active+' reserved'+(cancelled?' · '+cancelled+' cancelled':'')+'</strong><p>'+(paid?'Virtual payments and tickets are saved in your account.':'No payment has been taken for these existing reservations.')+'</p></div></div>';
};
const ubOldTasks=V['ai-tasks'];
V['ai-tasks']=()=>{
  const view=ubOldTasks(),run=agRun();if(!run)return view;
  const template=document.createElement('template');template.innerHTML=view.body;
  for(const button of template.content.querySelectorAll('[data-act="ticket"]')){
    const b=DBC.bookings[button.dataset.a];if(!b)continue;
    const card=button.closest('.ix-task');if(!card)continue;
    const p=card.querySelector('.ix-task-main p');if(p)p.textContent=b.guests+' guests · '+ubStatus(b)+' · '+ubPayment(b);
    button.textContent=b.status==='cancelled'?'View cancelled record':'View ticket';
  }
  view.body=template.innerHTML;return view;
};
const ubOldHistoryList=agHistoryHTML;
agHistoryHTML=function(...args){
  const template=document.createElement('template');template.innerHTML=ubOldHistoryList(...args);
  for(const button of template.content.querySelectorAll('[data-act="agOpen"]')){
    const run=ag.runs.find(r=>r.id===button.dataset.a),rows=run&&ubRunBookings(run);if(!rows?.length)continue;
    const label=button.querySelector('.ag-badge');if(label)label.textContent=rows.some(b=>b.status==='confirmed')?'Reserved':'Cancelled';
  }
  return template.innerHTML;
};

// Separate experience reservations from merchandise orders across all sessions.
TAB_OF['s-bookings']='s-orders';
if(typeof snRoutes!=='undefined')snRoutes.add('s-bookings');
function ubStaffBookingRows(){
  const query=String(state.ubBookingQuery||'').trim().toLowerCase(),status=state.ubBookingFilter||'all',date=state.ubBookingDate||'';
  const rows=bookingsList().filter(b=>{const s=DBC.sessions[b.slot],e=EXPS[b.exp];return s&&e&&(status==='all'||(status==='checked_in'?b.checkedIn&&b.status==='confirmed':b.status===status))&&(!date||s.date===date)&&(!query||[b.id,b.name,e.name,e.city,s.date,s.time,b.sourceType,b.via].join(' ').toLowerCase().includes(query));}).sort((a,b)=>(DBC.sessions[b.slot]?.startsAt||'').localeCompare(DBC.sessions[a.slot]?.startsAt||'')||b.createdAt-a.createdAt);
  return rows.length?'<p class="cap">'+rows.length+' experience reservation'+(rows.length===1?'':'s')+'</p><div class="ub-staff-list">'+rows.map(b=>{const s=DBC.sessions[b.slot],e=EXPS[b.exp];return '<article class="ub-staff-booking"><div class="row-between"><h3>'+esc(e.name)+'</h3><span class="ub-state '+(b.status==='cancelled'?'cancelled':'')+'">'+esc(ubStatus(b))+'</span></div><p class="ub-booking-id">'+esc(b.id)+'</p><p>'+esc(s.date+' · '+s.time+' · '+b.guests+' guests')+'</p><p>'+esc(b.name)+' · '+esc(b.sourceType==='run'?'Agent':b.sourceType==='history'?'AI itinerary':b.via||'Manual')+(b.demo?' · Demo':'')+'</p><p class="cap">'+esc(ubPayment(b))+'</p><div class="ub-staff-actions"><button class="btn btn-soft btn-sm" data-act="ticket" data-a="'+esc(b.id)+'">View record</button><button class="btn btn-outline btn-sm" data-act="go" data-a="s-session" data-b="'+esc(s.id)+'">Session roster</button></div></article>';}).join('')+'</div>':'<div class="cal-empty"><h3>No matching reservations</h3><p>Try another Booking ID, activity, date or status.</p></div>';
}
REGIONS.ubBookings=ubStaffBookingRows;
INPUTS.ubBookingQuery=value=>{state.ubBookingQuery=value;updateRegion('ubBookings');};
CHANGES.ubBookingDate=el=>{state.ubBookingDate=el.value;render();};
A.ubBookingFilter=value=>{state.ubBookingFilter=value;render();};
A.ubBookingsRefresh=()=>jhAction(()=>jhRefresh(),'Experience bookings refreshed');
V['s-bookings']=()=>{
  if(!me())return {bar:bar({title:'Staff sign in'}),tabs:true,body:'<main class="content"><button class="btn btn-primary" data-act="staffEntry">Staff sign in</button></main>'};
  return {bar:staffBar('Experience Bookings','Live reservations · All sessions'),tabs:true,body:'<main class="content ub-staff-page"><div class="row-between"><p class="meta">Tickets and experience reservations</p><button class="icon-btn" data-act="ubBookingsRefresh" aria-label="Refresh bookings">'+ic('refresh',20)+'</button></div><label class="input">'+ic('search',18)+'<input type="search" data-in="ubBookingQuery" value="'+esc(state.ubBookingQuery||'')+'" placeholder="Booking ID, activity or guest" aria-label="Search experience bookings"></label><label class="field">Session date<input type="date" data-ch="ubBookingDate" value="'+esc(state.ubBookingDate||'')+'"></label><div class="ub-status-filters">'+[['all','All'],['confirmed','Reserved'],['checked_in','Checked in'],['cancelled','Cancelled'],['no_show','No-show']].map(([id,label])=>'<button data-act="ubBookingFilter" data-a="'+id+'" aria-pressed="'+((state.ubBookingFilter||'all')===id)+'">'+label+'</button>').join('')+'</div><section data-region="ubBookings">'+ubStaffBookingRows()+'</section><button class="link" data-act="tab" data-a="s-orders">Product orders '+ic('right',16)+'</button></main>'};
};
for(const route of ['s-today','s-sessions']){
  const oldView=V[route];V[route]=()=>{const view=oldView(),template=document.createElement('template');template.innerHTML=view.body;const content=template.content.querySelector('.content')||template.content.firstElementChild;content?.insertAdjacentHTML('afterbegin','<button class="ub-staff-entry" data-act="go" data-a="s-bookings">'+ic('ticket',21)+'<span><strong>Experience Bookings</strong><small>Booking ID, guests, dates & status</small></span>'+ic('right',18)+'</button>');view.body=template.innerHTML;return view;};
}

// Put experience reservations inside Orders, beside merchandise, so staff do
// not need to discover the separate session-management route first.
function ubOrderSections(section){
  return '<nav class="ub-order-sections" aria-label="Order type">'+[['experiences','Experience Bookings'],['products','Product orders']].map(([id,label])=>'<button data-act="ubOrderSection" data-a="'+id+'" aria-pressed="'+(section===id)+'">'+label+'</button>').join('')+'</nav>';
}
const ubProductOrdersView=V['s-orders'],ubExperienceOrdersView=V['s-bookings'];
function ubOrderPage(section,standalone=false){
  const view=section==='products'?ubProductOrdersView():ubExperienceOrdersView();
  if(!me())return view;
  const template=document.createElement('template');template.innerHTML=view.body;
  const content=template.content.querySelector('.content');
  content?.insertAdjacentHTML('afterbegin',ubOrderSections(section));
  if(section==='experiences'){
    content?.querySelector('button.link[data-a="s-orders"]')?.remove();
  }else{
    content?.insertAdjacentHTML('afterbegin','<div class="row-between"><h2 class="h3">Product orders</h2><button class="icon-btn" data-act="ubOrdersRefresh" aria-label="Refresh orders">'+ic('refresh',20)+'</button></div>');
  }
  view.body=template.innerHTML;
  view.bar=staffBar(standalone?'Experience Bookings':'Orders',section==='products'?'Merchandise and delivery':'Experience reservations · All sessions',{right:'<button class="icon-btn sn-account" data-act="staffMenu" aria-label="Staff account">'+ic('user',18)+'</button>'});
  return view;
}
V['s-orders']=()=>ubOrderPage(state.ubOrderSection==='products'?'products':'experiences');
V['s-bookings']=()=>ubOrderPage('experiences',true);
A.ubOrderSection=section=>{state.ubOrderSection=section==='products'?'products':'experiences';if(state.route==='s-orders')render();else go('s-orders');};
A.ubProductOrders=()=>A.ubOrderSection('products');
A.ubOrdersRefresh=()=>jhAction(()=>jhRefresh(),'Orders refreshed');
const ubOldStaffFilter=A.staffFilter;
A.staffFilter=value=>{state.ubOrderSection='products';return ubOldStaffFilter(value);};

// The reservation library includes cancelled records, unlike the old itinerary
// view which used myBookings() and silently omitted all cancellations.
const ubLegacyReservations=V['reserved-trips'];
TAB_OF['reservation-itineraries']='orders';
V['reservation-itineraries']=()=>{const view=ubLegacyReservations(),t=document.createElement('template');t.innerHTML=view.body;t.content.querySelector('.ix-note')?.remove();view.body=t.innerHTML;return view;};
A.calOpenLegacy=()=>go('reservation-itineraries');
A.ubMyFilter=value=>{state.ubMyFilter=value;render();};
A.ubReservationsRefresh=()=>jhAction(async()=>{await jhRefresh();await cmLoad(true);},'Reservations refreshed');
V['reserved-trips']=()=>{
  if(!traveler())return {bar:bar({title:'Your reservations',back:true}),tabs:true,body:'<main class="content"><p>Sign in to see your reservations.</p><button class="btn btn-primary" data-act="calSignIn">Sign in</button></main>'};
  const filter=state.ubMyFilter||'all',mine=bookingsList().filter(isMine),visible=mine.filter(b=>!cmHidden('booking',b.id)),rows=visible.filter(b=>filter==='all'||(filter==='cancelled'?b.status==='cancelled':b.status==='confirmed')).sort((a,b)=>b.createdAt-a.createdAt);
  return {bar:bar({title:'Your reservations',back:true,right:'<button class="icon-btn" data-act="ubReservationsRefresh" aria-label="Refresh reservations">'+ic('refresh',20)+'</button>'}),tabs:true,body:'<main class="content ub-staff-page"><div class="ub-status-filters" role="group" aria-label="Reservation status">'+[['all','All'],['confirmed','Reserved'],['cancelled','Cancelled']].map(([id,label])=>'<button data-act="ubMyFilter" data-a="'+id+'" aria-pressed="'+(filter===id)+'">'+label+'</button>').join('')+'</div>'+(cm.error?'<div class="cal-error" role="alert">'+esc(cm.error)+' <button data-act="ubReservationsRefresh">Retry</button></div>':'')+'<div class="ub-staff-list">'+(rows.length?rows.map(b=>{
    const s=DBC.sessions[b.slot],e=EXPS[b.exp];
    return '<article class="ub-staff-booking ub-traveler-booking"><div class="row-between"><h3>'+esc(e?.name||'Experience reservation')+'</h3><span class="ub-state '+(b.status==='cancelled'?'cancelled':'')+'">'+esc(ubStatus(b))+'</span></div><p>'+esc(s?[s.date,s.time].join(' · '):'Session details unavailable')+'</p><p>'+b.guests+' guest'+(b.guests===1?'':'s')+' · '+esc(ubPayment(b))+'</p><p class="ub-booking-id">Booking '+esc(b.id)+'</p>'+(b.status==='cancelled'?'<p class="ub-invalid-note">Ticket invalid · Seats released</p>':'')+'<div class="ub-staff-actions"><button class="btn btn-soft btn-sm" data-act="ticket" data-a="'+esc(b.id)+'">'+(b.status==='cancelled'?'View cancelled record':'View ticket')+'</button>'+cmActionButton('booking',b.id)+'</div></article>';
  }).join(''):'<div class="cal-empty"><h3>No '+(filter==='cancelled'?'cancelled ':filter==='confirmed'?'active ':'')+'reservations</h3><p>Your confirmed experience bookings will appear here.</p></div>')+'</div><nav class="ub-reservation-links"><button class="link" data-act="go" data-a="reservation-itineraries">Saved itineraries '+ic('right',16)+'</button><button class="link" data-act="go" data-a="calendar-removed">Removed records '+ic('right',16)+'</button></nav></main>'};
};
