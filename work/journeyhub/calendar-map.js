/* An independent, lazy Calendar map. Shares SDKs and hydrated data, never pd. */
let cMapActive=null,cMapPending=null,cMapObserver=null,cMapGeneration=0;
function cMapModel(event){
  const saved=event.manageKind==='history'?(cal.details[event.id]?.plan||(pd.owner===jhUser?.id&&pd.historyId===event.id?pd.plan:null)):agPlan(ag.runs.find(r=>r.id===event.id));
  const care=tc.owner===jhUser?.id?tc.trips.find(t=>t.sourceType===event.manageKind&&t.sourceId===event.id):null;
  const acceptedRoutes=care?.roadRoutes||[];
  const savedFallback=(saved?.roadRoutes||[]).filter(r=>!acceptedRoutes.some(a=>a.day===r.day)&&JSON.stringify((saved.stops||[]).filter(s=>s.dayIndex===r.day).map(s=>s.id||s.sessionId))===JSON.stringify((care?.stops||[]).filter(s=>s.dayIndex===r.day).map(s=>s.id||s.sessionId)));
  const plan=care?.stops?.length?{...saved,stops:care.stops,roadRoutes:[...acceptedRoutes,...savedFallback]}:saved;
  const stops=event.stops.map(s=>cvPlace(event,s));
  const amap=stops.some(s=>s.source==='Amap'||s.id?.startsWith('amap_'));
  const located=stops.filter(s=>!s.unavailable&&pmLocated(s)&&(amap?(s.source==='Amap'||s.id?.startsWith('amap_'))&&(s.coordinateSystem==='GCJ-02'||s.source==='Amap'):s.coordinateSystem!=='GCJ-02'));
  const ids=stops.map(s=>s.id),original=(plan?.stops||[]).filter(s=>s.dayIndex===event.day).map(s=>s.id||s.sessionId);
  const sameOrder=JSON.stringify(ids)===JSON.stringify(original);
  const routes=sameOrder?(plan?.roadRoutes||[]).filter(r=>r.day===event.day&&r.status==='ready'&&(!r.placeIds||JSON.stringify(r.placeIds)===JSON.stringify(ids))):[];
  const provider=amap?'Amap':'Google Maps',color=pmColors[(event.day-1)%pmColors.length];
  const key=JSON.stringify([jhUser?.id,event.key,event.date,provider,stops.map(s=>[s.id,s.name,s.start,s.end,s.lat,s.lng,s.coordinateSystem]),routes]);
  return {event,stops,located,routes,provider,color,key,owner:jhUser?.id,pending:typeof thSnapshotUpdating==='function'&&thSnapshotUpdating(event.id)};
}
function cMapDestroy(){
  cMapGeneration++;cMapObserver?.disconnect();cMapObserver=null;cMapPending=null;
  const active=cMapActive;cMapActive=null;if(!active)return;
  if(active.provider==='Amap')active.map.destroy();
  else{active.markers.forEach(m=>m.map=null);active.lines.forEach(l=>l.setMap(null));window.google?.maps?.event?.clearInstanceListeners?.(active.map);}
  active.host.remove();
}
const cMapCurrent=model=>state.route==='orders'&&jhUser?.id===model.owner&&cal.date===model.event.date&&document.querySelector('[data-calendar-map]')?.dataset.key===model.key;
function cMapStatus(message){const node=document.querySelector('[data-calendar-map-status]');if(node){node.hidden=!message;node.textContent=message;}}
const cMapActiveStatus=()=>cMapActive?.error||(cMapActive?.located.length<cMapActive?.stops.length?'Some locations are still unavailable.':cMapActive?.provider==='Google Maps'&&pmAuthError?pmAuthError:'');
function cMapHighlight(id){const row=[...document.querySelectorAll('.cal-schedule-stop')].find(n=>n.dataset.stopId===id);if(!row)return;row.classList.add('cv-highlight');row.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});setTimeout(()=>row.classList.remove('cv-highlight'),1800);}
A.cMapFit=()=>{const a=cMapActive;if(!a)return;if(a.provider==='Amap')a.map.setFitView([...a.markers,...a.lines],false,[42,32,42,32]);else if(a.bounds&&!a.bounds.isEmpty())a.map.fitBounds(a.bounds,38);};
A.cMapRetry=()=>{cMapDestroy();pmAuthError='';pmLibrary=null;amLibrary=null;amExpires=0;render();};
async function cMapMount(model){
  if(!cMapCurrent(model)||cMapPending===model.key)return;
  if(!model.located.length){cMapStatus(model.pending?'Updating map locations…':'Locations unavailable. Your saved visits are still shown above.');return;}
  if(cMapActive?.key===model.key){cMapStatus(cMapActiveStatus());return;}
  if(cMapActive)cMapDestroy();
  const generation=++cMapGeneration;cMapPending=model.key;
  cMapStatus('Loading '+model.provider+'…');
  try{
    const maps=await (model.provider==='Amap'?amLoad():pmLoad());
    if(generation!==cMapGeneration||!cMapCurrent(model))return;
    const host=document.querySelector('[data-calendar-map]'),first=model.located[0];
    const active={...model,host,markers:[],lines:[]};
    if(model.provider==='Amap'){
      active.map=new maps.Map(host,{center:[first.lng,first.lat],zoom:12,lang:'en',viewMode:'2D',scrollWheel:false,dragEnable:false,touchZoom:true});
      active.map.on('error',()=>{active.error='Map access is unavailable. Your itinerary remains available above.';if(cMapActive===active)cMapStatus(active.error);});
      model.located.forEach(stop=>{const pin=document.createElement('button');pin.className='pm-pin';pin.style.background=model.color;pin.textContent=model.stops.findIndex(s=>s.id===stop.id)+1;pin.setAttribute('aria-label',stop.name);const marker=new maps.Marker({position:[stop.lng,stop.lat],content:pin,anchor:'center',title:stop.name});marker.on('click',()=>{if(cMapActive===active&&cMapCurrent(model))cMapHighlight(stop.id);});active.markers.push(marker);});
      for(const route of model.routes)if(route.source==='Amap'&&Array.isArray(route.path)&&route.path.length>=2&&route.path.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))active.lines.push(new maps.Polyline({path:route.path,strokeColor:model.color,strokeWeight:5,strokeOpacity:.9}));
      active.map.add([...active.markers,...active.lines]);
    }else{
      active.map=new maps.Map(host,{center:{lat:first.lat,lng:first.lng},zoom:12,mapId:'DEMO_MAP_ID',mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:'cooperative'});active.bounds=new maps.LatLngBounds();
      model.located.forEach(stop=>{const pin=document.createElement('button');pin.className='pm-pin';pin.style.background=model.color;pin.textContent=model.stops.findIndex(s=>s.id===stop.id)+1;pin.setAttribute('aria-label',stop.name);const marker=new maps.marker.AdvancedMarkerElement({map:active.map,position:{lat:stop.lat,lng:stop.lng},content:pin,title:stop.name});marker.addListener('click',()=>{if(cMapActive===active&&cMapCurrent(model))cMapHighlight(stop.id);});active.markers.push(marker);active.bounds.extend({lat:stop.lat,lng:stop.lng});});
      for(const route of model.routes)if(route.encodedPolyline)try{const path=pmDecode(route.encodedPolyline);active.lines.push(new maps.Polyline({map:active.map,path,strokeColor:model.color,strokeOpacity:.9,strokeWeight:5,geodesic:false}));path.forEach(p=>active.bounds.extend(p));}catch{/* Never substitute a made-up road route. */}
    }
    cMapActive=active;A.cMapFit();
    cMapStatus(cMapActiveStatus());
  }catch(error){if(generation===cMapGeneration&&cMapCurrent(model))cMapStatus(error.message||'Map could not load. Retry below.');}
  finally{if(cMapPending===model.key)cMapPending=null;}
}
function cMapAttach(model){
  const placeholder=document.querySelector('[data-calendar-map]');if(!placeholder||!cMapCurrent(model))return;
  if(cMapActive?.key===model.key){placeholder.replaceWith(cMapActive.host);cMapStatus(cMapActiveStatus());return;}
  if(cMapActive)cMapDestroy();
  cMapObserver?.disconnect();
  if(!model.located.length){cMapStatus(model.pending?'Updating map locations…':'Locations unavailable. Your saved visits are still shown above.');return;}
  if(typeof IntersectionObserver==='undefined'){void cMapMount(model);return;}
  cMapObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){cMapObserver?.disconnect();cMapObserver=null;void cMapMount(model);}},{root:null,rootMargin:'220px'});cMapObserver.observe(placeholder);
}
const cMapPreviousView=V.orders;
V.orders=()=>{
  const view=cMapPreviousView(),event=calEvents().find(e=>e.date===cal.date&&e.kind==='plan');if(!event?.stops?.length)return view;
  const model=cMapModel(event),template=document.createElement('template');template.innerHTML=view.body;
  const plan=template.content.querySelector('.cal-day-plan');if(!plan)return view;
  const section=document.createElement('section');section.className='cal-inline-map';section.setAttribute('aria-label','Selected day route');
  section.innerHTML='<div class="cal-map-heading"><h3>Day '+event.day+' route</h3><span>'+model.located.length+' / '+model.stops.length+' places</span></div><div class="cal-map-shell"><div data-calendar-map class="cal-map-canvas" data-key="'+esc(model.key)+'" aria-label="'+model.provider+' route map"></div><p data-calendar-map-status class="cal-map-status" role="status">'+(model.pending?'Updating map locations…':'Loading map when visible…')+'</p><button class="cal-map-fit" data-act="cMapFit" aria-label="Fit route to map">'+ic('globe',18)+'</button></div><div class="cal-map-footer"><small>'+esc(model.provider)+(model.routes.length?' · Road route':' · Place locations')+'</small><button data-act="cMapRetry">Reload map</button></div>';
  const footer=plan.querySelector(':scope > .cal-event-action');plan.insertBefore(section,footer||null);
  const full=footer?.querySelector('button:not([data-act="cmAsk"])');if(full&&['calOpenHistory','calOpenRun'].includes(full.dataset.act))full.innerHTML='Full itinerary '+ic('right',16);
  view.body=template.innerHTML;const after=view.after;view.after=()=>{after?.();cMapAttach(model);};return view;
};
const cMapPreviousRender=render;
render=function(){
  if(cMapActive&&(state.route!=='orders'||cMapActive.owner!==jhUser?.id||cMapActive.event.date!==cal.date))cMapDestroy();
  else cMapActive?.host.remove();
  cMapPreviousRender();
  if(cMapActive&&!document.querySelector('[data-calendar-map]'))cMapDestroy();
};
const cMapPreviousAuthFailure=pmAuthFailure;
pmAuthFailure=function(){cMapPreviousAuthFailure();if(cMapActive?.provider==='Google Maps')cMapStatus(pmAuthError);};
