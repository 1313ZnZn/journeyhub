import {fail} from './planner.mjs';
import {amapBusiness} from './amap-business.mjs';
export const isAmap=id=>typeof id==='string'&&/^amap_[A-Za-z0-9]+$/.test(id);
export const amapURL=id=>'https://www.amap.com/place/'+encodeURIComponent(id.replace(/^amap_/,''));
const text=(v,n=400)=>typeof v==='string'?v.slice(0,n):'';
// Pace each endpoint within an isolate. Bounded backoff also handles account-wide
// contention from other Edge isolates or services; this is not a global quota lock.
export function createAmapTransport({fetcher=fetch,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),random=Math.random,gapMs=1200}={}){
 const queues=new Map();
 function schedule(path,task){
  let lane=queues.get(path);if(!lane){lane={tail:Promise.resolve(),last:0};queues.set(path,lane);}
  const started=now();
  const pending=lane.tail.catch(()=>{}).then(async()=>{
   if(now()-started>45000)fail('AMAP_RATE_LIMITED','Place search is busy. Your choices are saved; please try creating your plan again shortly.',429);
   const delay=gapMs-(now()-lane.last);if(delay>0)await wait(delay);lane.last=now();return task();
  });lane.tail=pending.catch(()=>{});return pending;
 }
 return async function(path,params,key){
  if(!key)fail('AMAP_NOT_CONFIGURED','Amap place search is not configured.',503);
  const url=new URL('https://restapi.amap.com'+path);url.search=new URLSearchParams({...params,key}).toString();
  for(let attempt=0;attempt<3;attempt++){
   const data=await schedule(path,async()=>{
    let r;try{r=await fetcher(url.href,{signal:AbortSignal.timeout(18000),redirect:'error'});}catch{fail('AMAP_UNAVAILABLE','Amap did not respond. Please retry.',503);}
    if(r.status===429){await r.body?.cancel();return {status:'0',infocode:'10021'};}
    if(!r.ok){await r.body?.cancel();fail('AMAP_UNAVAILABLE','Amap is temporarily unavailable.',503);}
    const reader=r.body.getReader();let size=0,parts=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1500000){await reader.cancel();fail('AMAP_UNAVAILABLE','Amap returned an oversized response.',502);}parts.push(value);}
    const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('AMAP_UNAVAILABLE','Amap returned an unreadable response.',502);}
   });
   if(data.status==='1')return data;
   if(['10014','10015','10019','10020','10021','10022'].includes(String(data.infocode))){
    if(attempt===2)fail('AMAP_RATE_LIMITED','Place search is temporarily busy (rate limit). Your choices are saved; please try creating your plan again shortly.',429);
    await wait(1500*2**attempt+Math.floor(random()*600));continue;
   }
   if(data.infocode==='10003')fail('AMAP_DAILY_LIMIT','The map service has reached its daily quota. Your choices are saved; please try later.',503);
   fail('AMAP_UNAVAILABLE','Amap request failed'+(/^\d{5}$/.test(data.infocode)?' (code '+data.infocode+')':'')+'. Check the Web service key configuration.',503);
  }
 };
}
const transports=new WeakMap();
export function amapJSON(path,params,key,fetcher=fetch){let transport=transports.get(fetcher);if(!transport){transport=createAmapTransport({fetcher});transports.set(fetcher,transport);}return transport(path,params,key);}
export function amapRecord(raw,city='Shanghai'){
 const [lng,lat]=String(raw?.location||'').split(',').map(Number);
 if(city!=='Shanghai'||!raw?.name||!/^B[A-Za-z0-9]+$/.test(raw.id)||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<30.68||lat>31.88||lng<120.85||lng>122)return null;
 const id='amap_'+raw.id,photos=(Array.isArray(raw.photos)?raw.photos:[]).flatMap(p=>{try{const u=new URL(p.url);if(!['http:','https:'].includes(u.protocol)||!/(^|\.)(amap\.com|autonavi\.com|aoscdn\.com)$/.test(u.hostname))return [];u.protocol='https:';return [u.href];}catch{return [];}}).slice(0,5);
 const type=String(raw.typecode||'').split(/[;|,]/);const has=prefix=>type.some(code=>code.trim().startsWith(prefix));const kind=has('05')?'restaurant':String(raw.type||'').includes('博物馆')?'museum':has('11')?'tourist attraction':has('06')?'shopping':has('10')?'hotel':'place';
 return {id,name:text(raw.name,160),originalName:text(raw.name,160),address:[raw.pname,raw.cityname,raw.adname,raw.address].filter(v=>typeof v==='string'&&v).filter((v,i,a)=>a.indexOf(v)===i).join(' ').slice(0,400),lat,lng,coordinateSystem:'GCJ-02',kind,source:'Amap',sourceURL:amapURL(id),...amapBusiness(raw),attributions:[{provider:'Amap',uri:'https://www.amap.com/'}],bookable:false,photo:photos.length?{url:photos[0],alternatives:photos.slice(1),authors:[]}:null};
}
async function poiLookup(method, modern, legacy, key, fetcher) {
  try {
    return await amapJSON('/v5/place/'+method,{...modern,show_fields:'business,photos'},key,fetcher);
  } catch (error) {
    // A key with only legacy POI access can still show the original place.
    if (!/code (10012|10041)\)/.test(error.message)) throw error;
    return amapJSON('/v3/place/'+method,{...legacy,extensions:'all'},key,fetcher);
  }
}
export async function amapSearch(query,key,fetcher) {
  const keywords=query.slice(0,80);
  const data=await poiLookup('text',{keywords,region:'上海',city_limit:'true',page_size:20,page_num:1},{keywords,city:'上海',citylimit:'true',offset:20,page:1},key,fetcher);
  return (data.pois||[]).map(p=>amapRecord(p)).filter(Boolean);
}
export async function amapDetails(id,key,fetcher){if(!isAmap(id))fail('INVALID_INPUT','Invalid Amap place.');const params={id:id.slice(5)};const data=await poiLookup('detail',params,params,key,fetcher);const p=(data.pois||[]).map(p=>amapRecord(p)).find(p=>p?.id===id);if(!p)fail('PLACE_CHANGED','A selected place could not be refreshed. Please search again.',409);return p;}
export async function addAmapRoutes(plan,key,fetcher=fetch){
 plan.roadRoutes=await Promise.all(Array.from({length:plan.days},async(_,i)=>{
  const day=i+1,stops=plan.stops.filter(s=>s.dayIndex===day),base={day,placeIds:stops.map(s=>s.id),source:'Amap',coordinateSystem:'GCJ-02'};
  if(stops.length<2)return {...base,status:stops.length?'single_stop':'empty',distanceMeters:0,durationSeconds:0};
  try{
   const legs=[],path=[];
   for(let n=1;n<stops.length;n++){
    const a=stops[n-1],b=stops[n];if(!isAmap(a.id)||!isAmap(b.id)||![a.lat,a.lng,b.lat,b.lng].every(Number.isFinite))throw Error();
    const data=await amapJSON('/v3/direction/'+(plan.transport==='walk'?'walking':'driving'),{origin:a.lng+','+a.lat,destination:b.lng+','+b.lat,extensions:'base'},key,fetcher),p=data.route?.paths?.[0];
    const distanceMeters=Number(p?.distance),durationSeconds=Number(p?.duration);if(!p||!Number.isFinite(distanceMeters)||distanceMeters<0||!Number.isFinite(durationSeconds)||durationSeconds<0)throw Error();
    const points=(p.steps||[]).flatMap(s=>String(s.polyline||'').split(';')).map(s=>s.split(',').map(Number)).filter(p=>p.length===2&&p.every(Number.isFinite)&&p[0]>=120&&p[0]<=123&&p[1]>=30&&p[1]<=33);
    if(points.length<2||path.length+points.length>30000)throw Error();path.push(...points);
    const leg={fromId:a.id,toId:b.id,distanceMeters,durationSeconds,durationMinutes:Math.ceil(durationSeconds/60),mode:plan.transport,estimated:false,source:'Amap',trafficAware:false};legs.push(leg);b.travel=leg;
    const minute=s=>Number(s.slice(0,2))*60+Number(s.slice(3));b.travelConflict=minute(b.start)-minute(a.end)<leg.durationMinutes+10;
   }
   return {...base,status:'ready',path,legs,distanceMeters:legs.reduce((s,l)=>s+l.distanceMeters,0),durationSeconds:legs.reduce((s,l)=>s+l.durationSeconds,0),warnings:[],trafficAware:false};
  }catch{return {...base,status:'unavailable',message:'Amap routing is unavailable. Check directions before visiting.'};}
 }));return plan;
}
