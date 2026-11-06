/* Read-only route rendering and real Leaflet lifecycle tests, without network requests. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'journey-route-map.js'),'utf8'),leaflet=fs.readFileSync(path.join(__dirname,'vendor-route-map/leaflet.js'),'utf8');
const w=new JSDOM('<body><main id="app"></main></body>',{url:'https://journeyhub.example.test',runScripts:'outside-only',pretendToBeVisual:true}).window;
Object.defineProperty(w.HTMLElement.prototype,'clientWidth',{get(){return 350;}});Object.defineProperty(w.HTMLElement.prototype,'clientHeight',{get(){return 260;}});
w.SVGSVGElement.prototype.createSVGRect=()=>({});
w.eval('var A={jrStop:id=>window.picked=id};');w.eval(leaflet);w.eval(source);
const api=w.JourneyRoutes,app=w.document.querySelector('#app');
const plan={city:'Shanghai',date:'2026-10-25',days:3,transport:'walk',stops:[
  {sessionId:'s1',title:'The Bund',venue:'The Bund',startsAt:'2026-10-25T00:30:00Z',timeZone:'Asia/Shanghai',lat:31.238,lng:121.49},
  {sessionId:'s2',title:'Yu Garden',venue:'Yu Garden',startsAt:'2026-10-25T04:00:00Z',timeZone:'Asia/Shanghai',lat:31.228,lng:121.492},
  {sessionId:'s3',title:'Day two',venue:'Pudong',startsAt:'2026-10-25T17:30:00Z',timeZone:'Asia/Shanghai',lat:31.239,lng:121.5},
  {sessionId:'s4',title:'Day three',venue:'Tea shop',dayIndex:3,lat:null,lng:null}
],legs:[{fromSessionId:'s1',toSessionId:'s2',mode:'walk',distanceKm:1.4,durationMinutes:22,estimated:true}]};
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
const render=(p=plan,options={})=>{app.innerHTML=api.html(p,options);return api.mount(p,{owner:'u1',runId:'r1',...options});};
const markers=map=>Object.values(map._layers).filter(l=>l instanceof w.L.Marker);
const lines=map=>Object.values(map._layers).filter(l=>l instanceof w.L.Polyline);
test('timezone local dates determine days; legacy one-day and explicit dayIndex stay compatible',()=>{
  assert.equal(api.stopDay(plan,plan.stops[2]),2);assert.equal(api.stopDay(plan,plan.stops[3]),3);
  assert.equal(api.stopDay({},{}),1);assert.equal(api.stopDay(plan,{date:'2026-10-26',dayIndex:4}),2);
  assert.equal(api.stopDay(plan,{date:'2026-02-31',dayIndex:3}),3);
});
test('overview and days select correct numbered stops and separate day colors',()=>{
  const map=render();assert(map);assert.equal(markers(map).length,3);assert.equal(lines(map).length,1);
  assert.equal(lines(map)[0].options.color,api.colors[0]);assert.equal(markers(map)[2].options.icon.options.html.includes(api.colors[1]),true);
  assert.equal(app.querySelectorAll('[data-act="jrDay"]').length,4);assert.equal(app.querySelectorAll('[data-act="jrStop"]').length,4);
  assert(app.textContent.includes('1 stop has no map coordinates'));assert(app.textContent.includes('not road routes'));
  const second=render(plan,{selectedDay:2,selectedStop:'s3'});assert.equal(markers(second).length,1);assert.equal(lines(second).length,0);
  assert.equal(app.querySelector('[data-act="jrStop"]').dataset.a,'s3');assert(app.querySelector('[data-act="jrStop"]').textContent.startsWith('3'));
  assert.equal(app.querySelector('[data-a="2"]').getAttribute('aria-pressed'),'true');assert(markers(second)[0].options.icon.options.className.includes('is-selected'));
  markers(second)[0].fire('click');assert.equal(w.picked,'s3');
});
test('pan and zoom survive polling redraw; another owner does not inherit viewport',()=>{
  const first=render();first.setView([31.24,121.47],13,{animate:false});const next=render();
  assert.equal(first._container._leaflet_id,undefined);assert.equal(next.getZoom(),13);assert(Math.abs(next.getCenter().lat-31.24)<1e-8);
  const other=render(plan,{owner:'u2'});assert.notEqual(other.getCenter().lng,121.47);
});
test('missing coordinates are never coerced to zero or bridged by a route line',()=>{
  for(const stop of [{lat:null,lng:null},{lat:'',lng:''},{lat:NaN,lng:1},{lat:90,lng:2},{lat:1,lng:181},{lat:'<svg>',lng:1}])assert.equal(api.coordinates(stop),null);
  assert.deepEqual(Array.from(api.coordinates({lat:0,lng:0})),[0,0]);assert.deepEqual(Array.from(api.coordinates({lat:'31.2',lng:'121.5'})),[31.2,121.5]);
  const p={...plan,stops:[plan.stops[0],{sessionId:'missing',title:'Unknown',dayIndex:1},plan.stops[1]]};const map=render(p);
  assert.equal(lines(map).length,0);assert.equal(markers(map).length,2);
  assert.equal(render(plan,{selectedDay:3}),null);assert(app.textContent.includes('Map coordinates are not available'));
});
test('directions are encoded, carry mode, and travel estimates cannot cross days',()=>{
  const url=new URL(api.directions(plan.stops[0],plan.stops[1],'drive'));assert.equal(url.hostname,'www.google.com');assert.equal(url.searchParams.get('origin'),'31.238,121.49');assert.equal(url.searchParams.get('travelmode'),'driving');
  const html=api.legHTML(plan,plan.legs[0]);assert(html.includes('22 min walk'));assert(html.includes('1.4 km'));assert(html.includes('Estimated'));assert(html.includes('noopener noreferrer'));
  assert.equal(api.legHTML(plan,{fromSessionId:'s2',toSessionId:'s3',durationMinutes:5}), '');
  assert.equal(api.directions(null,{lat:null,lng:null}), '');
});
test('area coordinates use venue-name navigation and disclose unconfirmed meeting points',()=>{
  const p={...plan,stops:plan.stops.map(s=>({...s,coordinateAccuracy:'area'}))};
  assert(api.html(p).includes('confirm the exact meeting points'));const html=api.legHTML(p,p.legs[0]);assert(html.includes('Area directions'));assert(html.includes('confirm meeting points'));
  app.innerHTML=html;const url=new URL(app.querySelector('a').href);assert.equal(url.searchParams.get('destination'),'Yu Garden, Shanghai');assert.equal(url.searchParams.get('origin'),'The Bund, Shanghai');
  assert.equal(new URL(api.directions(null,{...plan.stops[1],coordAccuracy:'area',city:'Shanghai'})).searchParams.get('destination'),'Yu Garden, Shanghai');
});
test('untrusted titles, city, session IDs and tooltips cannot inject HTML or handlers',()=>{
  const p={...plan,city:'<img src=x onerror=alert(1)>',stops:[{...plan.stops[0],sessionId:'x" onclick="alert(1)',title:'<img src=x onerror=alert(1)>'}]};
  const map=render(p);assert.equal(app.querySelectorAll('img:not(.leaflet-tile)').length,0);assert.equal(app.querySelectorAll('[onclick],[onerror]').length,0);
  assert.equal(app.querySelector('[data-act="jrStop"]').dataset.a,p.stops[0].sessionId);const tooltip=markers(map)[0].getTooltip().getContent();assert.equal(tooltip.childElementCount,0);assert.equal(tooltip.textContent,p.stops[0].title);
});
test('tile failures are visible; missing Leaflet keeps accessible itinerary chips',()=>{
  const map=render();const tiles=Object.values(map._layers).find(l=>l instanceof w.L.TileLayer);tiles.fire('tileerror');assert(app.querySelector('[data-jr-status]').textContent.includes('Street map unavailable'));
  tiles.fire('tileload');assert.equal(app.querySelector('[data-jr-status]').hidden,false);
  const saved=w.L;delete w.L;assert.equal(render(),null);assert(app.textContent.includes('map could not load'));assert.equal(app.querySelectorAll('[data-act="jrStop"]').length,4);w.L=saved;
});
test('rendering and mounting never mutate saved plan, prices, consent or booking state',()=>{
  const before=JSON.stringify(plan);render(plan,{selectedDay:1});api.legHTML(plan,plan.legs[0]);api.directions(plan.stops[0],plan.stops[1]);assert.equal(JSON.stringify(plan),before);
});
w.close();console.log('Route map checks passed: '+passed);
