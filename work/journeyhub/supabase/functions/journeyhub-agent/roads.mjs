// Routes are read-only and only consume server-verified itinerary places.
const seconds=value=>typeof value==='string'&&/^\d+(?:\.\d+)?s$/.test(value)?Number(value.slice(0,-1)):NaN;
const minutes=time=>{const [h,m]=time.split(':').map(Number);return h*60+m;};
export async function addRoadRoutes(plan,key,fetcher=fetch){
  const days=Array.from({length:plan.days},(_,i)=>i+1);
  plan.roadRoutes=await Promise.all(days.map(async day=>{
    const stops=plan.stops.filter(s=>s.dayIndex===day),base={day,placeIds:stops.map(s=>s.id)};
    if(stops.length<2)return {...base,status:stops.length?'single_stop':'empty',distanceMeters:0,durationSeconds:0};
    if(!key)return {...base,status:'unavailable',message:'Road routing is not configured.'};
    try{
      const waypoint=p=>({placeId:p.id});
      const response=await fetcher('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.warnings'},body:JSON.stringify({origin:waypoint(stops[0]),destination:waypoint(stops.at(-1)),intermediates:stops.slice(1,-1).map(waypoint),travelMode:plan.transport==='walk'?'WALK':'DRIVE',...(plan.transport==='walk'?{}:{routingPreference:'TRAFFIC_UNAWARE'}),computeAlternativeRoutes:false,polylineQuality:'OVERVIEW',languageCode:'en-US',units:'METRIC'}),signal:AbortSignal.timeout(18000),redirect:'error'});
      if(!response.ok){await response.body?.cancel();return {...base,status:'unavailable',message:[401,403].includes(response.status)?'Routes API access needs configuration.':'Road route unavailable for these places.'};}
      const data=await response.json(),route=data.routes?.[0],duration=seconds(route?.duration),path=route?.polyline?.encodedPolyline;
      if(!route||!Number.isFinite(route.distanceMeters)||route.distanceMeters<0||!Number.isFinite(duration)||typeof path!=='string'||!path||path.length>150000||!Array.isArray(route.legs)||route.legs.length!==stops.length-1)throw Error('invalid route');
      const legs=route.legs.map((leg,i)=>{const durationSeconds=seconds(leg.duration);if(!Number.isFinite(durationSeconds)||!Number.isFinite(leg.distanceMeters)||leg.distanceMeters<0)throw Error('invalid leg');return {fromId:stops[i].id,toId:stops[i+1].id,distanceMeters:leg.distanceMeters,durationSeconds,durationMinutes:Math.ceil(durationSeconds/60),mode:plan.transport,estimated:false,source:'Google Routes',trafficAware:false};});
      for(let i=0;i<legs.length;i++){const leg=legs[i],next=stops[i+1];next.travel=leg;next.travelConflict=minutes(next.start)-minutes(stops[i].end)<leg.durationMinutes+10;}
      return {...base,status:'ready',distanceMeters:route.distanceMeters,durationSeconds:duration,encodedPolyline:path,legs,warnings:(route.warnings||[]).filter(x=>typeof x==='string').slice(0,5).map(x=>x.slice(0,800)),trafficAware:false};
    }catch{return {...base,status:'unavailable',message:'Road routing could not complete. Place locations are still available.'};}
  }));
  return plan;
}
