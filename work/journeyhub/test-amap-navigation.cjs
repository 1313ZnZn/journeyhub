// Actual itinerary renderer with inert fixture records; never opens a map app.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<main></main>',{url:'https://journeyhub.test',runScripts:'outside-only'}),w=dom.window;
let requests=0;w.fetch=()=>{requests++;throw Error('Navigation rendering must not request a service');};
const source=fs.readFileSync(path.join(__dirname,'travel-ui.js'),'utf8');
w.eval(`
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const A={pmSelect(){}},V={},pd={owner:'fixture',day:'all',places:[],plan:null},pmColors=['#7755bb'],ic=()=>'',agDate=s=>s,pdSafeURL=s=>s,pmLocated=s=>Number.isFinite(s.lat)&&Number.isFinite(s.lng);
V['place-plan']=()=>({body:'<div class="pd-plan"><section class="pm-route"><div class="pm-map-shell"></div><div class="pm-legend"></div></section><section><h2>Day 1</h2>'+pd.plan.stops.map(s=>(s.travel?'<p class="pd-transfer"></p>':'')+'<article class="pd-stop" data-pm-stop="'+esc(s.id)+'"><h3>'+esc(s.name)+'</h3></article>').join('')+'</section></div>'});
function render(){}
`+source+`
window.fixture={directions:tuDirectionsLink,render(stops,transport){pd.places=stops;pd.plan={city:'Shanghai',date:'2099-01-01',days:1,transport,stops};const view=V['place-plan']();document.querySelector('main').innerHTML=view.body;return document.querySelector('main');}};
`);
const f=w.fixture,from={id:'amap_B001',source:'Amap',coordinateSystem:'GCJ-02',name:'Shanghai History Museum',originalName:'上海市历史博物馆',lat:31.23223456,lng:121.46567891,dayIndex:1,start:'09:00',end:'10:30'},to={...from,id:'amap_B002',name:'The Bund',originalName:'外滩',lat:31.239,lng:121.49,start:'10:50',end:'12:00',travel:{mode:'drive',durationMinutes:20,distanceMeters:3100,source:'Amap'}};
let link=f.directions(from,to,'drive'),u=new URL(link.href);
assert.equal(u.origin,'https://uri.amap.com');assert.equal(u.pathname,'/navigation');assert.equal(u.searchParams.get('callnative'),'1');assert.equal(u.searchParams.get('mode'),'car');assert.equal(u.searchParams.get('from'),'121.465679,31.232235,上海市历史博物馆');assert.equal(u.searchParams.get('to'),'121.49,31.239,外滩');assert(!u.searchParams.has('key'));
assert.equal(new URL(f.directions(from,to,'walk').href).searchParams.get('mode'),'walk');
assert.equal(new URL(f.directions(from,to,'transit').href).searchParams.get('mode'),'bus');
assert.equal(new URL(f.directions(from,to,'bicycle').href).searchParams.get('mode'),'ride');
assert.equal(f.directions(from,to,'unknown'),null);
assert.equal(f.directions(from,to,'constructor'),null);
const unusual={...from,originalName:'Museum, East & West <Entry>'};u=new URL(f.directions(unusual,to,'walk').href);assert.equal(u.searchParams.get('from'),'121.465679,31.232235,Museum， East & West <Entry>');assert.equal([...u.searchParams.keys()].length,5,'names cannot inject parameters');
for(const invalid of [{...from,lat:null},{...from,lng:NaN},{...from,lat:91},{...from,unavailable:true},{...from,coordinateSystem:'WGS84'},{...from,id:'googleA',source:'Google Maps',coordinateSystem:'WGS84'}])assert.equal(f.directions(invalid,to,'drive'),null,'bad or mixed coordinates never enter Amap');
assert(f.directions({...from,coordinateSystem:undefined},to,'walk'),'legacy Amap-source records retain provider coordinates');
const g1={id:'googleA',source:'Google Maps',name:'Gardens by the Bay',lat:1.28,lng:103.86},g2={id:'googleB',source:'Google Maps',name:'Marina Bay'};u=new URL(f.directions(g1,g2,'walk').href);assert.equal(u.hostname,'www.google.com');assert.equal(u.searchParams.get('origin_place_id'),'googleA');assert.equal(u.searchParams.get('destination_place_id'),'googleB');assert.equal(u.searchParams.get('travelmode'),'walking');assert(!u.searchParams.has('callnative'));
let el=f.render([from,to],'walk'),anchor=el.querySelector('.tu-transfer>a');assert.equal(anchor.textContent,'Open in Amap ↗');assert.equal(new URL(anchor.href).searchParams.get('mode'),'car','actual leg mode wins over overall plan preference');assert.equal(anchor.target,'_blank');assert.equal(anchor.rel,'noopener noreferrer');assert(anchor.title.includes('web directions'));assert.equal(el.querySelector('.tu-transfer strong').textContent,'20 min · Car / taxi');
el=f.render([from,{...to,lat:null}],'drive');assert(!el.querySelector('.tu-transfer>a'),'unavailable coordinates retain transfer detail without a misleading link');
el=f.render([{...g1,dayIndex:1,start:'09:00',end:'10:00'},{...g2,dayIndex:1,start:'10:30',end:'11:00',travel:{mode:'walk',durationMinutes:30,source:'Google Routes'}}],'drive');assert.equal(el.querySelector('.tu-transfer>a').textContent,'Directions ↗');
assert.equal(requests,0);dom.window.close();console.log('PASS: Amap click-only HTTPS app handoff/web route fallback, actual leg mode, valid GCJ-02 endpoints, legacy records, mixed-provider rejection, safe parameters and unchanged Google directions. No live navigation or API calls.');
