/* Local-only visual QA: production bundle, in-memory account, no real network/auth. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase');
const user={id:'35000000-0000-4000-8000-000000000084',email:'calendar-preview@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'};
const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#253e35"/><path d="M35 160V75h45v85m20 0V45h50v115m20 0V95h45v65m20 0V60h30v100" fill="#a8c6b0"/><text x="150" y="185" text-anchor="middle" fill="white" font-size="16">LOCAL PREVIEW</text></svg>');
const snapshot={staff:null,sessionPlans:[],metrics:[],liveMetrics:[],personal:{},
 profile:{id:user.id,email:user.email,name:'Calendar Preview',country:'Singapore'},
 stores:[{store_id:'rf',name:'Riverfront Gifts',kind:'Craft',area:'Riverside',distance_km:1,opening_hours:'09:00–17:00',issues_vat_forms:false}],
 products:[{product_id:'tote',store_id:'rf',name:'Riverfront tote',price_thb:250,description:'Local preview item.',categories:['gifts'],made_to_order:false}],
 inventory:[{product_id:'tote',stock:10}],
 venues:[{venue_id:'shanghai',name:'Shanghai Riverside',city:'Shanghai',time_zone:'Asia/Shanghai'}],
 experiences:[{experience_id:'sh-walk',name:'Shanghai evening riverwalk',kind:'Culture',duration_min:90,price_thb:450,rating:4.8,review_count:10,host_name:'Local host',languages:['English'],venue_id:'shanghai',details:{sample:true,en:'Shanghai evening riverwalk',cats:['culture'],img:photo}}],
 sessions:[{session_id:'calendar-session',experience_id:'sh-walk',starts_at:'2026-11-04T10:00:00Z',ends_at:'2026-11-04T11:30:00Z',capacity:12,seats_held_other_channels:0,seats_taken:2,price_thb:450,status:'open'}],
 bookings:[{booking_id:'calendar-booking',session_id:'calendar-session',traveler_id:user.id,guest_name:'Calendar Preview',guests:2,channel:'app',status:'confirmed',unit_price_thb:450,checkin_code:'LOCALONLY',created_at:'2026-11-01T04:00:00Z'}],
 orders:[{order_id:'CAL-LOCAL-01',traveler_id:user.id,guest_name:'Calendar Preview',delivery_method:'hotel',destination:'Preview Hotel',status:'preparing',items:[{product_id:'tote',name:'Riverfront tote',qty:1,unit_price_thb:250,made_to_order:false}],delivery_fee_thb:80,split_fee_thb:0,items_thb:250,total_thb:330,recipient_name:'Calendar Preview',hotel_room:'Preview',import_check:'pending',placed_at:'2026-11-03T03:00:00Z',events:[{at:'2026-11-03T03:00:00Z',message:'Local preview order created.'}]}]
};
const places=[
 {id:'preview-museum',name:'Shanghai History Museum',kind:'museum',dayIndex:1,start:'09:00',end:'10:30',reason:'Explore the city’s history.',lat:31.2306,lng:121.4709},
 {id:'preview-lunch',name:'Mercato Italian Restaurant',kind:'restaurant',dayIndex:1,start:'12:00',end:'13:30',reason:'A relaxed lunch.',lat:31.237,lng:121.489},
 {id:'preview-matcha',name:'THE MATCHA TOKYO',kind:'cafe',dayIndex:1,start:'15:00',end:'16:00',reason:'An afternoon matcha stop.',lat:31.205,lng:121.435},
 {id:'preview-garden',name:'Yu Garden',kind:'garden',dayIndex:2,start:'10:00',end:'11:30',reason:'A slower second day.',lat:31.227,lng:121.493}
].map((p,i)=>({...p,sample:true,source:'JourneyHub sample catalog',address:['325 Nanjing West Road','3 Zhongshan East Road','Huaihai Road','168 Fuyou Road'][i],photo:{url:photo},attributions:[],openingHours:[]}));
const input={city:'Shanghai',date:'2026-11-04',days:2,guests:2,prompt:'Local food, Italian dining and matcha, with a little history.',dayStart:'09:00',dayEnd:'21:00',transport:'walk'};
const histories=[
 {id:'calendar-shanghai',input,status:'itinerary',placeCount:4,stopCount:4,createdAt:'2026-11-03T05:00:00Z',updatedAt:'2026-11-03T05:00:00Z'},
 {id:'calendar-singapore',input:{...input,city:'Singapore',date:'2026-11-08',days:1,prompt:'Gardens and waterfront walks.'},status:'itinerary',placeCount:3,stopCount:3,createdAt:'2026-11-02T05:00:00Z',updatedAt:'2026-11-02T05:00:00Z'},
 {id:'calendar-newyear',input:{...input,date:'2026-12-31',days:2,prompt:'Welcome the new year in Shanghai.'},status:'itinerary',placeCount:4,stopCount:4,createdAt:'2026-11-01T05:00:00Z',updatedAt:'2026-11-01T05:00:00Z'}
];
// No preloaded care names: Calendar must hydrate the selected history inline.
const trips=[];
const prelude=`
window.JOURNEYHUB_CONFIG={url:'https://calendar-preview.invalid',publishableKey:'local-preview-only'};
window.calendarPreviewData=${JSON.stringify({user,snapshot,histories,trips,places,removed:[],receipts:{}})};
window.calendarPreviewCalls=[];
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:window.calendarPreviewData.user,access_token:'local-preview-only'}},error:null}),getUser:async()=>({data:{user:window.calendarPreviewData.user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:Error('Local preview only')})},rpc:async(name,args={})=>{
 window.calendarPreviewCalls.push({rpc:name});const d=window.calendarPreviewData;
 if(name==='journeyhub_snapshot')return {data:JSON.parse(JSON.stringify(d.snapshot)),error:null};
 if(name==='journeyhub_calendar_state')return {data:{removed:JSON.parse(JSON.stringify(d.removed))},error:null};
 if(name==='journeyhub_calendar_manage'){
  if(d.receipts[args.p_request_id])return {data:JSON.parse(JSON.stringify(d.receipts[args.p_request_id])),error:null};
  const {p_kind:kind,p_id:id,p_action:action}=args;
  if(action==='cancel'){const booking=d.snapshot.bookings.find(b=>b.booking_id===id);if(!booking)return {data:null,error:{message:'CALENDAR_ITEM_NOT_FOUND'}};booking.status='cancelled';}
  else if(action==='remove'&&!d.removed.some(x=>x.kind===kind&&x.id===id)){const h=d.histories.find(x=>x.id===id);d.removed.push({kind,id,title:kind==='booking'?'Shanghai evening riverwalk':(h?.input.city||'Shanghai')+' trip',date:h?.input.date||'2026-11-04',city:h?.input.city||'Shanghai',removedAt:new Date().toISOString()});}
  else if(action==='restore')d.removed=d.removed.filter(x=>x.kind!==kind||x.id!==id);
  const result={ok:true,kind,id,action,removed:JSON.parse(JSON.stringify(d.removed)),...(action==='cancel'?{bookingStatus:'cancelled'}:{carePaused:true})};d.receipts[args.p_request_id]=result;return {data:JSON.parse(JSON.stringify(result)),error:null};
 }
 if(name==='journeyhub_agent_list')return {data:[],error:null};
 if(name==='journeyhub_command'&&['profile','personal'].includes(args.p_operation)){if(args.p_operation==='personal')d.snapshot.personal=JSON.parse(JSON.stringify(args.p_payload.body));return {data:{},error:null};}
 throw Error('Local preview blocks this operation: '+name);
}})};
window.fetch=async(_url,init={})=>{
 const d=window.calendarPreviewData,p=init.method==='POST'?JSON.parse(init.body||'{}'):{};window.calendarPreviewCalls.push({action:p.action||'health'});
 if(!p.action)return Response.json({ai:{ready:false,provider:'deepseek',model:'deepseek-chat'},email:{ready:false},worker:{ready:false},booking:{mode:'journeyhub_catalog',sample:true}});
 if(p.action==='history_list')return Response.json({items:d.histories,nextCursor:null});
 if(p.action==='care_status')return Response.json({trips:d.trips});
 if(p.action==='history_open'){
  const h=d.histories.find(x=>x.id===p.id);if(!h)return Response.json({error:{message:'Preview trip missing'}},{status:404});
  return Response.json({historyId:h.id,input:h.input,places:d.places,token:'local-preview-only',expires:Date.now()+3600000,wanted:d.places.map(x=>x.id),skipped:[],sample:true,plan:{...h.input,summary:'Local preview itinerary.',stops:d.places,roadRoutes:[]}});
 }
 return Response.json({error:{message:'Local preview blocks writes and live provider calls.'}},{status:403});
};
`;
function make(){
 let html=fs.readFileSync(path.join(out,'index.html'),'utf8');
 if(!html.includes('function calEvents('))throw Error('Build the Calendar bundle first.');
 let code=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean).join('\n');
 if((code.match(/jhStart\(\);/g)||[]).length!==1)throw Error('Expected one app bootstrap.');
 code=code.replace('jhStart();',`jhStart().then(async()=>{await Promise.all([thLoad(),tcLoad(true),agLoadRuns()]);calScope();state.role='traveler';state.guestOk=true;state.route='orders';state.params={};calSelect('2026-11-04');window.calendarPreviewReady=true;});`);
 new vm.Script(prelude+code);
 html=html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*href="https?:[^>]*>/g,'');
 html=html.replace('<title>Journey Hub · Online</title>','<title>Local QA · Calendar</title>');
 html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; connect-src \'none\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\'; frame-src \'none\'">');
 // The imported prototype intentionally omits explicit body tags.
 html=html.replace('</html>',()=>'<script>'+prelude+code+'</script></html>');
 fs.writeFileSync(path.join(out,'fixture-calendar.html'),html);
 console.log('Wrote local fixture-calendar.html: signed-in mock, 4 Nov Shanghai agenda, month rollover, purchases; no live network or booking writes.');
}
module.exports={make};if(require.main===module)make();
