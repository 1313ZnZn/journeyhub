/* Demo credits and reservations are account-owned server records, never real money. */
const dwFresh=owner=>({owner,wallet:null,loaded:false,loading:false,busy:false,error:'',version:0,quotes:{},cancel:null});
let dw=dwFresh(jhUser?.id||null);
const dwCurrent=ctx=>dw===ctx&&ctx.owner===(jhUser?.id||null);
function dwScope(){const owner=jhUser?.id||null;if(dw.owner!==owner)dw=dwFresh(owner);}
const dwMoney=minor=>'CNY '+new Intl.NumberFormat('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}).format((Number(minor)||0)/100);
const dwKey=(type,id)=>type+':'+id;
const dwSource=(type,id)=>['history','run','session'].includes(type)&&typeof id==='string'&&id?{sourceType:type,sourceId:id}:null;
const dwPaid=booking=>booking.canonicalStatus?booking.canonicalStatus==='confirmed':booking.status==='simulated_confirmed';
const dwKinds={ticket:'Demo ticket',restaurant:'Demo table deposit',cafe:'Demo café credit',free:'No demo charge',unavailable:'Not simulated'};
const dwBookings=(type,id)=>(dw.wallet?.bookings.filter(b=>b.sourceType===type&&(type==='session'?b.sessionId===id:b.sourceId===id))||[]).sort((a,b)=>Number(dwPaid(b))-Number(dwPaid(a))||(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
const dwBookingLabel=b=>(b.canonicalStatus||b.status)==='cancelled'?'Cancelled'+(b.paymentStatus==='refunded'?' · Credits returned':''):dwPaid(b)?b.kind==='restaurant'?'Table reserved':b.kind==='cafe'?'Café reserved':'Ticket reserved':b.status==='not_required'?'No wallet charge · Check venue requirements':'Not simulated · Check with venue';
function dwErrorText(error){
  const codes={DEMO_INSUFFICIENT_FUNDS:'Add demo credits to cover this plan, then confirm again.',DEMO_QUOTE_STALE:'The itinerary changed. Refresh the demo estimate before confirming.',DEMO_QUOTE_EXPIRED:'This demo estimate expired. Refresh it before confirming.',DEMO_TRIP_PASSED:'Some visits have already started. Choose a future itinerary for the demo.',DEMO_NOT_READY:'The places could not be classified for the demo. Refresh the estimate or check with the venues.',DEMO_PLAN_REMOVED:'This plan was removed. Restore it before starting the demo.',DEMO_ALREADY_BOOKED:'This plan already has demo reservations. Refresh to see them.'};
  const conflicts={DEMO_SESSION_UNAVAILABLE:'A session is no longer available. No part of this plan was booked or charged. Refresh the estimate.',DEMO_SEATS_UNAVAILABLE:'There are not enough seats. No part of this plan was booked or charged. Refresh the estimate or reduce your group.',DEMO_ALREADY_RESERVED:'You already have a reservation for a session in this plan. Refresh to review it.',DEMO_SESSION_MISMATCH:'A session changed. Refresh the estimate before confirming.'};
  Object.assign(conflicts,{CAPACITY_CHANGED:conflicts.DEMO_SEATS_UNAVAILABLE,SESSION_CHANGED:conflicts.DEMO_SESSION_UNAVAILABLE,PRICE_CHANGED:'The price changed. No part of this plan was booked or charged. Refresh the estimate.'});
  return codes[error?.code]||conflicts[error?.code]||agErrorText(error);
}
async function dwRequest(payload,ctx){
  const {data,error}=await sb.auth.getSession();if(error)throw error;
  if(!dwCurrent(ctx)||!data.session||data.session.user.id!==ctx.owner)throw Error('Sign in to use your demo wallet.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  try{
    const response=await fetch(jhConfig.url+'/functions/v1/journeyhub-agent',{method:'POST',headers:{'Content-Type':'application/json',apikey:jhConfig.publishableKey,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(payload),signal:controller.signal});
    const body=await response.json();if(!response.ok){const failure=Error(body?.error?.message||'The demo could not update. Please retry.');failure.code=body?.error?.code;throw failure;}if(dwCurrent(ctx)&&['demo_book','demo_cancel','demo_topup'].includes(payload.action)&&typeof jhInvalidateSnapshot==='function')jhInvalidateSnapshot();return body;
  }finally{clearTimeout(timer);}
}
function dwStore(ctx,result){
  const wallet=result?.wallet;
  if(!wallet||wallet.currency!=='CNY'||!Number.isSafeInteger(wallet.balanceMinor)||wallet.balanceMinor<0||!Array.isArray(wallet.ledger)||!Array.isArray(wallet.bookings))throw Error('Your demo wallet could not load. Please retry.');
  ctx.wallet=wallet;ctx.loaded=true;
}
const dwQuietRender=()=>{if(typeof tcEditing!=='function'||!tcEditing())render();};
async function dwLoad(force=false){
  dwScope();const ctx=dw;if(!ctx.owner||ctx.loading||ctx.busy||(!force&&ctx.loaded))return;
  ctx.loading=true;ctx.error='';const version=++ctx.version,loadToken={};ctx.loadToken=loadToken;
  try{const result=await dwRequest({action:'demo_state'},ctx);if(!dwCurrent(ctx)||ctx.version!==version)return;dwStore(ctx,result);}
  catch(error){if(dwCurrent(ctx)&&ctx.version===version)ctx.error=dwErrorText(error);}
  finally{if(dwCurrent(ctx)&&ctx.loadToken===loadToken){ctx.loading=false;dwQuietRender();}}
}
function dwRequestId(ctx,operation,receipt){
  const key='journeyhub-demo-pending:'+ctx.owner+':'+operation+':'+receipt;let id;
  try{id=sessionStorage.getItem(key);}catch{}
  if(!/^[a-f\d-]{36}$/i.test(id||'')){id=crypto.randomUUID();try{sessionStorage.setItem(key,id);}catch{}}
  return {id,clear(){try{sessionStorage.removeItem(key);}catch{}}};
}
function dwStopName(type,id,stopId){
  const candidates=[];
  if(type==='history'&&pd.owner===dw.owner&&pd.historyId===id)candidates.push(...(pd.plan?.stops||[]),...(pd.places||[]));
  if(type==='history'&&typeof cal!=='undefined'&&cal.owner===dw.owner)candidates.push(...(cal.details[id]?.plan?.stops||[]));
  if(type==='run'&&ag.owner===dw.owner)candidates.push(...(agPlan(ag.runs.find(r=>r.id===id))?.stops||[]));
  if(typeof tc!=='undefined'&&tc.owner===dw.owner)candidates.push(...(tc.trips.find(t=>t.sourceType===type&&t.sourceId===id)?.stops||[]));
  const item=candidates.find(s=>(s.id||s.sessionId)===stopId),name=item?.name||item?.title;
  return name&&typeof calReadableName==='function'&&calReadableName(name)?name:name&&!/\p{Script=Han}/u.test(name)&&!/^Stop \d+$/i.test(name)?name:'';
}
function dwItemName(item,source){return dwStopName(source.sourceType,source.sourceId,item.stopId)||item.title||item.name||((dwKinds[item.kind]||'Demo visit')+' · Day '+(item.dayIndex||1)+(item.start?' · '+item.start:''));}
function dwQuoteBookings(source,record){
  const quote=record?.quote,rows=[...(record?.receipts||[]),...dwBookings(source.sourceType,source.sourceId)];
  for(const item of quote?.items||[]){
    if(!item.bookingId||rows.some(b=>b.bookingId===item.bookingId))continue;
    const b=typeof DBC!=='undefined'?DBC.bookings[item.bookingId]:null;if(!b)continue;
    rows.push({...item,id:b.id,bookingId:b.id,checkinCode:b.status==='confirmed'?b.code:null,quoteId:quote.id,sourceType:quote.sourceType,sourceId:quote.sourceId,canonicalStatus:b.status,status:b.status==='cancelled'?'cancelled':'simulated_confirmed',paymentStatus:b.paymentStatus||'legacy_unpaid',amountMinor:b.amountMinor??0});
  }
  const seen=new Set();return rows.filter(b=>{const key=b.bookingId||b.id;if(seen.has(key))return false;seen.add(key);return true;});
}
function dwErrorHTML(message,action='dwRefresh'){return message?'<div class="dw-error" role="alert">'+esc(message)+'<button data-act="'+action+'">Retry</button></div>':'';}
function dwInviteHTML(type,id){
  const source=dwSource(type,id);if(!source)return '';
  const items=dwBookings(type,id),paid=items.filter(dwPaid),completed=items.length>0;
  return '<section class="dw-agent-invite" aria-label="Demo booking agent"><div><span class="dw-agent-icon">'+ic('sparkle',20)+'</span><span><strong>Demo booking agent</strong><small>'+(completed?paid.length+' simulated reservation'+(paid.length===1?'':'s'):'Tickets, tables & a clear budget')+'</small></span><span class="dw-demo-badge">Demo</span></div><button class="btn btn-soft btn-block" data-act="dwReview" data-a="'+type+'" data-b="'+esc(id)+'">'+(completed?'View demo reservations':'Review demo booking')+' '+ic('right',16)+'</button><p>Virtual credits only. No real tickets or table bookings.</p></section>';
}
function dwStopHTML(event,stop){
  dwScope();if(!dw.owner||!event?.manageKind||!event.manageId||event.sample)return '';
  const booking=dwBookings(event.manageKind,event.manageId).find(b=>b.stopId===(stop.id||stop.sessionId));
  if(!booking)return typeof ubStopStatusHTML==='function'?ubStopStatusHTML(event,stop):'';
  const changed=dwPaid(booking)&&((booking.date&&event.date&&booking.date!==event.date)||(booking.start&&(stop.start||stop.time)&&booking.start!==(stop.start||stop.time))||(booking.end&&stop.end&&booking.end!==stop.end));
  return '<div class="dw-stop-status '+(dwPaid(booking)?'is-reserved':booking.status==='cancelled'?'is-cancelled':'')+'"><strong>'+esc(changed?'Schedule changed · Review reservation':dwBookingLabel(booking))+'</strong>'+(changed?'<span>Reserved for '+esc(booking.date)+' · '+esc(booking.start)+'–'+esc(booking.end)+'. It has not moved automatically.</span>':'')+(dwPaid(booking)?'<span>'+dwMoney(booking.amountMinor)+' in virtual credits'+(booking.reference?' · '+esc(booking.reference):'')+'</span>':'')+'</div>';
}
function dwDayHTML(event){
  dwScope();if(!dw.owner||!event?.manageKind||!event.manageId||event.sample)return '';
  const stops=event.stops||[],items=dwBookings(event.manageKind,event.manageId).filter(b=>b.date===event.date||stops.some(s=>(s.id||s.sessionId)===b.stopId)),paid=items.filter(dwPaid),missing=items.filter(b=>b.status==='unavailable');
  const changed=paid.filter(b=>{const s=stops.find(s=>(s.id||s.sessionId)===b.stopId);return s&&(b.date!==event.date||b.start!==(s.start||s.time)||b.end!==s.end);}).length;
  return '<div class="dw-day-agent"><div><strong>'+ic('sparkle',16)+' Booking agent</strong><span>'+(items.length?(paid.length-changed)+' saved simulated reservations'+(changed?' · '+changed+' schedule review':'')+(missing.length?' · '+missing.length+' venue checks':''):'Review tickets & tables')+'</span></div><button data-act="dwReview" data-a="'+esc(event.manageKind)+'" data-b="'+esc(event.manageId)+'">'+(items.length?'Details':'Review')+' '+ic('right',14)+'</button></div>';
}
A.dwWallet=()=>{dwScope();if(!dw.owner){openLogin('traveler',{route:'demo-wallet'});return;}go('demo-wallet');};
A.dwRefresh=()=>dwLoad(true);
A.dwReview=(type,id)=>{dwScope();const source=dwSource(type,id);if(!source)return;if(!dw.owner){openLogin('traveler',{route:'demo-booking',params:source});return;}go('demo-booking',source);};
A.dwRefreshQuote=()=>{const source=dwSource(state.params?.sourceType,state.params?.sourceId);if(source)void dwQuote(source,true);};
async function dwQuote(source,force=false){
  const ctx=dw,key=dwKey(source.sourceType,source.sourceId),old=ctx.quotes[key];
  if(!ctx.owner||ctx.busy||old?.loading||(!force&&old))return;
  const record={loading:true,error:'',quote:null},walletVersion=ctx.version,guests=Number(state.params?.guests);ctx.quotes[key]=record;render();
  try{const payload=source.sourceType==='session'?{action:'demo_session_quote',sessionId:source.sourceId,guests}:{action:'demo_quote',...(source.sourceType==='history'?{historyId:source.sourceId}:{runId:source.sourceId})};const result=await dwRequest(payload,ctx);if(!dwCurrent(ctx)||ctx.quotes[key]!==record)return;
    const quote=result.quote;if(!quote||quote.sourceType!==source.sourceType||(source.sourceType==='session'?quote.sessionId!==source.sourceId||Number(quote.guests)!==guests:quote.sourceId!==source.sourceId)||!Array.isArray(quote.items)||!quote.items.length||!Number.isSafeInteger(quote.totalMinor)||quote.totalMinor<0||quote.currency!=='CNY'||!quote.id)throw Error('The demo estimate is incomplete. Please retry.');
    if(ctx.version===walletVersion)dwStore(ctx,result);record.quote=quote;
  }catch(error){if(dwCurrent(ctx)&&ctx.quotes[key]===record)record.error=dwErrorText(error);}
  finally{if(dwCurrent(ctx)&&ctx.quotes[key]===record){record.loading=false;dwQuietRender();}}
}
A.dwTopup=async amount=>{
  dwScope();const ctx=dw,amountMinor=Number(amount);if(!ctx.owner||ctx.busy||![10000,50000,100000].includes(amountMinor))return;
  const request=dwRequestId(ctx,'topup',String(amountMinor));ctx.busy=true;ctx.error='';ctx.version++;render();
  try{const result=await dwRequest({action:'demo_topup',amountMinor,requestId:request.id},ctx);if(!dwCurrent(ctx))return;dwStore(ctx,result);request.clear();toast(dwMoney(amountMinor)+' demo credits added');}
  catch(error){if(dwCurrent(ctx))ctx.error=dwErrorText(error);}
  finally{if(dwCurrent(ctx)){ctx.busy=false;render();}}
};
// The booking page passes nothing (its route says which trip); Pip passes the trip itself.
A.dwBook=async(type,id)=>{
  dwScope();const ctx=dw,source=type&&id?dwSource(type,id):dwSource(state.params?.sourceType,state.params?.sourceId);if(!ctx.owner||ctx.busy||!source)return;
  const record=ctx.quotes[dwKey(source.sourceType,source.sourceId)],quote=record?.quote;
  if(!quote||record.loading||quote.status==='booked'||quote.items.every(i=>i.kind==='unavailable')||quote.totalMinor>(ctx.wallet?.balanceMinor??-1))return;
  const request=dwRequestId(ctx,'book',quote.id);ctx.busy=true;record.error='';record.errorCode='';ctx.version++;render();
  try{const result=await dwRequest({action:'demo_book',quoteId:quote.id,requestId:request.id},ctx);if(!dwCurrent(ctx))return;
    const saved=result.quote,receipts=result.bookings;
    const complete=Array.isArray(receipts)&&quote.items.every(item=>receipts.some(b=>(item.bookingId?b.bookingId===item.bookingId:b.quoteId===quote.id&&b.sourceType===quote.sourceType&&b.sourceId===quote.sourceId&&b.stopId===item.stopId)&&['simulated_confirmed','not_required','unavailable','cancelled'].includes(b.status)&&(!b.bookingId||b.canonicalStatus==='cancelled'||b.status==='cancelled'||(typeof b.checkinCode==='string'&&b.checkinCode.length>0))));
    if(saved?.id!==quote.id||saved?.status!=='booked'||saved.sourceType!==quote.sourceType||saved.sourceId!==quote.sourceId||!complete)throw Error('The demo confirmation is incomplete. Refresh the estimate to check your saved records before retrying.');
    dwStore(ctx,result);record.quote=saved;record.receipts=receipts;
    request.clear();if(result.trip&&typeof tcStore==='function')tcStore(tc,result.trip);else if(typeof tcLoad==='function')void tcLoad(true);
    // The receipt is authoritative. A later catalogue refresh must not turn a
    // successful debit into a payment error or encourage a second payment.
    if(typeof jhRefresh==='function')try{await jhRefresh();}catch{if(dwCurrent(ctx))toast('Reservations saved. Refresh Calendar to update the display.');}
    if(source.sourceType==='run'&&typeof agLoadRun==='function')void agLoadRun(source.sourceId,{quiet:true});
    toast('Demo reservations saved. No real payment made.');
  }catch(error){if(dwCurrent(ctx)){record.error=dwErrorText(error);record.errorCode=error.code;}}
  finally{if(dwCurrent(ctx)){ctx.busy=false;render();if(record.errorCode==='DEMO_INSUFFICIENT_FUNDS')void dwLoad(true);}}
};
A.dwCalendar=()=>{const source=dwSource(state.params?.sourceType,state.params?.sourceId),quote=source?dw.quotes[dwKey(source.sourceType,source.sourceId)]?.quote:null;go('orders');const date=quote?.items?.[0]?.date;if(date&&typeof calSelect==='function')calSelect(date);};
A.dwAskCancel=id=>{dwScope();if(dw.busy)return;const booking=dw.wallet?.bookings.find(b=>b.id===id&&dwPaid(b));if(!booking){if(typeof DBC!=='undefined'&&DBC.bookings[id]?.status==='confirmed'&&typeof A.cmAsk==='function')A.cmAsk('booking',id);return;}if(booking.bookingId&&typeof A.cmAsk==='function'){A.cmAsk('booking',booking.bookingId);return;}dw.cancel=id;render();};
A.dwKeep=()=>{if(dw.busy)return;dw.cancel=null;render();};
A.dwCancel=async id=>{
  const ctx=dw,booking=ctx.wallet?.bookings.find(b=>b.id===id&&dwPaid(b));if(!ctx.owner||ctx.busy||ctx.cancel!==id||!booking)return;
  const request=dwRequestId(ctx,'cancel',id);ctx.busy=true;ctx.error='';ctx.version++;render();
  try{const result=await dwRequest({action:'demo_cancel',bookingId:id,requestId:request.id},ctx);if(!dwCurrent(ctx))return;dwStore(ctx,result);ctx.cancel=null;request.clear();toast('Demo cancelled. Virtual credits returned.');}
  catch(error){if(dwCurrent(ctx))ctx.error=dwErrorText(error);}
  finally{if(dwCurrent(ctx)){ctx.busy=false;render();}}
};
function dwBookingRows(bookings){return bookings.map(b=>{
  const canonical=typeof DBC!=='undefined'&&b.bookingId?DBC.bookings[b.bookingId]:null,current=canonical?{...b,canonicalStatus:canonical.status,paymentStatus:canonical.paymentStatus||b.paymentStatus}:b;
  const unpaid=['legacy_unpaid','unpaid','not_charged'].includes(current.paymentStatus),cancelled=(current.canonicalStatus||current.status)==='cancelled';
  const payment=unpaid?'No virtual payment taken':current.paymentStatus==='refunded'?'Virtual credits returned':current.amountMinor===0?'No virtual charge':dwPaid(current)?dwMoney(current.amountMinor)+' virtual credits paid':'';
  const ticket=current.bookingId?'<button class="dw-text" data-act="ticket" data-a="'+esc(current.bookingId)+'">'+(cancelled?'View cancelled record':'View demo ticket')+' '+ic('right',14)+'</button>':'';
  return '<article class="dw-reservation"><div class="dw-reservation-head"><strong>'+esc(dwItemName(current,current))+'</strong><span class="dw-demo-badge">Demo</span></div><span class="dw-reservation-state">'+esc(dwBookingLabel(current))+'</span><small>'+esc([current.date,current.start&&current.start+'–'+current.end,current.quantity&&current.quantity+' guest'+(current.quantity===1?'':'s')].filter(Boolean).join(' · '))+'</small>'+(current.bookingId?'<small class="ub-booking-id">Booking '+esc(current.bookingId)+'</small>':'')+(payment?'<div class="dw-reservation-total"><b>'+esc(payment)+'</b><span>'+esc(current.reference||'')+'</span></div>':'')+ticket+(dwPaid(current)?dw.cancel===current.id?'<div class="dw-cancel-confirm"><p>Cancel this demo reservation and return '+dwMoney(current.amountMinor)+' virtual credits?</p><div><button data-act="dwKeep"'+(dw.busy?' disabled':'')+'>Keep</button><button data-act="dwCancel" data-a="'+esc(current.id)+'"'+(dw.busy?' disabled':'')+'>Cancel demo & return credits</button></div></div>':'<button class="dw-text" data-act="dwAskCancel" data-a="'+esc(current.id)+'"'+(dw.busy?' disabled':'')+'>Cancel demo reservation</button>':'')+'</article>';
}).join('');}
function dwLedgerRows(rows){return rows.map(entry=>{const amount=Number(entry.amountMinor)||0,kind=entry.kind||entry.type,label={topup:'Demo credits added',top_up:'Demo credits added',debit:'Demo reservation payment',payment:'Demo reservation payment',refund:'Demo credits returned',reset:'Account reset · virtual credits cleared'}[kind]||'Demo wallet update',debit=['debit','payment'].includes(kind)||amount<0;return '<li><span><strong>'+label+'</strong><small>'+esc(entry.createdAt?new Date(entry.createdAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'')+'</small></span><b class="'+(debit?'debit':'credit')+'">'+(debit?'−':'+')+dwMoney(Math.abs(amount))+'</b></li>';}).join('');}
TAB_OF['demo-wallet']='me';TAB_OF['demo-booking']='orders';
V['demo-wallet']=()=>{
  dwScope();const ctx=dw,header=bar({title:'Demo wallet',right:'<button class="icon-btn" data-act="dwRefresh" aria-label="Refresh demo wallet"'+(ctx.loading||ctx.busy?' disabled':'')+'>'+ic('refresh',20)+'</button>'});
  if(!ctx.owner)return {bar:header,tabs:true,body:'<main class="dw-page"><h2>Your travel demo wallet</h2><p>Sign in to save virtual credits and demo reservations.</p><button class="btn btn-primary" data-act="dwWallet">Sign in</button></main>'};
  const wallet=ctx.wallet;
  return {bar:header,tabs:true,body:'<main class="dw-page"><section class="dw-balance"><span class="dw-demo-badge">Demo · Virtual credits</span><p>Available balance</p><h2>'+(wallet?dwMoney(wallet.balanceMinor):'—')+'</h2><small>No real money. No cash value.</small></section>'+dwErrorHTML(ctx.error)+(ctx.loading?'<p class="dw-working" role="status">Loading your demo wallet…</p>':'')+'<section class="dw-topup"><h3>Add demo credits</h3><div>'+[10000,50000,100000].map(n=>'<button data-act="dwTopup" data-a="'+n+'"'+(!wallet||ctx.busy?' disabled':'')+'>+ '+dwMoney(n)+'</button>').join('')+'</div><p>Free simulated top-up. No payment account is connected.</p></section>'+(ctx.busy?'<p class="dw-working" role="status">Updating demo records…</p>':'')+'<section class="dw-wallet-bookings"><h3>Demo reservations</h3>'+(wallet?.bookings.length?dwBookingRows(wallet.bookings):'<p class="dw-muted">Confirm an itinerary to start the demo booking agent.</p>')+'</section><section class="dw-transactions"><h3>Credit history</h3>'+(wallet?.ledger.length?'<ol>'+dwLedgerRows(wallet.ledger)+'</ol>':'<p class="dw-muted">Your top-ups, payments and returns will appear here.</p>')+'</section></main>',after:()=>{if(dwCurrent(ctx)&&!ctx.loaded&&!ctx.loading&&!ctx.error)void dwLoad();}};
};
V['demo-booking']=()=>{
  dwScope();const ctx=dw,source=dwSource(state.params?.sourceType,state.params?.sourceId),header=bar({title:'Booking agent',right:'<button class="dw-wallet-link" data-act="dwWallet">Wallet '+ic('right',16)+'</button>'});
  if(!source||!ctx.owner)return {bar:header,tabs:true,body:'<main class="dw-page"><p>Open a saved itinerary to review its demo bookings.</p><button class="btn btn-primary" data-act="go" data-a="orders">Open Calendar</button></main>'};
  const record=ctx.quotes[dwKey(source.sourceType,source.sourceId)],quote=record?.quote,bookings=dwQuoteBookings(source,record),paid=bookings.filter(dwPaid),insufficient=quote&&quote.totalMinor>(ctx.wallet?.balanceMinor??0),booked=quote?.status==='booked';
  let body='<div class="dw-booking-intro"><span class="dw-demo-badge">Demo agent</span><h2>'+(booked?'Your demo bookings':'Ready for your trip?')+'</h2><p>Simulated reservations and virtual credits. No real tickets, tables or payments.</p></div>';
  if(!record||record.loading)body+='<div class="dw-working" role="status">Preparing your demo budget…</div>';
  if(record?.error)body+=dwErrorHTML(record.error,'dwRefreshQuote');
  if(quote){
    const tickets=quote.items.filter(i=>i.kind==='ticket').length,tables=quote.items.filter(i=>i.kind==='restaurant').length,cafes=quote.items.filter(i=>i.kind==='cafe').length,unknown=quote.items.filter(i=>i.kind==='unavailable').length;
    body+='<section class="dw-quote-summary"><div><span>'+[tickets&&tickets+' ticket'+(tickets===1?'':'s'),tables&&tables+' table'+(tables===1?'':'s'),cafes&&cafes+' café stop'+(cafes===1?'':'s'),unknown&&unknown<quote.items.length&&unknown+' skipped'].filter(Boolean).join(' · ')+'</span><strong>'+dwMoney(quote.totalMinor)+'</strong></div><small>'+(booked?paid.length+' demo reservation'+(paid.length===1?'':'s')+' confirmed':'Demo total for your group')+'</small></section>';
    if(booked){body+='<p class="dw-success" role="status">'+ic('check',18)+' Saved to your Calendar and demo wallet.</p>'+dwBookingRows(bookings)+'<button class="btn btn-primary btn-block" data-act="dwCalendar">View in Calendar</button>';}
    else{
      const notReady=quote.items.every(item=>item.kind==='unavailable');
      body+='<ol class="dw-quote-items">'+quote.items.map(item=>'<li><span><strong>'+esc(dwItemName(item,source))+'</strong><small>'+esc([item.date,item.start&&item.start+(item.end?'–'+item.end:''),item.quantity&&item.quantity+' guests'].filter(Boolean).join(' · '))+'</small><small>'+esc(item.bookingId?'Existing reservation · No new charge':dwKinds[item.kind]||'Demo visit')+(!item.bookingId&&item.quantity&&item.kind!=='free'&&item.kind!=='unavailable'?' · '+item.quantity+' × '+dwMoney(item.unitMinor):'')+'</small>'+(Number.isFinite(item.availableSeats)&&!item.bookingId?'<small>'+item.availableSeats+' seats available</small>':'')+'</span><b>'+(item.bookingId?'Reserved':item.kind==='unavailable'?'Check venue':item.kind==='free'?'No demo charge':dwMoney(item.totalMinor))+'</b></li>').join('')+'</ol>';
      body+='<p class="dw-price-note">Illustrative demo prices, not venue quotes. Table amounts are simulated deposits.'+(quote.items.some(item=>item.sessionId)?' Catalog prices use the fixed demo conversion shown in this estimate.':'')+'</p><div class="dw-available"><span>Demo wallet balance</span><b>'+(ctx.wallet?dwMoney(ctx.wallet.balanceMinor):'—')+'</b></div>';
      if(insufficient&&ctx.wallet)body+='<div class="dw-funds"><strong>Add '+dwMoney(quote.totalMinor-ctx.wallet.balanceMinor)+' demo credits to continue.</strong><button class="btn btn-soft btn-block" data-act="dwWallet">Add demo credits</button></div>';
      if(!ctx.wallet)body+='<p class="dw-working" role="status">Checking your wallet balance…</p>';
      if(unknown&&!notReady){const skipped=quote.items.filter(item=>item.kind==='unavailable'),one=skipped.length===1;body+='<p class="dw-skip-note" role="status"><strong>'+skipped.length+' stop'+(one?'':'s')+' will be skipped</strong>'+esc(skipped.map(item=>dwItemName(item,source)).join(', '))+(one?' is':' are')+' not included in this booking and won\'t be charged. Contact '+(one?'the venue':'the venues')+' directly.</p>';}
      if(notReady)body+='<p class="dw-error" role="alert">These places could not be classified for the demo. Refresh the estimate or check with the venues.</p>';
      body+='<button class="btn btn-primary btn-block dw-confirm" data-act="dwBook"'+(ctx.busy||insufficient||notReady||!ctx.wallet?' disabled':'')+'>'+(ctx.busy?'Saving demo reservations…':'Confirm & book (demo)')+'</button><p class="dw-confirm-note">Confirms this itinerary and lets the agent use '+dwMoney(quote.totalMinor)+' virtual credits. No real charge.</p><button class="dw-text" data-act="dwRefreshQuote"'+(ctx.busy?' disabled':'')+'>Refresh demo estimate</button>';
    }
  }
  return {bar:header,tabs:true,body:'<main class="dw-page dw-booking-page">'+body+'</main>',after:()=>{if(dwCurrent(ctx)&&!record)void dwQuote(source);}};
};
const dwMeView=V.me;
V.me=()=>{
  const view=dwMeView(),template=document.createElement('template');template.innerHTML=view.body;
  const root=template.content.querySelector('.content'),preferences=root?.querySelector('.fx-settings-entry > .list');
  const entry='<button class="li" data-act="dwWallet">'+ic('receipt',20)+'<span class="li-main"><span class="li-title">Wallet</span></span>'+ic('right',16)+'</button>';
  if(preferences)preferences.insertAdjacentHTML('beforeend',entry);
  else if(root)root.insertAdjacentHTML('beforeend','<div class="list">'+entry+'</div>');
  view.body=template.innerHTML;return view;
};
const dwPlaceView=V['place-plan'];
V['place-plan']=()=>{dwScope();const view=dwPlaceView();if(!dw.owner||pd.owner!==dw.owner||!pd.plan||!pd.historyId||pd.sample)return view;const template=document.createElement('template');template.innerHTML=view.body;const invitation=dwInviteHTML('history',pd.historyId),confirm=template.content.querySelector('.tc-confirm');if(confirm)confirm.outerHTML=invitation;else{const root=template.content.querySelector('.tu-sheet-scroll')||template.content.querySelector('.pd-plan');root?.insertAdjacentHTML('afterbegin',invitation);}view.body=template.innerHTML;return view;};
const dwCalRefresh=A.calRefresh;
A.calRefresh=async()=>{await Promise.allSettled([dwLoad(true),dwCalRefresh()]);};
const dwPreviousRender=render;
render=function(){dwScope();dwPreviousRender();const ctx=dw;if(ctx.owner&&!ctx.loaded&&!ctx.loading&&!ctx.error&&['orders','demo-wallet','demo-booking','place-plan'].includes(state.route))Promise.resolve().then(()=>{if(dwCurrent(ctx))void dwLoad();});};
