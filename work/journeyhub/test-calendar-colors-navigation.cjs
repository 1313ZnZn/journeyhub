/* Calendar presentation and navigation regression; no browser/provider calls. */
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<main id="app"></main>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window;
const travel=fs.readFileSync(__dirname+'/travel-ui.js','utf8'),navigation=travel.slice(travel.indexOf('function tuDirectionsLink('),travel.indexOf('function tuRememberSheet('));
w.eval(`
const A={},V={orders:()=>({body:''})},TAB_OF={},DBC={bookings:{},sessions:{}},EXPS={};
let jhUser={id:'alice'},ag={owner:'alice',runs:[],loading:false,error:''},pd={owner:'alice',historyId:null,plan:null};
let th={owner:'alice',items:[],loaded:true,loading:false,error:'',cursor:null},tc={owner:'alice',trips:[]},cm={owner:'alice',loaded:true,loading:false,error:''};
let state={route:'orders',params:{},plan:{savedStops:[]}},render=()=>{};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),ic=()=>'',bar=x=>x;
const traveler=()=>jhUser,myBookings=()=>Object.values(DBC.bookings),myOrders=()=>[],isMine=()=>true,agPlan=r=>r?.plan,tcName=s=>s.name,agTime=()=>'',agErrorText=e=>e.message;
const cmHidden=()=>false,cmActionButton=()=>'',thScope=()=>{},tcScope=()=>{},thLoad=async()=>{},agLoadRuns=async()=>{},jhRefresh=async()=>{},go=()=>{},openLogin=()=>{};
const hookCalls=[];function dwStopHTML(event,stop){hookCalls.push([event.manageKind,event.manageId,event.date,stop.id]);return '<span class="demo-stop-hook">Demo status</span>';}
function dwDayHTML(event){return '<aside class="demo-day-hook">Demo budget</aside>';}
`+navigation+fs.readFileSync(__dirname+'/calendar-ui.js','utf8')+`
window.testCalendar={events:calEvents,card:calCard,theme:calStopTheme,merge:calCarePlan,transfer:calTransferHTML,hookCalls,get cal(){return cal},get tc(){return tc},get th(){return th},get pd(){return pd}};
`);
const t=w.testCalendar,origin={id:'amap_museum',name:'Shanghai History Museum',kind:'museum',source:'Amap',coordinateSystem:'GCJ-02',lat:31.23,lng:121.47,address:'Nanjing West Road',dayIndex:1,start:'09:00',end:'10:00'},lunch={id:'amap_lunch',name:'Italian Restaurant',kind:'restaurant',source:'Amap',coordinateSystem:'GCJ-02',lat:31.24,lng:121.49,address:'Zhongshan East Road',dayIndex:1,start:'11:00',end:'12:00',travel:{mode:'transit',durationMinutes:20,distanceMeters:3100,source:'Amap'}},tea={id:'amap_tea',name:'Matcha Cafe',kind:'cafe',source:'Amap',coordinateSystem:'GCJ-02',lat:31.25,lng:121.50,dayIndex:1,start:'14:00',end:'15:00',travel:{mode:'walk',durationMinutes:10,distanceMeters:400,source:'Amap'}},garden={id:'amap_garden',name:'Yu Garden',kind:'garden',source:'Amap',coordinateSystem:'GCJ-02',lat:31.21,lng:121.49,dayIndex:2,start:'10:00',end:'11:00',travel:{mode:'drive',durationMinutes:200,source:'Amap'}};
const input={city:'Shanghai',date:'2026-12-01',days:2,transport:'walk'},plan={...input,stops:[origin,lunch,tea,garden]},row={id:'history-one',status:'itinerary',createdAt:'2026-11-04T00:00:00Z',input};
t.th.items.push(row);t.cal.details[row.id]={plan};
const events=t.events(),event=events.find(e=>e.date==='2026-12-01');
assert.equal(event.transport,'walk');assert.equal(event.stops[1].id,lunch.id);assert.equal(event.stops[1].coordinateSystem,'GCJ-02');assert.equal(event.stops[1].travelFromId,origin.id);
const app=w.document.querySelector('#app');app.innerHTML=t.card(event);
assert.equal(app.querySelectorAll('.cal-stop-sightseeing').length,1);assert.equal(app.querySelectorAll('.cal-stop-dining').length,2);assert.equal(app.querySelectorAll('.cal-stop-category')[0].textContent,'Sightseeing');assert.equal(app.querySelectorAll('.cal-stop-category')[1].textContent,'Food & drink');
assert.equal(t.theme({kind:'museum',categories:['food']}).key,'sightseeing','provider primary kind wins over a broad interest');
assert.equal(t.theme({kind:'',reason:'A relaxed lunch'}).key,'dining');assert.equal(t.theme({kind:'shop',reason:'Next to the restaurant'}).key,'sightseeing','known nonfood kind is not inferred from mention');
assert.equal(app.querySelectorAll('.cal-transfer').length,2);assert(app.textContent.includes('20 min · Public transport'));assert(app.textContent.includes('3.1 km · Amap'));
const uri=new URL(app.querySelector('.cal-transfer a').href);assert.equal(uri.hostname,'uri.amap.com');assert.equal(uri.searchParams.get('callnative'),'1');assert.equal(uri.searchParams.get('mode'),'bus');assert(uri.searchParams.get('from').startsWith('121.47,31.23,'));assert(uri.searchParams.get('to').startsWith('121.49,31.24,'));
assert.equal(app.querySelectorAll('.demo-stop-hook').length,3);assert.equal(app.querySelectorAll('.demo-day-hook').length,1);assert.deepEqual(JSON.parse(JSON.stringify(t.hookCalls[1])),['history','history-one','2026-12-01',lunch.id]);
app.innerHTML=t.card({kind:'reservation',activityKind:'Food',categories:['food'],title:'Evening food walk',time:'18:00',tag:'Reserved',detail:'2 guests',action:'ticket',id:'booking-one'});assert(app.querySelector('.cal-reservation-dining'));assert(app.textContent.includes('Food & drink'));assert(app.textContent.includes('Reserved'));
app.innerHTML=t.card(events.find(e=>e.date==='2026-12-02'));assert.equal(app.querySelectorAll('.cal-transfer').length,0,'no travel connector across days');
const missing={...event.stops[1],lat:null,lng:null,travel:null};app.innerHTML=t.transfer(event,event.stops[0],missing);assert(!app.querySelector('a'),'missing GCJ-02 coordinates cannot generate Amap app link');assert(!app.textContent.includes('min'),'missing route duration must not show zero or an invented ETA');assert(app.textContent.includes('Check current directions'));
const wrongCoords={...event.stops[1],coordinateSystem:'WGS84'};app.innerHTML=t.transfer(event,event.stops[0],wrongCoords);assert(!app.querySelector('a'),'WGS84 does not enter Amap URI');
const nullDuration={...event.stops[1],travel:{mode:'drive',durationMinutes:null,distanceMeters:null,source:'Amap'}};app.innerHTML=t.transfer(event,event.stops[0],nullDuration);assert(!app.textContent.includes('0 min'));assert(!app.textContent.includes('0.0 km'));
// Confirmed care controls ordering/timing; refreshed provider data only enriches it.
const care={sourceType:'history',sourceId:row.id,...input,revision:2,stops:[{id:origin.id,name:'Stop 1',dayIndex:1,start:'09:30',end:'10:30'},{id:tea.id,name:'Stop 2',dayIndex:1,start:'12:00',end:'13:00'},{id:garden.id,name:'Stop 3',dayIndex:2,start:'10:00',end:'11:00'}]};
t.tc.trips.push(care);const adjusted=t.events().find(e=>e.date==='2026-12-01');assert.equal(adjusted.stops.length,2);assert.equal(adjusted.stops[0].time,'09:30');assert.equal(adjusted.stops[1].name,'Matcha Cafe');assert.equal(adjusted.stops[1].kind,'cafe');assert.equal(adjusted.stops[1].lat,tea.lat);assert.equal(adjusted.stops[1].travel,null,'old restaurant-to-cafe ETA cannot survive removal of the restaurant');
app.innerHTML=t.card(adjusted);assert(app.querySelector('.cal-transfer a'),'new direct route link remains available for real known coordinates');assert(!app.textContent.includes('10 min'),'old leg duration removed');assert.equal(app.querySelectorAll('.cal-stop-dining').length,1);
dom.window.close();console.log('PASS: category colors/text, dining vs sightseeing, same-day transfer data, official Amap app links, invalid coordinate/ETA guards, wallet hooks, and care-adjusted topology. No provider calls.');
