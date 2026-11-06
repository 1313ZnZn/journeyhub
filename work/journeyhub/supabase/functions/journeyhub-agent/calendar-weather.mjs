import {fail} from './planner.mjs';

const cities = {
  Shanghai: {tz:'Asia/Shanghai', lat:31.2304, lon:121.4737, adcode:'310000', days:9},
  Singapore: {tz:'Asia/Singapore', lat:1.3521, lon:103.8198, days:9},
  Bangkok: {tz:'Asia/Bangkok', lat:13.7563, lon:100.5018, days:9}
};
const dayAt = (time, tz) => new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
const datePlus = (day,n) => new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const temp = value => (typeof value==='number'||typeof value==='string'&&/^-?\d+(\.\d+)?$/.test(value)) && Number.isFinite(+value) && Math.abs(+value)<=75 ? Math.round(+value) : null;
const amapSymbols = [
  [/雷/,'storm','Thunderstorms'], [/冰雹|冻雨|雨夹雪|雨雪/,'sleet','Sleet or hail'],
  [/雪/,'snow','Snow'], [/雨/,'rain','Rain'], [/雾|霾|沙|尘|浮沉/,'fog','Low visibility'],
  [/多云|少云|晴间多云/,'partly','Partly cloudy'], [/阴/,'cloud','Overcast'],
  [/晴/,'sun','Sunny'], [/风/,'wind','Windy']
];
export function amapDays(payload) {
  const entry=payload?.forecasts?.find(x=>x.adcode==='310000');
  if(payload?.status!=='1'||!Array.isArray(entry?.casts))return [];
  return entry.casts.flatMap(cast=>{
    const match=amapSymbols.find(([pattern])=>pattern.test(cast.dayweather||''));
    if(!match || !/^\d{4}-\d{2}-\d{2}$/.test(cast.date||''))return [];
    return [{date:cast.date, icon:match[1], condition:match[2], tempC:temp(cast.daytemp), period:'Daytime'}];
  });
}
const metSymbols = [
  [/thunder/,'storm','Thunderstorms'], [/sleet/,'sleet','Sleet'], [/snow/,'snow','Snow'],
  [/rain/,'rain','Rain'], [/fog/,'fog','Fog'], [/partlycloudy|fair/,'partly','Partly cloudy'],
  [/^cloudy$/,'cloud','Cloudy'], [/^clearsky$/,'sun','Clear']
];
export function metDays(payload, zone, now) {
  const days=new Map();
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'});
  for(const slot of payload?.properties?.timeseries||[]){
    const t=Date.parse(slot.time);
    if(!Number.isFinite(t)||t<now.getTime()-3600000)continue;
    const summary=slot.data?.next_1_hours?.summary||slot.data?.next_6_hours?.summary;
    const symbol=String(summary?.symbol_code||'').split('_')[0];
    const match=metSymbols.find(([expr])=>expr.test(symbol));
    if(!match)continue;
    const date=dayAt(t,zone),hour=Number(clock.format(t)),weight=Math.abs(hour-12);
    if(days.has(date)&&days.get(date).weight<=weight)continue;
    const night=hour<6||hour>=18;
    days.set(date,{weight,day:{date,icon:night&&match[1]==='sun'?'moon':match[1],condition:match[2],tempC:temp(slot.data?.instant?.details?.air_temperature),period:String(hour).padStart(2,'0')+':00'}});
  }
  return Array.from(days.values(),v=>v.day);
}
function metCachePolicy(headers,now){
  const control=headers.get('cache-control')||'',age=Number(headers.get('age'))||0;
  if(/(?:^|,)\s*(?:no-store|no-cache)(?:\s|,|$)/i.test(control))return{expiry:now.getTime(),store:!/(?:^|,)\s*no-store(?:\s|,|$)/i.test(control)};
  const maxAge=control.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)/i),expires=Date.parse(headers.get('expires')||'');
  const rawExpiry=maxAge?now.getTime()+Math.max(0,Number(maxAge[1])-age)*1000:Number.isFinite(expires)?expires:now.getTime()+1800000;
  const expiry=Number.isFinite(new Date(rawExpiry).getTime())?rawExpiry:now.getTime()+1800000;
  return{expiry:Math.max(now.getTime(),expiry),store:true};
}
export function createCalendarWeather() {
  const cache=new Map(), pending=new Map();
  return async function forecast(city,{env,fetcher=fetch,now=new Date()}) {
    if(!Object.hasOwn(cities,city))fail('INVALID_INPUT','Choose a supported destination.',400);
    const location=cities[city],today=dayAt(now,location.tz),requestKey=city+':'+today;
    const forecastThrough=datePlus(today,location.days-1);
    const eligible=days=>days.filter(d=>d.date>=today&&d.date<=forecastThrough);
    const previous=cache.get(city);
    if(previous?.expiry>now.getTime()&&previous.today===today)return previous.result;
    if(pending.has(requestKey))return pending.get(requestKey);
    const task=(async()=>{
      // Amap covers today plus three days. MET supplies the longer horizon even
      // when Amap succeeds, so later itinerary dates are not silently excluded.
      // Requests run together; a slow/failed provider never erases the other.
      const amapTask=(async()=>{
        if(!location.adcode||!env('AMAP_WEB_SERVICE_KEY'))return [];
        try{
          const url=new URL('https://restapi.amap.com/v3/weather/weatherInfo');
          url.search=new URLSearchParams({key:env('AMAP_WEB_SERVICE_KEY'),city:location.adcode,extensions:'all',output:'JSON'}).toString();
          const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(5500)});
          if(r.ok)return eligible(amapDays(await r.json())).filter(d=>d.date<=datePlus(today,3));
          await r.body?.cancel();
        }catch{/* The longer-range provider can still cover this city. */}
        return [];
      })();
      const metTask=(async()=>{
        if(previous?.metData&&previous.metExpiry>now.getTime())return{days:eligible(metDays(previous.metData,location.tz,now)),data:previous.metData,modified:previous.modified,expiry:previous.metExpiry};
        try{
          const headers={'User-Agent':'JourneyHub/1.0 (https://journeyhub-travel.youranxin2006.chatgpt.site/)'};
          if(previous?.modified&&previous.metData)headers['If-Modified-Since']=previous.modified;
          const r=await fetcher('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat='+location.lat+'&lon='+location.lon,{headers,redirect:'error',signal:AbortSignal.timeout(7500)});
          let data,modified='';
          if(r.status===304&&previous?.metData){data=previous.metData;modified=r.headers.get('last-modified')||previous.modified;}
          else if(r.ok){data=await r.json();modified=r.headers.get('last-modified')||'';}
          else await r.body?.cancel();
          if(data){const policy=metCachePolicy(r.headers,now);return{days:eligible(metDays(data,location.tz,now)),data:policy.store?data:undefined,modified:policy.store?modified:'',expiry:policy.expiry};}
        }catch{/* No invented weather for an unavailable forecast date. */}
        return{days:[],data:previous?.metData,modified:previous?.modified||'',expiry:0};
      })();
      const [amap,met]=await Promise.all([amapTask,metTask]);
      const byDate=new Map();
      for(const day of met.days)byDate.set(day.date,{...day,source:'MET Norway'});
      for(const day of amap)byDate.set(day.date,{...day,source:'Amap'});
      const days=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)),sources=[...new Set(days.map(d=>d.source))],source=sources.includes('Amap')?'Amap':'MET Norway';
      // Provider-specific freshness: a six-hour MET cache must not delay the
      // 30-minute Amap refresh, and a short MET Expires header must be respected.
      const expiries=[];if(amap.length)expiries.push(now.getTime()+1800000);if(met.days.length)expiries.push(met.expiry);
      // Retry a missing provider sooner so an outage does not hide later dates.
      if(!met.days.length||location.adcode&&env('AMAP_WEB_SERVICE_KEY')&&!amap.length)expiries.push(now.getTime()+300000);
      const expiry=days.length?Math.min(...expiries):now.getTime()+300000;
      const result={city,source,sources,days,forecastDate:today,forecastThrough,fetchedAt:now.toISOString(),expiresAt:new Date(expiry).toISOString()};
      if((cache.get(city)?.today||'')<=today)cache.set(city,{result,today,expiry,modified:met.modified,metData:met.data,metExpiry:met.expiry});
      return result;
    })();
    pending.set(requestKey,task);
    try{return await task;}finally{pending.delete(requestKey);}
  };
}
