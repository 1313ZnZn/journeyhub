/* Google place data is displayed only on Google Maps. Map state is session-only. */
const pmColors=['#7854d4','#1f9c94','#83b72a','#d34d9d'];
let pmLibrary=null,pmActive=null,pmGeneration=0,pmAuthError='';
const pmLocated=stop=>Number.isFinite(stop.lat)&&Number.isFinite(stop.lng)&&Math.abs(stop.lat)<=90&&Math.abs(stop.lng)<=180;
const pmRefreshing=plan=>pd.plan===plan&&(pd.snapshot?.refreshNeeded===true||pd.snapshot?.stale===true)&&(typeof thSnapshotUpdating!=='function'||thSnapshotUpdating(pd.historyId));
function pmAuthFailure(){
  pmAuthError='Map access is unavailable for this website. Your itinerary is still available below.';
  const node=document.querySelector('[data-pm-status]');if(node){node.hidden=false;node.textContent=pmAuthError;}
}
function pmDecode(encoded){
  const path=[];let index=0,lat=0,lng=0;
  const value=()=>{let result=0,shift=0,b;do{if(index>=encoded.length||shift>30)throw Error('Invalid route shape');b=encoded.charCodeAt(index++)-63;if(b<0||b>63)throw Error('Invalid route shape');result|=(b&31)<<shift;shift+=5;}while(b>=32);return result&1?~(result>>1):result>>1;};
  while(index<encoded.length){lat+=value();lng+=value();if(Math.abs(lat)>9000000||Math.abs(lng)>18000000)throw Error('Invalid route coordinates');path.push({lat:lat/1e5,lng:lng/1e5});}return path;
}
async function pmLoad(){
  if(pmAuthError)throw Error(pmAuthError);
  if(window.google?.maps?.Map)return window.google.maps;
  if(pmLibrary)return pmLibrary;
  pmLibrary=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let config;
    try{const response=await fetch(jhConfig.url+'/functions/v1/journeyhub-agent?action=maps_config',{headers:{apikey:jhConfig.publishableKey},signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('Map configuration could not load.');config=await response.json();}finally{clearTimeout(timer);}
    if(!config.ready||!config.browserKey)throw Error('The browser map key needs configuration. Your itinerary is still available below.');
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.async=true;let ended=false;
      const timeout=setTimeout(()=>finish(Error('Google Maps did not load. Check your connection and retry.')),20000);
      function finish(error){if(ended)return;ended=true;clearTimeout(timeout);delete window.pdGoogleMapsReady;if(error){script.remove();reject(error);}else resolve(window.google.maps);}
      window.pdGoogleMapsReady=()=>finish(window.google?.maps?.Map?null:Error('Google Maps is unavailable.'));
      window.gm_authFailure=()=>{pmAuthFailure();finish(Error(pmAuthError));};
      script.onerror=()=>finish(Error('Google Maps could not load. Check your connection.'));
      script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key:config.browserKey,v:'weekly',loading:'async',libraries:'marker',callback:'pdGoogleMapsReady',language:'en'});document.head.append(script);
    });
  })().catch(error=>{pmLibrary=null;throw error;});return pmLibrary;
}
function pmClear(){pmGeneration++;if(pmActive?.provider==='amap'){pmActive.map.destroy();pmActive=null;return;}if(pmActive){for(const m of pmActive.markers)m.map=null;for(const l of pmActive.lines)l.setMap(null);pmActive.info?.close();pmActive=null;}}
function pmHTML(plan){
  const provider=plan.stops.some(s=>s.source==='Amap'||s.id?.startsWith('amap_'))?'Amap':'Google Maps';
  const days=Array.from({length:plan.days},(_,i)=>i+1),routes=plan.roadRoutes||[],refreshing=pmRefreshing(plan);
  return '<section class="pm-route"><div class="pm-map-shell"><div data-pm-map class="pm-map" aria-label="Interactive '+provider+' map of your itinerary"></div><div data-pm-status class="pm-status" role="status">'+(refreshing?'Updating map details…':'Loading '+provider+'…')+'</div><button class="pm-fit" data-act="pmFit" aria-label="Fit all visible places">'+ic('globe',16)+'</button></div><div class="pm-legend"><button data-act="pdDay" data-a="all" aria-pressed="'+(pd.day==='all')+'">All days</button>'+days.map(day=>{const r=routes.find(r=>r.day===day),distance=plan.sample?'Sample stops':r?.status==='ready'?(r.distanceMeters/1000).toFixed(1)+' km':r?.status==='single_stop'?'One stop':r?.status==='empty'?'No stops scheduled':refreshing?'Updating…':'Route unavailable';return '<button data-act="pdDay" data-a="'+day+'" style="--pm-color:'+pmColors[day-1]+'" aria-pressed="'+(pd.day===day)+'"><i></i>Day '+day+'<small>'+distance+'</small></button>';}).join('')+'</div><p class="pm-caption">'+(plan.sample?'Sample catalog locations · No road routes calculated':refreshing?'Saved itinerary · Updating map details':'Road routes from '+provider+' · Check travel times before departure')+'</p>'+routes.filter(r=>(pd.day==='all'||r.day===pd.day)&&r.status==='unavailable').map(r=>'<p class="pm-warning">Day '+r.day+': '+esc(r.message)+'</p>').join('')+routes.filter(r=>pd.day==='all'||r.day===pd.day).flatMap(r=>r.warnings||[]).map(w=>'<p class="pm-warning">'+esc(w)+'</p>').join('')+'<button class="btn-text pm-retry" data-act="pmRetry">Reload map</button></section>';
}
function pmFit(){if(pmActive?.provider==='amap'){pmActive.map.setFitView([...pmActive.markers,...pmActive.lines],false,[48,48,48,48]);return;}if(pmActive?.bounds&&!pmActive.bounds.isEmpty())pmActive.map.fitBounds(pmActive.bounds,48);}
A.pmFit=pmFit;A.pmRetry=()=>{pmAuthError='';pmLibrary=null;pmClear();if((pd.snapshot?.refreshNeeded||pd.snapshot?.stale)&&typeof A.thRefreshDetails==='function')A.thRefreshDetails(pd.historyId);render();};
A.pmSelect=id=>{const p=pd.plan,s=p?.stops.find(s=>s.id===id);if(!s)return;pd.mapStop=id;pd.day=s.dayIndex;render();};
async function pmMount(plan){
  if(plan?.stops.some(s=>s.id?.startsWith('amap_')))return amMount(plan);
  const ctx=pd,placeholder=document.querySelector('[data-pm-map]'),status=document.querySelector('[data-pm-status]'),generation=++pmGeneration;
  if(!placeholder||!plan)return;
  try{
    const located=plan.stops.filter(pmLocated);if(!located.length&&pmRefreshing(plan)){status.hidden=false;status.textContent='Updating map details…';return;}if(!located.length)throw Error('Place locations could not be refreshed. Your saved schedule is still available below.');
    const maps=await pmLoad();if(generation!==pmGeneration||!pdCurrent(ctx)||ctx.plan!==plan||!placeholder.isConnected)return;
    if(pmActive&&(pmActive.plan!==plan||pmActive.owner!==ctx.owner))pmClear();
    if(!pmActive){pmActive={plan,owner:ctx.owner,host:placeholder,map:new maps.Map(placeholder,{center:{lat:located[0].lat,lng:located[0].lng},zoom:12,mapId:'DEMO_MAP_ID',mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:'cooperative'}),markers:[],lines:[],info:new maps.InfoWindow()};}
    else placeholder.replaceWith(pmActive.host);
    const active=pmActive,selection=JSON.stringify([ctx.day,ctx.mapStop||null]),dayStops=plan.stops.filter(s=>ctx.day==='all'||s.dayIndex===ctx.day),visible=dayStops.filter(pmLocated),missing=visible.length<dayStops.length;
    const showStatus=()=>{status.hidden=!missing;if(missing)status.textContent=pmRefreshing(plan)?'Updating map details…':'Some place locations are unavailable. Your saved schedule is preserved below.';};
    // Background account/catalog refreshes must not dismiss an open place popup
    // or reset the visitor's map position when the displayed selection is unchanged.
    if(active.selection===selection){showStatus();return;}
    active.selection=selection;for(const m of active.markers)m.map=null;for(const l of active.lines)l.setMap(null);active.markers=[];active.lines=[];active.info.close();
    const bounds=new maps.LatLngBounds();active.bounds=bounds;
    for(const stop of visible){
      const dayStops=plan.stops.filter(s=>s.dayIndex===stop.dayIndex),number=dayStops.findIndex(s=>s.id===stop.id)+1,color=pmColors[stop.dayIndex-1],node=document.createElement('button');node.className='pm-pin'+(ctx.mapStop===stop.id?' selected':'');node.style.background=color;node.textContent=String(number);node.setAttribute('aria-label','Day '+stop.dayIndex+', stop '+number+': '+stop.name);
      const marker=new maps.marker.AdvancedMarkerElement({map:active.map,position:{lat:stop.lat,lng:stop.lng},title:stop.name,content:node,zIndex:ctx.mapStop===stop.id?1000:stop.dayIndex*10+number});
      marker.addListener('click',()=>{if(!pdCurrent(ctx)||ctx.plan!==plan)return;const content=document.createElement('div');content.className='pm-info';const title=document.createElement('strong');title.textContent=stop.name;const caption=document.createElement('p');caption.textContent='Day '+stop.dayIndex+' · '+stop.start+'–'+stop.end;const button=document.createElement('button');button.textContent='View in itinerary';button.onclick=()=>A.pmSelect(stop.id);content.append(title,caption,button);active.info.setContent(content);active.info.open({map:active.map,anchor:marker});});
      active.markers.push(marker);bounds.extend({lat:stop.lat,lng:stop.lng});
    }
    for(const route of plan.roadRoutes||[]){if(route.status!=='ready'||ctx.day!=='all'&&route.day!==ctx.day)continue;try{const path=pmDecode(route.encodedPolyline);active.lines.push(new maps.Polyline({map:active.map,path,strokeColor:pmColors[route.day-1],strokeOpacity:.9,strokeWeight:5,geodesic:false}));for(const point of path)bounds.extend(point);}catch{/* Do not draw invented straight lines when a provider shape is invalid. */}}
    showStatus();pmFit();
    if(ctx.mapStop){const row=[...document.querySelectorAll('[data-pm-stop]')].find(el=>el.dataset.pmStop===ctx.mapStop);row?.scrollIntoView({block:'nearest',behavior:'smooth'});}
  }catch(error){if(placeholder.isConnected&&pdCurrent(ctx)){status.hidden=false;status.textContent=error.message;}}
}
const pmView=V['place-plan'];
V['place-plan']=()=>{
  const view=pmView(),p=pd.plan;if(!p)return view;
  const template=document.createElement('template');template.innerHTML=view.body;const root=template.content.querySelector('.pd-plan');if(!root)return view;
  const days=root.querySelector('.jr-days');days?.remove();root.insertAdjacentHTML('afterbegin',pmHTML(p));
  const visible=p.stops.filter(s=>pd.day==='all'||s.dayIndex===pd.day);
  root.querySelectorAll('.pd-stop').forEach((el,i)=>{const s=visible[i];if(!s)return;el.dataset.pmStop=s.id;el.classList.toggle('pm-selected',pd.mapStop===s.id);const title=el.querySelector('h3');const button=document.createElement('button');button.className='pm-stop-link';button.dataset.act='pmSelect';button.dataset.a=s.id;button.textContent=s.name;title.replaceChildren(button);if(s.travelConflict)el.insertAdjacentHTML('afterbegin','<p class="pm-warning">Allow more transfer time before this stop. Suggested times need adjusting.</p>');});
  root.querySelectorAll('.pd-transfer').forEach((el,i)=>{const s=visible.filter(s=>s.travel)[i],t=s?.travel;if(['Google Routes','Amap'].includes(t?.source))el.textContent=t.durationMinutes+' min '+t.mode+' · '+(t.distanceMeters/1000).toFixed(1)+' km · '+t.source;});
  view.body=template.innerHTML;const after=view.after;view.after=()=>{after?.();pmMount(p);};return view;
};
const pmRender=render;
render=function(){if(pmActive&&(pmActive.owner!==jhUser?.id||pmActive.plan!==pd.plan))pmClear();pmRender();};
