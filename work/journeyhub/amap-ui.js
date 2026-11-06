/* Keep GCJ-02 Amap locations on an Amap canvas; Google histories retain Google Maps. */
let amLibrary=null,amExpires=0,amPending=null,amOwner=null;
function amLoad(){
 const ctx=pd,owner=ctx.owner;
 if(amPending){if(amPending.owner===owner)return amPending.promise;return amPending.promise.catch(()=>{}).then(()=>{if(!pdCurrent(ctx))throw Error('Please reopen your itinerary.');return amLoad();});}
 if(amLibrary&&amOwner===owner&&Date.now()<amExpires)return Promise.resolve(amLibrary);
 const pending={owner,promise:null};
 pending.promise=(async()=>{
  const config=await pdRequest({action:'amap_config'},ctx,15000);
  if(!pdCurrent(ctx))throw Error('Please reopen your itinerary.');
  if(!config.ready||!config.browserKey||!config.serviceHost)throw Error('Amap browser access is not configured.');
  window._AMapSecurityConfig={serviceHost:config.serviceHost};amExpires=config.expires-60000;
  if(window.AMap?.Map)return window.AMap;
  return new Promise((resolve,reject)=>{const script=document.createElement('script');let done=false;const timer=setTimeout(()=>finish(Error('Amap did not load. Please retry.')),20000);function finish(error){if(done)return;done=true;clearTimeout(timer);delete window.jhAmapReady;if(error){script.remove();reject(error);}else resolve(window.AMap);}window.jhAmapReady=result=>finish(window.AMap?.Map?null:Error(result?.infocode==='10006'?'Amap does not allow this website yet. Add this domain to the browser key whitelist.':'Amap is unavailable. Check the browser key configuration.'));script.onerror=()=>finish(Error('Amap could not load. Check your connection.'));script.src='https://webapi.amap.com/maps?'+new URLSearchParams({v:'2.0',key:config.browserKey,callback:'jhAmapReady'});document.head.append(script);});
 })().then(library=>{if(!pdCurrent(ctx))throw Error('Please reopen your itinerary.');amLibrary=library;amOwner=owner;return library;}).catch(e=>{amLibrary=null;amExpires=0;amOwner=null;throw e;}).finally(()=>{if(amPending===pending)amPending=null;});
 amPending=pending;return pending.promise;
}
async function amMount(plan){
 const ctx=pd,placeholder=document.querySelector('[data-pm-map]'),status=document.querySelector('[data-pm-status]'),generation=++pmGeneration;if(!placeholder)return;
 try{
  const located=plan.stops.filter(pmLocated);if(!located.length&&pmRefreshing(plan)){status.hidden=false;status.textContent='Updating map details…';return;}if(!located.length)throw Error('Place locations could not be refreshed. Your schedule is available below.');
  const maps=await amLoad();if(generation!==pmGeneration||!pdCurrent(ctx)||ctx.plan!==plan||!placeholder.isConnected)return;
  if(pmActive&&(pmActive.plan!==plan||pmActive.owner!==ctx.owner||pmActive.provider!=='amap'))pmClear();
  if(!pmActive){const map=new maps.Map(placeholder,{center:[located[0].lng,located[0].lat],zoom:12,lang:'en',viewMode:'2D',scrollWheel:false,dragEnable:false,touchZoom:true});pmActive={provider:'amap',plan,owner:ctx.owner,host:placeholder,map,markers:[],lines:[]};map.on('error',()=>{if(status.isConnected){status.hidden=false;status.textContent='Amap could not load for this website. Your itinerary remains available below.';}});}
  else placeholder.replaceWith(pmActive.host);
  const active=pmActive,selection=JSON.stringify([ctx.day,ctx.mapStop||null]);status.hidden=true;if(active.selection===selection)return;active.selection=selection;
  active.map.remove([...active.markers,...active.lines]);active.markers=[];active.lines=[];
  const stops=plan.stops.filter(s=>(ctx.day==='all'||s.dayIndex===ctx.day)&&pmLocated(s));
  for(const stop of stops){const number=plan.stops.filter(s=>s.dayIndex===stop.dayIndex).findIndex(s=>s.id===stop.id)+1,node=document.createElement('button');node.className='pm-pin'+(ctx.mapStop===stop.id?' selected':'');node.style.background=pmColors[stop.dayIndex-1];node.textContent=number;node.setAttribute('aria-label',stop.name);const marker=new maps.Marker({position:[stop.lng,stop.lat],content:node,anchor:'center',title:stop.name});marker.on('click',()=>{if(pdCurrent(ctx)&&ctx.plan===plan)A.pmSelect(stop.id);});active.markers.push(marker);}
  for(const route of plan.roadRoutes||[]){if(route.status!=='ready'||route.source!=='Amap'||ctx.day!=='all'&&ctx.day!==route.day||!Array.isArray(route.path))continue;active.lines.push(new maps.Polyline({path:route.path,strokeColor:pmColors[route.day-1],strokeWeight:5,strokeOpacity:.9}));}
  active.map.add([...active.markers,...active.lines]);pmFit();if(!stops.length){status.hidden=false;status.textContent=pmRefreshing(plan)?'Updating map details…':'No map locations are available for this day.';}
 }catch(error){if(placeholder.isConnected&&pdCurrent(ctx)){status.hidden=false;status.textContent=error.message;}}
}
