const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
 const dom=new JSDOM('<main id="app"></main><aside id="sheet"></aside>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window;
 const calls={maps:0,destroy:0,loads:0,markers:[],lines:[]};
 const maps={Map:class{constructor(){calls.maps++;}fitBounds(){}on(){}add(){}setFitView(){}destroy(){calls.destroy++;}},Marker:class{constructor(o){Object.assign(this,o);calls.markers.push(this);}on(){}},LatLngBounds:class{constructor(){this.p=[];}extend(p){this.p.push(p);}isEmpty(){return !this.p.length;}},Polyline:class{constructor(o){Object.assign(this,o);calls.lines.push(this);}setMap(m){this.map=m;}},marker:{AdvancedMarkerElement:class{constructor(o){Object.assign(this,o);calls.markers.push(this);}addListener(){}}},event:{clearInstanceListeners(){calls.destroy++;}}};
 w.testMaps=maps;w.fetch=()=>{throw Error('No new network calls permitted');};w.loadMaps=async()=>{calls.loads++;return maps;};w.HTMLElement.prototype.scrollIntoView=function(){};
 const navigation=fs.readFileSync(__dirname+'/travel-ui.js','utf8').split('function tuDirectionsLink(')[1].split('function tuRememberSheet(')[0];
 w.eval(`
 const A={},V={orders:()=>({body:''}),journey:()=>({body:'Journey'})},TAB_OF={},DBC={bookings:{},sessions:{}},EXPS={};
 let jhUser={id:'alice'},ag={owner:'alice',runs:[],loading:false},pd={owner:'alice',historyId:'trip',places:[],plan:null};
 let th={owner:'alice',items:[],loaded:true,loading:false},tc={owner:'alice',trips:[]},cm={owner:'alice',loaded:true,loading:false},state={route:'orders',params:{},plan:{savedStops:[]}},ui={sheet:null};
 let dw={owner:'alice',quotes:{},wallet:{bookings:[]}};
 const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),ic=()=>'',bar=x=>x;
 const traveler=()=>jhUser,myOrders=()=>[],isMine=b=>b.traveler===jhUser?.id,agPlan=r=>r?.plan,tcName=s=>s.name,agTime=()=>'',agErrorText=e=>e.message;
 const cmHidden=()=>false,cmActionButton=()=>'',thScope=()=>{},tcScope=()=>{},thLoad=async()=>{},agLoadRuns=async()=>{},jhRefresh=async()=>{},openLogin=()=>{},thSnapshotUpdating=()=>false;
 const dwKey=(t,id)=>t+':'+id,dwMoney=n=>'CNY '+(n/100).toFixed(2),dwPaid=b=>b.status==='simulated_confirmed',dwBookings=(t,id)=>dw.wallet.bookings.filter(b=>b.sourceType===t&&b.sourceId===id),fmt=n=>'THB '+n;
 const ubStopBooking=(e,s)=>Object.values(DBC.bookings).find(b=>isMine(b)&&b.sourceId===e.manageId&&b.stopId===s.id),dwStopHTML=()=>'',dwDayHTML=()=>'';
 let sheetView=()=>'',render=()=>{const v=V[state.route]();document.querySelector('#app').innerHTML=v.body;document.querySelector('#sheet').innerHTML=sheetView();v.after?.();};
 const go=r=>{state.route=r;render()};A.dwReview=(type,id)=>{state.review=[type,id]};A.ubSession=id=>{state.session=id};A.ticket=id=>{state.ticket=id};
 const pmColors=['purple','teal','green','pink'],pmLocated=s=>Number.isFinite(s.lat)&&Number.isFinite(s.lng),pmDecode=()=>[{lat:31.2,lng:121.4},{lat:31.3,lng:121.5}];
 let pmAuthError='',pmLibrary=null,amLibrary=null,amExpires=0,pmAuthFailure=()=>{pmAuthError='Map access error'};
 const pmLoad=()=>window.loadMaps(),amLoad=()=>window.loadMaps();
 function tuDirectionsLink(`+navigation+fs.readFileSync(__dirname+'/calendar-ui.js','utf8')+fs.readFileSync(__dirname+'/vendor-address/pinyin.js','utf8')+fs.readFileSync(__dirname+'/attraction-policies.js','utf8')+fs.readFileSync(__dirname+'/attraction-details.js','utf8')+fs.readFileSync(__dirname+'/calendar-visit.js','utf8')+fs.readFileSync(__dirname+'/calendar-map.js','utf8')+`
 window.t={A,V,DBC,EXPS,ui,pd,th,tc,state,dw,render,status:cvStatus,address:cvAddressLink,model:cMapModel,events:calEvents,get cal(){return cal},get active(){return cMapActive},setOwner(id){jhUser={id};pd.owner=id;dw.owner=id;th.owner=id;th.items=[];tc.owner=id;tc.trips=[];render();}};
 `);
 const t=w.t,photo='https://images.example.invalid/reused.jpg',stops=[{id:'amap_B1',name:'History Museum',address:'上海南京西路325号',addressEnglish:'325 Nanjing West Road, Shanghai',source:'Amap',sourceURL:'https://www.amap.com/place/B1',coordinateSystem:'GCJ-02',lat:31.23,lng:121.47,kind:'museum',dayIndex:1,start:'09:00',end:'10:00',photo:{url:photo,authors:[{name:'Photo author'}]},openingHours:['Monday: Closed','Tuesday–Sunday: 09:00–17:00']},{id:'amap_B2',name:'Italian Restaurant',source:'Amap',coordinateSystem:'GCJ-02',lat:31.24,lng:121.49,kind:'restaurant',dayIndex:1,start:'12:00',end:'13:00'},{id:'amap_B3',name:'Garden',source:'Amap',coordinateSystem:'GCJ-02',lat:31.25,lng:121.5,kind:'garden',dayIndex:2,start:'09:00',end:'10:00'}];
 stops.push({id:'amap_B4',name:'Matcha cafe',source:'Amap',coordinateSystem:'GCJ-02',lat:31.26,lng:121.51,kind:'cafe',dayIndex:2,start:'12:00',end:'13:00'});
 const savedDayTwoRoute={day:2,status:'ready',source:'Amap',placeIds:['amap_B3','amap_B4'],path:[[121.5,31.25],[121.51,31.26]]};
 const input={city:'Shanghai',date:'2026-12-01',days:2,guests:2,transport:'drive'},plan={...input,stops,roadRoutes:[{day:1,status:'ready',source:'Amap',placeIds:['amap_B1','amap_B2'],path:[[121.47,31.23],[121.49,31.24]]},savedDayTwoRoute],estimate:{items:[{stopId:'amap_B1',kind:'ticket',unitMinor:4000},{stopId:'amap_B2',kind:'restaurant',unitMinor:5000}]}};
 t.th.items=[{id:'trip',input,status:'itinerary'}];t.pd.plan=plan;t.pd.places=stops;t.cal.details.trip={plan};t.A.calDate('2026-12-01');await tick();
 const app=()=>w.document.querySelector('#app'),sheet=()=>w.document.querySelector('#sheet');
 assert.equal(app().querySelectorAll('.cv-card').length,2);assert(!app().textContent.includes('上海'));assert(app().textContent.includes('325 Nanjing'));assert(app().textContent.includes('Awaiting payment'));assert(!app().textContent.includes('ID requirements'));
 assert(app().textContent.includes('Public transit'));assert(app().textContent.includes('Taxi'));const links=[...app().querySelectorAll('.cv-transport-links a')];assert.equal(new URL(links[0].href).searchParams.get('mode'),'bus');assert.equal(new URL(links[1].href).searchParams.get('mode'),'car');assert.equal(new URL(links[0].href).searchParams.get('callnative'),'1');
 assert.equal(calls.maps,1);assert.equal(t.active.lines.length,1);assert.equal(t.active.markers.length,2);assert.deepEqual(JSON.parse(JSON.stringify(t.pd.plan)),plan,'Calendar does not replace current planner');
 const event=t.events().find(e=>e.date==='2026-12-01'&&e.kind==='plan');t.A.cvOpen(event.key,'amap_B1');await tick();assert.equal(sheet().querySelector('img').src,photo);assert(sheet().textContent.includes('09:00–17:00'));assert(sheet().textContent.includes('Ticket price'));assert(sheet().textContent.includes('Advance reservation'));assert(sheet().textContent.includes('ID to bring'));assert.equal(calls.maps,1,'opening detail reuses map');
 t.render();await tick();assert.equal(calls.maps,1);assert.equal(calls.loads,1,'passive renders reuse map and SDK');assert.equal(app().querySelector('[data-calendar-map-status]').hidden,true,'reused map is not stuck loading');
 const free=t.status(event,{id:'free',estimate:{kind:'free',unitMinor:0}});assert.equal(free.label,'No wallet charge');assert(!free.label.includes('ticket'));assert.equal(t.status(event,{id:'verified',visitInfo:{verified:true,sourceURL:'https://venue.example',admission:'free',reservationRequired:false}}).label,'No ticket needed');
 assert.equal(t.status(event,{id:'unknown',kind:'museum'}).label,'Ticket details to check');
 assert.equal(t.address({...stops[0],addressEnglish:'',address:'上海市 黄浦区 南京西路325号(人民广场站11号出口)'}).label,'325 Nanjing West Road, Huangpu District, Shanghai');
 assert.equal(t.address({...stops[0],addressEnglish:'',address:'上海市 黄浦区 人民广场(地铁11号出口)'}).label,'Area: Huangpu District, Shanghai');
 t.DBC.bookings.paid={id:'paid',traveler:'alice',sourceId:'trip',stopId:'amap_B1',status:'confirmed',demo:true,paymentStatus:'virtual_paid',amountMinor:8000};t.render();assert(app().textContent.includes('Paid with credits'));assert(app().textContent.includes('CNY 80.00 · group'));
 t.DBC.bookings.paid.status='cancelled';t.DBC.bookings.paid.paymentStatus='refunded';t.render();assert(app().textContent.includes('Cancelled'));assert(app().textContent.includes('Credits refunded'));assert(!sheet().textContent.includes('View ticket'));
 t.tc.trips.push({...input,sourceType:'history',sourceId:'trip',stops:[{...stops[1],start:'09:00',end:'10:00'},{...stops[0],start:'12:00',end:'13:00'},stops[2],stops[3]]});t.render();await tick();assert.equal(t.active.lines.length,0,'care reordering invalidates old road geometry');
 // Accepted chat replacements carry verified geometry for the changed day.
 // An unchanged day still needs its saved route even when care omits that day.
 const replacement={...stops[0],id:'amap_B5',name:'Indoor Art Museum',lat:31.22,lng:121.46},acceptedRoute={day:1,status:'ready',source:'Amap',placeIds:['amap_B5','amap_B2'],path:[[121.46,31.22],[121.48,31.23],[121.49,31.24]]};
 t.tc.trips[0]={...t.tc.trips[0],stops:[replacement,stops[1],stops[2],stops[3]],roadRoutes:[acceptedRoute]};t.render();await tick();
 const acceptedEvent=t.events().find(e=>e.date==='2026-12-01'&&e.kind==='plan'),acceptedModel=t.model(acceptedEvent);
 assert.deepEqual(JSON.parse(JSON.stringify(acceptedModel.routes)),[acceptedRoute],'accepted replacement uses care route instead of stale saved geometry');assert.deepEqual(JSON.parse(JSON.stringify(t.active.lines[0].path)),acceptedRoute.path,'rendered route follows accepted replacement');assert.deepEqual(Array.from(acceptedModel.stops,s=>s.id),['amap_B5','amap_B2']);
 t.tc.trips[0].roadRoutes=[{...acceptedRoute,placeIds:['amap_B1','amap_B2']}];assert.equal(t.model(acceptedEvent).routes.length,0,'mismatched care route cannot be drawn for replacement ids');t.tc.trips[0].roadRoutes=[acceptedRoute];
 t.ui.sheet=null;t.A.calDate('2026-12-02');await tick();assert.equal(t.active.markers.length,2);assert.equal(t.active.lines.length,1);assert.equal(app().querySelectorAll('.cv-card').length,2);assert(app().textContent.includes('Day 2 route'));
 const unchangedEvent=t.events().find(e=>e.date==='2026-12-02'&&e.kind==='plan');assert.deepEqual(JSON.parse(JSON.stringify(t.model(unchangedEvent).routes)),[savedDayTwoRoute],'same-order unchanged day retains hydrated route when care only supplies changed day');assert.deepEqual(JSON.parse(JSON.stringify(t.active.lines[0].path)),savedDayTwoRoute.path);
 t.tc.trips[0].stops=[replacement,stops[1],{...stops[3],start:'09:00',end:'10:00'},{...stops[2],start:'12:00',end:'13:00'}];t.render();await tick();assert.equal(t.active.lines.length,0,'changed-order day without accepted geometry never falls back to old route');
 t.setOwner('bob');await tick();assert.equal(t.active,null);assert(!app().textContent.includes('History Museum'));assert.equal(sheet().textContent,'');
 // An SDK response after date change cannot attach a previous day's map.
 t.th.items=[{id:'trip',input,status:'itinerary'}];t.cal.details.trip={plan};let release;w.loadMaps=()=>new Promise(r=>release=r);t.A.calDate('2026-12-01');await tick();t.A.calDate('2026-11-30');release(maps);await tick();assert.equal(t.active,null);
 dom.window.close();console.log('PASS: compact cards/detail reuse, native transit/taxi links, canonical payment/refund, accepted replacement routes, unchanged-day saved route fallback, stale/reordered route suppression, isolated per-day map, no duplicate SDK/network calls and owner/date race guards.');
})().catch(e=>{console.error(e);process.exitCode=1;});
