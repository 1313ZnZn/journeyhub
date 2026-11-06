/* Read-only itinerary maps. Coordinates and travel estimates come from the saved plan. */
const jrColors=Object.freeze(['#21664e','#b25d3d','#4d69ac','#895c9d']);
const jrSafe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jrDate=value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;
  const n=Date.parse(value+'T12:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value?n:null;
};
function jrStopDate(stop){
  if(jrDate(stop?.date)!==null)return stop.date;
  if(jrDate(stop?.localDate)!==null)return stop.localDate;
  if(!stop?.startsAt||!Number.isFinite(Date.parse(stop.startsAt)))return null;
  try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:stop.timeZone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(stop.startsAt));return ['year','month','day'].map(type=>parts.find(p=>p.type===type)?.value).join('-');}catch{return null;}
}
function jmRouteStopDay(plan,stop){
  const start=jrDate(plan?.date),date=jrDate(jrStopDate(stop));
  if(start!==null&&date!==null){const day=Math.round((date-start)/86400000)+1;if(day>=1&&day<=4)return day;}
  const index=Number(stop?.dayIndex);return Number.isInteger(index)&&index>=1&&index<=4?index:1;
}
function jrCoord(stop){
  const valid=value=>(typeof value==='number'||typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value))&&Number.isFinite(Number(value));
  if(!valid(stop?.lat)||!valid(stop?.lng))return null;
  const lat=Number(stop.lat),lng=Number(stop.lng);
  return Math.abs(lat)<=85.05112878&&Math.abs(lng)<=180?[lat,lng]:null;
}
const jrArea=stop=>stop?.coordinateAccuracy==='area'||stop?.coordAccuracy==='area';
const jrLocation=(stop,planCity='')=>jrArea(stop)?[stop.venue||stop.title,stop.city||planCity].filter(Boolean).join(', '):jrCoord(stop)?.join(',');
function jrCount(plan){
  const count=Math.max(1,...(Array.isArray(plan?.stops)?plan.stops:[]).map(s=>jmRouteStopDay(plan,s)));
  return Math.min(4,Math.max(count,Number.isInteger(plan?.days)?plan.days:1));
}
function jrSelection(plan,value){const n=Number(value);return value!=='all'&&Number.isInteger(n)&&n>=1&&n<=jrCount(plan)?n:'all';}
function jrEntries(plan,selectedDay='all'){
  const day=jrSelection(plan,selectedDay);
  return (Array.isArray(plan?.stops)?plan.stops:[]).map((stop,index)=>({stop,index,day:jmRouteStopDay(plan,stop),coords:jrCoord(stop)})).filter(item=>day==='all'||item.day===day);
}
function jrDayDate(plan,index){
  const date=jrDate(plan?.date);if(date===null)return '';
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date+(index-1)*86400000));
}
function jmRouteDirections(from,to,mode='walk'){
  const destination=jrCoord(to),origin=jrCoord(from);if(!destination)return '';
  const destinationQuery=jrLocation(to);if(!destinationQuery)return '';
  const params=new URLSearchParams({api:'1',destination:destinationQuery,travelmode:mode==='drive'?'driving':'walking'});
  if(origin&&jrLocation(from))params.set('origin',jrLocation(from));
  return 'https://www.google.com/maps/dir/?'+params.toString();
}
function jmRouteLegHTML(plan,leg){
  if(!leg)return '';const stops=Array.isArray(plan?.stops)?plan.stops:[],from=stops.find(s=>s.sessionId===leg.fromSessionId),to=stops.find(s=>s.sessionId===leg.toSessionId);
  if(!from||!to||jmRouteStopDay(plan,from)!==jmRouteStopDay(plan,to))return '';
  const duration=typeof leg.durationMinutes==='number'&&Number.isFinite(leg.durationMinutes)&&leg.durationMinutes>=0?Math.round(leg.durationMinutes):null;
  const distance=typeof leg.distanceKm==='number'&&Number.isFinite(leg.distanceKm)&&leg.distanceKm>=0?leg.distanceKm:null;
  const mode=leg.mode==='drive'?'drive':'walk',url=jmRouteDirections({...from,city:from.city||plan.city},{...to,city:to.city||plan.city},mode),area=jrArea(from)||jrArea(to);
  return '<div class="jr-leg"><span class="jr-leg-icon" aria-hidden="true">'+(mode==='drive'?'<svg viewBox="0 0 20 20"><path d="m4 7 1.5-4h9L16 7M3 8h14v7H3zM5 15v2m10-2v2M6 11h.01M14 11h.01"/></svg>':'<svg viewBox="0 0 20 20"><circle cx="11" cy="3" r="1.5"/><path d="m7 17 3-6 3 3 1 3M6 10l2-4 4 1 3 4M10 7l-1 5"/></svg>')+'</span><span><b>'+ (duration===null?'Travel time unavailable':duration+' min '+(mode==='drive'?'drive':'walk'))+'</b><small>'+(distance===null?'':distance.toFixed(1)+' km · ')+'Estimated · '+(area?'confirm meeting points':'check live directions')+'</small></span>'+(url?'<a href="'+jrSafe(url)+'" target="_blank" rel="noopener noreferrer">'+(area?'Area directions':'Directions')+' <span aria-hidden="true">↗</span></a>':'')+'</div>';
}
function jmRouteMapHTML(plan,options={}){
  const count=jrCount(plan),day=jrSelection(plan,options.selectedDay??'all'),entries=jrEntries(plan,day),plotted=entries.filter(s=>s.coords),missing=entries.length-plotted.length;
  const title=day==='all'?'Your route at a glance':'Day '+day+' · '+jrDayDate(plan,day),areas=entries.some(e=>jrArea(e.stop));
  return '<section class="jr-route" aria-label="Itinerary route map"><div class="jr-route-heading"><div><span class="jr-eyebrow">THE WAY THROUGH</span><h2>'+jrSafe(title)+'</h2></div><span class="jr-stop-count">'+entries.length+' stop'+(entries.length===1?'':'s')+'</span></div><div class="jr-days" role="group" aria-label="Show itinerary day"><button data-act="jrDay" data-a="all" aria-pressed="'+(day==='all')+'"'+(day==='all'?' class="active"':'')+'>Overview</button>'+Array.from({length:count},(_,i)=>'<button data-act="jrDay" data-a="'+(i+1)+'" aria-pressed="'+(day===i+1)+'" style="--jr-day:'+jrColors[i]+'"'+(day===i+1?' class="active"':'')+'><i aria-hidden="true"></i>Day '+(i+1)+'</button>').join('')+'</div><div class="jr-map-shell"><div class="jr-map" data-jr-map tabindex="0" aria-label="Interactive route map for '+jrSafe(plan?.city||'your trip')+'"></div><div class="jr-map-status" data-jr-status role="status">'+(plotted.length?'Loading street map…':'Map coordinates are not available for these stops.')+'</div></div><div class="jr-map-caption"><span><i aria-hidden="true"></i>Dashed links show order, not road routes</span><a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer" aria-label="Report an OpenStreetMap issue">Map issue ↗</a></div>'+(areas?'<p class="jr-missing">Area locations · confirm the exact meeting points with your host.</p>':'')+(missing?'<p class="jr-missing">'+missing+' stop'+(missing===1?' has':'s have')+' no map coordinates. See the itinerary below.</p>':'')+(entries.length?'<div class="jr-stop-chips" role="group" aria-label="Select a stop">'+entries.map(({stop,index,day:stopDay,coords})=>'<button data-act="jrStop" data-a="'+jrSafe(stop.sessionId)+'" aria-pressed="'+(options.selectedStop===stop.sessionId)+'" style="--jr-day:'+jrColors[stopDay-1]+'"'+(options.selectedStop===stop.sessionId?' class="active"':'')+'><i>'+(index+1)+'</i><span>'+jrSafe(stop.title||stop.venue||'Stop '+(index+1))+'</span>'+(!coords?'<small>Unmapped</small>':'')+'</button>').join('')+'</div>':'<p class="jr-missing">There are no sessions on this day.</p>')+'</section>';
}
const jrViewCache=new Map();
let jrMounted=null;
function jrRemember(key,value){jrViewCache.delete(key);jrViewCache.set(key,value);while(jrViewCache.size>20)jrViewCache.delete(jrViewCache.keys().next().value);}
function jrUnmount(){if(!jrMounted)return;const current=jrMounted;jrMounted=null;try{current.map.remove();}catch{}}
function jmRouteMapMount(plan,options={}){
  jrUnmount();const container=document.querySelector('[data-jr-map]');if(!container)return null;
  const status=container.parentElement.querySelector('[data-jr-status]'),entries=jrEntries(plan,options.selectedDay??'all'),points=entries.filter(e=>e.coords),day=jrSelection(plan,options.selectedDay??'all');
  const unavailable=text=>{status.textContent=text;status.hidden=false;container.classList.add('jr-map-unavailable');};
  if(!points.length){unavailable('Map coordinates are not available for these stops.');return null;}
  const L=window.L;if(!L?.map){unavailable('The map could not load. Your itinerary is still available below.');return null;}
  const cacheKey=JSON.stringify([options.owner??'',options.runId??'',day,points.map(p=>[p.stop.sessionId,p.coords])]);
  let map;
  try{
    map=L.map(container,{zoomControl:true,attributionControl:true,scrollWheelZoom:false,keyboard:true,minZoom:2,maxZoom:18,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false});
    jrMounted={map,container};
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,keepBuffer:1,updateWhenIdle:true,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'});
    let loaded=false,failed=false;
    tiles.on('tileload',()=>{loaded=true;if(failed)status.textContent='Some map tiles are unavailable.';else status.hidden=true;});
    tiles.on('tileerror',()=>{failed=true;status.textContent=loaded?'Some map tiles are unavailable.':'Street map unavailable · stop positions are still shown.';status.hidden=false;});
    tiles.addTo(map);
    for(let index=1;index<=jrCount(plan);index++){
      // Never connect across a missing coordinate: it would imply a skipped route stop.
      let segment=[];const flush=()=>{if(segment.length>1)L.polyline(segment,{color:jrColors[index-1],weight:4,opacity:.85,dashArray:'6 8',interactive:false}).addTo(map);segment=[];};
      entries.filter(e=>e.day===index).forEach(entry=>{if(entry.coords)segment.push(entry.coords);else flush();});flush();
    }
    points.forEach(entry=>{
      const {stop,index,day:stopDay,coords}=entry,selected=options.selectedStop===stop.sessionId;
      const marker=L.marker(coords,{title:'Stop '+(index+1)+': '+String(stop.title||stop.venue||''),alt:'Stop '+(index+1),keyboard:true,riseOnHover:true,zIndexOffset:selected?1000:0,icon:L.divIcon({className:'jr-map-pin'+(selected?' is-selected':''),html:'<span style="--jr-day:'+jrColors[stopDay-1]+'">'+(index+1)+'</span>',iconSize:[32,36],iconAnchor:[16,33]})}).addTo(map);
      const tip=document.createElement('span');tip.textContent=String(stop.title||stop.venue||'Stop '+(index+1))+(jrArea(stop)?' · area reference':'');marker.bindTooltip(tip,{direction:'top',offset:[0,-29]});
      marker.on('click',()=>{if(typeof A!=='undefined'&&typeof A.jrStop==='function')A.jrStop(stop.sessionId);});
    });
    const previous=jrViewCache.get(cacheKey);
    const fitRoute=()=>points.length===1?map.setView(points[0].coords,14,{animate:false}):map.fitBounds(points.map(p=>p.coords),{padding:[34,34],maxZoom:15,animate:false});
    if(previous)map.setView(previous.center,previous.zoom,{animate:false});
    else fitRoute();
    const fit=L.control({position:'topright'});fit.onAdd=()=>{const button=L.DomUtil.create('button','jr-fit-route');button.type='button';button.textContent='Fit route';button.setAttribute('aria-label','Fit all visible stops on the map');L.DomEvent.disableClickPropagation(button);button.addEventListener('click',fitRoute);return button;};fit.addTo(map);
    const selected=points.find(p=>p.stop.sessionId===options.selectedStop);
    if(selected&&previous?.selectedStop!==options.selectedStop)map.panTo(selected.coords,{animate:false});
    const remember=()=>{const c=map.getCenter();jrRemember(cacheKey,{center:[c.lat,c.lng],zoom:map.getZoom(),selectedStop:options.selectedStop??null});};
    map.on('moveend',remember);remember();
    requestAnimationFrame(()=>{if(jrMounted?.map===map&&container.isConnected)map.invalidateSize({pan:false});});
    return map;
  }catch{try{map?.remove();}catch{}jrMounted=null;unavailable('The map could not load. Your itinerary is still available below.');return null;}
}
if(typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(jrMounted&&!jrMounted.container.isConnected)jrUnmount();}).observe(document.body,{childList:true,subtree:true});
window.JourneyRoutes=Object.freeze({html:jmRouteMapHTML,mount:jmRouteMapMount,stopDay:jmRouteStopDay,legHTML:jmRouteLegHTML,directions:jmRouteDirections,coordinates:stop=>jrCoord(stop),colors:jrColors});
