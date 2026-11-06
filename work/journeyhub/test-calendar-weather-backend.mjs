import assert from 'node:assert/strict';
import {createCalendarWeather} from './supabase/functions/journeyhub-agent/calendar-weather.mjs';
const now=new Date('2026-11-05T03:00:00Z');
const plus=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const casts=Array.from({length:4},(_,i)=>({date:plus('2026-11-05',i),dayweather:i===0?'晴':'多云',daytemp:String(20+i)}));
const amap=(days=casts)=>({status:'1',forecasts:[{adcode:'310000',casts:days}]});
const met=(start='2026-11-05',count=11)=>({properties:{timeseries:Array.from({length:count},(_,i)=>({time:plus(start,i)+'T04:00:00Z',data:{instant:{details:{air_temperature:18+i}},next_6_hours:{summary:{symbol_code:'rain'}}}}))}});
const env=()=> 'fixture';
const provider=url=>String(url).includes('restapi.amap')?'amap':'met';

// A successful Amap response no longer suppresses the longer-range provider.
{
 const forecast=createCalendarWeather(),calls=[];let releaseAmap,releaseMet;
 const fetcher=async url=>{const p=provider(url);calls.push(p);return new Promise(resolve=>{if(p==='amap')releaseAmap=()=>resolve(Response.json(amap([...casts,casts[0]])));else releaseMet=()=>resolve(Response.json(met(),{headers:{Expires:'Thu, 05 Nov 2026 05:00:00 GMT','Last-Modified':'Thu, 05 Nov 2026 00:00:00 GMT'}}));});};
 const one=forecast('Shanghai',{env,fetcher,now}),two=forecast('Shanghai',{env,fetcher,now});
 await Promise.resolve();assert.deepEqual(calls,['amap','met'],'independent providers start in parallel');releaseMet();releaseAmap();
 const [a,b]=await Promise.all([one,two]);assert.strictEqual(a,b,'concurrent city requests share one pending result');
 assert.equal(a.days.length,9);assert.equal(new Set(a.days.map(d=>d.date)).size,9);assert.equal(a.days[0].source,'Amap');assert.equal(a.days[0].icon,'sun');assert.equal(a.days[3].source,'Amap');assert.equal(a.days[4].source,'MET Norway');assert.equal(a.days.find(d=>d.date==='2026-11-12').source,'MET Norway');assert.equal(a.days.at(-1).date,'2026-11-13');assert.equal(a.source,'Amap');assert.deepEqual(a.sources,['Amap','MET Norway']);assert.equal(a.forecastDate,'2026-11-05');assert.equal(a.forecastThrough,'2026-11-13');assert.equal(a.fetchedAt,now.toISOString());assert.equal(a.expiresAt,'2026-11-05T03:30:00.000Z');
 assert.strictEqual(await forecast('Shanghai',{env,fetcher,now:new Date(now.getTime()+1000)}),a);assert.equal(calls.length,2);
}
// Partial/total outages retain real rows and never invent later forecast dates.
{
 const missingMet=await createCalendarWeather()('Shanghai',{env,now,fetcher:async url=>provider(url)==='amap'?Response.json(amap()):new Response(null,{status:503})});assert.equal(missingMet.days.length,4);assert.equal(missingMet.forecastThrough,'2026-11-13');assert(!missingMet.days.some(d=>d.date==='2026-11-12'));assert.equal(missingMet.expiresAt,'2026-11-05T03:05:00.000Z');
 const missingAmap=await createCalendarWeather()('Shanghai',{env,now,fetcher:async url=>provider(url)==='amap'?Response.json({status:'0',infocode:'10021'}):Response.json(met())});assert.equal(missingAmap.days.length,9);assert.equal(missingAmap.source,'MET Norway');assert(missingAmap.days.every(d=>d.source==='MET Norway'));
 const none=await createCalendarWeather()('Shanghai',{env,now,fetcher:async()=>{throw Error('offline')}});assert.deepEqual(none.days,[]);assert.deepEqual(none.sources,[]);assert.equal(none.expiresAt,'2026-11-05T03:05:00.000Z');
}
// MET Expires is respected separately from Amap's shorter refresh interval.
{
 const forecast=createCalendarWeather();let amapCalls=0,metCalls=0;
 const fetcher=async(url,options)=>{if(provider(url)==='amap'){amapCalls++;return Response.json(amap());}metCalls++;assert(options.headers['User-Agent'].includes('JourneyHub'));return Response.json(met(),{headers:{Expires:'Thu, 05 Nov 2026 05:00:00 GMT','Last-Modified':'Thu, 05 Nov 2026 00:00:00 GMT'}});};
 await forecast('Shanghai',{env,now,fetcher});await forecast('Shanghai',{env,now:new Date('2026-11-05T03:31:00Z'),fetcher});assert.equal(amapCalls,2);assert.equal(metCalls,1,'fresh MET payload reused while Amap refreshes');
}
// Expired MET data uses If-Modified-Since and honors fresh 304 cache headers.
{
 const forecast=createCalendarWeather();let metCalls=0;
 const fetcher=async(url,options)=>{if(provider(url)==='amap')return Response.json(amap());metCalls++;if(metCalls===1)return Response.json(met(),{headers:{'Cache-Control':'public, max-age=600','Age':'60','Last-Modified':'Thu, 05 Nov 2026 00:00:00 GMT'}});assert.equal(options.headers['If-Modified-Since'],'Thu, 05 Nov 2026 00:00:00 GMT');return new Response(null,{status:304,headers:{'Cache-Control':'max-age=3600'}});};
 const first=await forecast('Shanghai',{env,now,fetcher});assert.equal(first.expiresAt,'2026-11-05T03:09:00.000Z');
 const next=await forecast('Shanghai',{env,now:new Date('2026-11-05T03:10:00Z'),fetcher});assert.equal(metCalls,2);assert.equal(next.days.length,9);assert.equal(next.expiresAt,'2026-11-05T03:40:00.000Z');
}
// No-store does not preserve provider bodies or permit conditional reuse.
{
 const forecast=createCalendarWeather();let calls=0;
 const fetcher=async(url,options)=>{assert.equal(provider(url),'met');assert.equal(options.headers['If-Modified-Since'],undefined);calls++;return Response.json(met(),{headers:{'Cache-Control':'no-store','Last-Modified':'Thu, 05 Nov 2026 00:00:00 GMT'}});};
 await forecast('Singapore',{env:()=>undefined,now,fetcher});await forecast('Singapore',{env:()=>undefined,now:new Date(now.getTime()+1000),fetcher});assert.equal(calls,2);
}
// Destination midnight invalidates the calendar range without discarding a fresh MET cache.
{
 const forecast=createCalendarWeather();let amapCalls=0,metCalls=0;
 const fetcher=async url=>{if(provider(url)==='amap'){amapCalls++;const start=amapCalls===1?'2026-11-05':'2026-11-06';return Response.json(amap(Array.from({length:4},(_,i)=>({date:plus(start,i),dayweather:'晴',daytemp:'20'}))));}metCalls++;return Response.json(met('2026-11-05',12),{headers:{Expires:'Thu, 05 Nov 2026 20:00:00 GMT'}});};
 const before=await forecast('Shanghai',{env,now:new Date('2026-11-05T15:59:00Z'),fetcher});assert.equal(before.forecastDate,'2026-11-05');
 const after=await forecast('Shanghai',{env,now:new Date('2026-11-05T16:01:00Z'),fetcher});assert.equal(after.forecastDate,'2026-11-06');assert.equal(after.forecastThrough,'2026-11-14');assert.equal(after.days[0].date,'2026-11-06');assert.equal(after.days.at(-1).date,'2026-11-14');assert.equal(amapCalls,2);assert.equal(metCalls,1);
}
// Concurrent requests spanning midnight cannot roll the cache back one day.
{
 const forecast=createCalendarWeather(),resolvers=[];let requests=0;
 const fetcher=async()=>{requests++;return new Promise(resolve=>resolvers.push(()=>resolve(Response.json(met('2026-11-05',12),{headers:{Expires:'Thu, 05 Nov 2026 20:00:00 GMT'}}))));};
 const before=forecast('Singapore',{env:()=>undefined,now:new Date('2026-11-05T15:59:59Z'),fetcher});
 const after=forecast('Singapore',{env:()=>undefined,now:new Date('2026-11-05T16:00:01Z'),fetcher});
 assert.equal(requests,2,'in-flight requests from different destination dates do not share stale coverage');resolvers[1]();const fresh=await after;resolvers[0]();await before;
 const cached=await forecast('Singapore',{env:()=>undefined,now:new Date('2026-11-05T16:01:00Z'),fetcher});assert.strictEqual(cached,fresh,'late prior-day response does not overwrite the new day cache');
}
// Existing unsupported-city guard and overseas provider behavior remain intact.
{
 await assert.rejects(()=>createCalendarWeather()('__proto__',{env,now,fetcher:()=>{throw Error('must not fetch')}}),e=>e.code==='INVALID_INPUT');
 const calls=[];const report=await createCalendarWeather()('Bangkok',{env,now,fetcher:async url=>{calls.push(provider(url));return Response.json(met());}});assert.deepEqual(calls,['met']);assert.equal(report.days.length,9);assert.equal(report.source,'MET Norway');
}
console.log('PASS backend weather: parallel Amap+MET merge, 9-day horizon, exact per-day sources, no duplicate/invented dates, partial/total outage, coalescing, provider-specific Expires/max-age/Age/304/no-store caching and destination midnight.');
