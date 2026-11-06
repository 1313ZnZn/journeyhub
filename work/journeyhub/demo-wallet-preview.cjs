/* Local-only production UI fixture. All authentication, provider and wallet calls are in memory. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase');
require('./calendar-preview.cjs').make();
let html=fs.readFileSync(path.join(out,'fixture-calendar.html'),'utf8');
if(!html.includes('function dwStopHTML('))throw Error('Build demo-wallet.js into the production bundle first.');
const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
const extra=`
// Isolated QA data: no real account, credits, provider API, booking or payment.
const qa=window.calendarPreviewData;qa.histories=[qa.histories[0]];qa.histories[0].input={...qa.histories[0].input,date:${JSON.stringify(date)},days:1,guests:2,transport:'drive'};
qa.snapshot.bookings=[];qa.snapshot.orders=[];qa.trips=[];
qa.places=qa.places.map((place,i)=>({...place,id:'amap_fixture_'+i,sample:false,source:'Amap',coordinateSystem:'GCJ-02',dayIndex:1,start:['09:00','12:00','15:00','17:00'][i],end:['10:30','13:30','16:00','18:00'][i],travel:i?{durationMinutes:[0,20,25,15][i],distanceMeters:[0,3100,4200,2200][i],source:'Amap',mode:'drive'}:null}));
const qaCopy=value=>JSON.parse(JSON.stringify(value)),qaWallet={demo:true,currency:'CNY',balanceMinor:0,ledger:[],bookings:[]},qaRequests={};
let qaQuote=null;
window.fetch=async(url,init={})=>{
 const p=init.method==='POST'?JSON.parse(init.body||'{}'):{};if(!String(p.action||'').startsWith('demo_'))return window.calendarBaseFetch(url,init);
 window.calendarPreviewCalls.push({action:p.action});
 const reply=extra=>Response.json({wallet:qaCopy(qaWallet),...(extra||{})});
 if(p.action==='demo_state')return reply();
 if(p.action==='demo_quote'){
  if(p.historyId!==qa.histories[0].id)return Response.json({error:{message:'Only the local QA itinerary is available.'}},{status:404});
  qaQuote||={id:'local-demo-quote',sourceType:'history',sourceId:p.historyId,revision:'local-qa',expiresAt:new Date(Date.now()+3600000).toISOString(),status:'quoted',currency:'CNY',demo:true,items:qa.places.map((place,i)=>({stopId:place.id,kind:['ticket','restaurant','cafe','free'][i],unitMinor:[4000,5000,2000,0][i],quantity:2,totalMinor:[8000,10000,4000,0][i],dayIndex:1,date:${JSON.stringify(date)},start:place.start,end:place.end})),totalMinor:22000};return reply({quote:qaCopy(qaQuote)});
 }
 if(qaRequests[p.requestId])return Response.json(qaCopy(qaRequests[p.requestId]));
 if(p.action==='demo_topup'){
  if(![10000,50000,100000].includes(p.amountMinor))return Response.json({error:{message:'Choose a fixture amount.'}},{status:400});
  qaWallet.balanceMinor+=p.amountMinor;qaWallet.ledger.unshift({id:'topup-'+p.requestId,kind:'topup',amountMinor:p.amountMinor,balanceAfterMinor:qaWallet.balanceMinor,createdAt:new Date().toISOString(),demo:true});
 }else if(p.action==='demo_book'){
  if(!qaQuote||p.quoteId!==qaQuote.id)return Response.json({error:{message:'Review the local estimate first.'}},{status:400});
  if(qaQuote.status!=='booked'){
   if(qaWallet.balanceMinor<qaQuote.totalMinor)return Response.json({error:{code:'DEMO_INSUFFICIENT_FUNDS',message:'Add demo credits before confirming.'}},{status:409});
   qaWallet.balanceMinor-=qaQuote.totalMinor;qaQuote.status='booked';
   qaWallet.bookings=qaQuote.items.map((item,i)=>({...item,id:'local-demo-booking-'+i,quoteId:qaQuote.id,sourceType:'history',sourceId:qaQuote.sourceId,amountMinor:item.totalMinor,status:item.kind==='free'?'not_required':'simulated_confirmed',currency:'CNY',reference:'DEMO-QA-'+(i+1),createdAt:new Date().toISOString(),demo:true}));
   qaWallet.ledger.unshift({id:'payment-'+p.requestId,kind:'payment',amountMinor:-qaQuote.totalMinor,balanceAfterMinor:qaWallet.balanceMinor,quoteId:qaQuote.id,createdAt:new Date().toISOString(),demo:true});
  }
 }else if(p.action==='demo_cancel'){
  const booking=qaWallet.bookings.find(b=>b.id===p.bookingId);if(!booking)return Response.json({error:{message:'Local reservation missing.'}},{status:404});
  if(booking.status==='simulated_confirmed'){booking.status='cancelled';booking.cancelledAt=new Date().toISOString();qaWallet.balanceMinor+=booking.amountMinor;qaWallet.ledger.unshift({id:'refund-'+p.requestId,kind:'refund',amountMinor:booking.amountMinor,balanceAfterMinor:qaWallet.balanceMinor,bookingId:booking.id,quoteId:booking.quoteId,createdAt:new Date().toISOString(),demo:true});}
 }else return Response.json({error:{message:'Local QA blocks this action.'}},{status:403});
 const result={wallet:qaCopy(qaWallet),demo:true,...(p.action==='demo_book'?{quote:qaCopy(qaQuote),bookings:qaCopy(qaWallet.bookings)}:{})};qaRequests[p.requestId]=qaCopy(result);return Response.json(result);
};
`;
html=html.replace('window.fetch=async(_url,init={})=>{','window.calendarBaseFetch=async(_url,init={})=>{');
const anchor="return Response.json({error:{message:'Local preview blocks writes and live provider calls.'}},{status:403});\n};";
if(!html.includes(anchor))throw Error('Calendar preview transport anchor changed.');
html=html.replace(anchor,()=>anchor+'\n'+extra);
html=html.replace("calSelect('2026-11-04');window.calendarPreviewReady=true;","calSelect('"+date+"');window.calendarPreviewReady=true;");
html=html.replace('Local QA · Calendar','Local QA · Demo wallet and Calendar');
// History hydration must remain sample-free within this isolated, non-network fixture.
html=html.replace("skipped:[],sample:true,plan:{...h.input","skipped:[],sample:false,plan:{...h.input");
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);for(const script of scripts)new vm.Script(script);
fs.writeFileSync(path.join(out,'fixture-demo-wallet.html'),html);
console.log('Wrote fixture-demo-wallet.html: tomorrow Shanghai, colored stops, Amap links, CNY 220 demo estimate, zero balance; add CNY 500 and confirm to leave CNY 280. Cancel museum returns CNY 80. No real network or account writes.');
