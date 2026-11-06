/* Isolated visual QA only: production views, mock wallet/reservations, network denied. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase');
require('./calendar-preview.cjs').make();
let html=fs.readFileSync(path.join(out,'fixture-calendar.html'),'utf8');
if(!html.includes('function ubStaffBookingRows('))throw Error('Build unified booking UI first.');
const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
const extra=`
// No external network, auth, payment, email, or supplier API. Reset on reload.
const ubqa=window.calendarPreviewData,ubqaDate=${JSON.stringify(date)},ubqaCopy=x=>JSON.parse(JSON.stringify(x));
ubqa.histories=[ubqa.histories[0]];ubqa.histories[0].input={...ubqa.histories[0].input,date:ubqaDate,days:1,guests:2,transport:'drive',budget:5000,budgetCurrency:'CNY',budgetScope:'group'};
ubqa.snapshot.staff={id:'QA-MANAGER',name:'Local QA Manager',role:'duty_manager'};ubqa.snapshot.orders=[];ubqa.snapshot.bookings=[];
ubqa.snapshot.sessions[0].starts_at=ubqaDate+'T10:00:00+08:00';ubqa.snapshot.sessions[0].ends_at=ubqaDate+'T11:30:00+08:00';ubqa.snapshot.sessions[0].seats_taken=0;
ubqa.places=ubqa.places.map((p,i)=>({...p,sample:false,source:'Amap',coordinateSystem:'GCJ-02',dayIndex:1,start:['09:00','12:00','15:00','17:00'][i],end:['10:30','13:30','16:00','18:00'][i],travel:i?{durationMinutes:[0,20,25,15][i],distanceMeters:[0,3100,4200,2200][i],source:'Amap',mode:'drive'}:null}));
ubqa.places.forEach((p,i)=>{ubqa.snapshot.experiences.push({...ubqa.snapshot.experiences[0],experience_id:'qa-exp-'+i,name:p.name,kind:p.kind,price_thb:[200,250,100,0][i],details:{img:p.photo.url,cats:[p.kind]}});ubqa.snapshot.sessions.push({session_id:'qa-session-'+i,experience_id:'qa-exp-'+i,starts_at:ubqaDate+'T'+p.start+':00+08:00',ends_at:ubqaDate+'T'+p.end+':00+08:00',capacity:40,seats_held_other_channels:0,seats_taken:i<2?2:0,price_thb:[200,250,100,0][i],status:'open'});});
const ubqaWallet={currency:'CNY',balanceMinor:82000,ledger:[{id:'qa-refund',kind:'refund',amountMinor:4000,createdAt:new Date().toISOString()},{id:'qa-pay',kind:'payment',amountMinor:-22000,createdAt:new Date().toISOString()},{id:'qa-topup',kind:'topup',amountMinor:100000,createdAt:new Date().toISOString()}],bookings:[]};
function ubqaReserve(item,quoteId,cancelled=false){
 const i=ubqa.places.findIndex(p=>p.id===item.stopId),id='B-QA-'+(ubqa.snapshot.bookings.length+1),code='QA'+String(ubqa.snapshot.bookings.length+1).padStart(4,'0'),old=ubqa.snapshot.bookings.find(b=>b.session_id===item.sessionId&&b.status==='confirmed');if(old)return old.booking_id;
 const b={booking_id:id,session_id:item.sessionId,traveler_id:ubqa.user.id,guest_name:'Calendar Preview',guests:item.quantity,channel:'app',status:cancelled?'cancelled':'confirmed',unit_price_thb:item.unitMinor/20,checkin_code:code,created_at:new Date().toISOString(),demo:true,source_type:'history',source_id:ubqa.histories[0].id,stop_id:item.stopId,payment_status:cancelled?'refunded':'simulated_paid',amount_cny_minor:item.totalMinor,unit_price_cny_minor:item.unitMinor};ubqa.snapshot.bookings.push(b);
 ubqaWallet.bookings.unshift({...item,id:'detail-'+id,bookingId:id,checkinCode:cancelled?null:code,quoteId,sourceType:b.source_type,sourceId:b.source_id,canonicalStatus:b.status,paymentStatus:b.payment_status,status:cancelled?'cancelled':'simulated_confirmed',amountMinor:item.totalMinor,createdAt:b.created_at,reference:id});return id;
}
function ubqaItems(){return ubqa.places.map((p,i)=>{const b=ubqa.snapshot.bookings.find(b=>b.stop_id===p.id&&b.status==='confirmed');return {stopId:p.id,sessionId:i===3?null:'qa-session-'+i,title:p.name,kind:['ticket','restaurant','cafe','free'][i],quantity:2,unitMinor:[4000,5000,2000,0][i],totalMinor:[8000,10000,4000,0][i],date:ubqaDate,start:p.start,end:p.end,dayIndex:1,availableSeats:38,bookingId:b?.booking_id||null,requiresBooking:!b&&i!==3};});}
ubqaItems().slice(0,3).forEach((item,i)=>ubqaReserve(item,'qa-prior-quote',i===2));
let ubqaQuote=null,ubqaRevision=null;const ubqaRequests={};
const ubqaClientFactory=window.supabase.createClient;window.supabase.createClient=()=>{const client=ubqaClientFactory(),rpc=client.rpc;client.rpc=async(name,args={})=>{const result=await rpc(name,args);if(name==='journeyhub_calendar_manage'&&args.p_action==='cancel'&&!result.error){const d=ubqaWallet.bookings.find(b=>b.bookingId===args.p_id);if(d&&d.canonicalStatus!=='cancelled'){d.canonicalStatus=d.status='cancelled';d.paymentStatus='refunded';d.checkinCode=null;ubqaWallet.balanceMinor+=d.amountMinor;ubqaWallet.ledger.unshift({id:'refund-'+d.id,kind:'refund',amountMinor:d.amountMinor,createdAt:new Date().toISOString()});const b=ubqa.snapshot.bookings.find(b=>b.booking_id===args.p_id);if(b)b.payment_status='refunded';}}return result;};return client;};
window.fetch=async(url,init={})=>{
 const p=init.method==='POST'?JSON.parse(init.body||'{}'):{};
 if(p.action==='discover_revise'){
  const stops=p.stops.map((s,i)=>({...ubqa.places.find(x=>x.id===s.id),dayIndex:s.dayIndex,start:['09:00','12:00','15:00','17:00'][i],end:['10:30','13:30','16:00','18:00'][i]}));ubqaRevision={...ubqa.histories[0].input,...p.input,stops,roadRoutes:[],estimate:{currency:'CNY',totalMinor:18000,items:stops.map(s=>({stopId:s.id,totalMinor:6000}))}};return Response.json({plan:ubqaCopy(ubqaRevision),revisionToken:'local-revision',warnings:[]});
 }
 if(p.action==='discover_revise_apply'){ubqa.places=ubqaRevision.stops;ubqa.histories[0].input={...ubqa.histories[0].input,...ubqaRevision};ubqaQuote=null;return Response.json({plan:ubqaCopy(ubqaRevision),historyId:ubqa.histories[0].id,places:ubqa.places,token:'local-token',expires:Date.now()+3600000});}
 if(!String(p.action||'').startsWith('demo_'))return window.calendarBaseFetch(url,init);
 const reply=extra=>Response.json({wallet:ubqaCopy(ubqaWallet),...(extra||{})});if(p.action==='demo_state')return reply();
 if(p.action==='demo_quote'){const items=ubqaItems();ubqaQuote={id:'qa-review-'+Date.now(),sourceType:'history',sourceId:p.historyId,status:'quoted',currency:'CNY',items,totalMinor:items.filter(i=>i.requiresBooking).reduce((n,i)=>n+i.totalMinor,0)};return reply({quote:ubqaCopy(ubqaQuote)});}
 if(ubqaRequests[p.requestId])return Response.json(ubqaCopy(ubqaRequests[p.requestId]));
 if(p.action==='demo_topup'){ubqaWallet.balanceMinor+=p.amountMinor;ubqaWallet.ledger.unshift({id:'topup-'+p.requestId,kind:'topup',amountMinor:p.amountMinor,createdAt:new Date().toISOString()});}
 else if(p.action==='demo_book'){
  if(!ubqaQuote||ubqaQuote.id!==p.quoteId)return Response.json({error:{code:'DEMO_QUOTE_STALE',message:'Refresh the local estimate.'}},{status:409});
  if(ubqaQuote.status!=='booked'){if(ubqaWallet.balanceMinor<ubqaQuote.totalMinor)return Response.json({error:{code:'DEMO_INSUFFICIENT_FUNDS',message:'Add virtual credits.'}},{status:409});ubqaWallet.balanceMinor-=ubqaQuote.totalMinor;ubqaQuote.items.forEach(i=>{if(i.requiresBooking)ubqaReserve(i,ubqaQuote.id);else if(i.kind==='free')ubqaWallet.bookings.push({...i,id:'free-'+ubqaQuote.id,quoteId:ubqaQuote.id,sourceType:'history',sourceId:ubqaQuote.sourceId,status:'not_required',amountMinor:0});});ubqaQuote.status='booked';ubqaWallet.ledger.unshift({id:'pay-'+p.requestId,kind:'payment',amountMinor:-ubqaQuote.totalMinor,createdAt:new Date().toISOString()});}
 }else return Response.json({error:{message:'Local QA does not allow this action.'}},{status:403});
 const result={wallet:ubqaCopy(ubqaWallet),...(p.action==='demo_book'?{quote:ubqaCopy(ubqaQuote),bookings:ubqaCopy(ubqaWallet.bookings)}:{})};ubqaRequests[p.requestId]=ubqaCopy(result);return Response.json(result);
};
`;
html=html.replace('window.fetch=async(_url,init={})=>{','window.calendarBaseFetch=async(_url,init={})=>{');
const anchor="return Response.json({error:{message:'Local preview blocks writes and live provider calls.'}},{status:403});\n};";
if(!html.includes(anchor))throw Error('Fixture anchor changed.');
html=html.replace(anchor,()=>anchor+'\n'+extra).replace("calSelect('2026-11-04');window.calendarPreviewReady=true;","calSelect('"+date+"');window.calendarPreviewReady=true;");
html=html.replace("skipped:[],sample:true,plan:{...h.input","skipped:[],sample:false,plan:{...h.input");
const bootstrap="window.unifiedPreview={calendar:()=>{state.role='traveler';go('orders');calSelect('"+date+"');},staff:()=>{state.role='staff';go('s-bookings');},wallet:()=>{state.role='traveler';A.dwWallet();},review:()=>{state.role='traveler';A.dwReview('history',ubqa.histories[0].id);},editor:async()=>{state.role='traveler';go('orders');await A.thOpen(ubqa.histories[0].id);A.peStart();},cancelled:()=>{state.role='traveler';A.ticket('B-QA-3');}};";
html=html.replace('window.calendarPreviewReady=true;',()=> 'window.calendarPreviewReady=true;'+bootstrap);
html=html.replace('<title>Local QA · Calendar</title>','<title>Local QA · Unified bookings</title>');
html=html.replace('</html>',()=>'<aside style="position:fixed;top:8px;left:8px;z-index:99999;display:grid;gap:5px;padding:10px;background:#222;color:#fff;border-radius:10px;font:12px sans-serif;max-width:140px"><b>Local QA · Mock data</b>'+['calendar','staff','wallet','review','editor','cancelled'].map(name=>'<button style="padding:6px" onclick="window.unifiedPreview?.'+name+'()">'+name+'</button>').join('')+'</aside></html>');
for(const script of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean))new vm.Script(script);
fs.writeFileSync(path.join(out,'fixture-unified-booking.html'),html);
console.log('Wrote fixture-unified-booking.html: isolated canonical Calendar, tickets, wallet, staff and editor. No network or real writes.');
