import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';
let time=Date.parse('2026-11-05T14:00:00Z'),calls=0,fail=false,hold=null;
class Clock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
const tick=()=>new Promise(r=>setImmediate(r));
const timers=new Map();let timerId=0;
const {window}=new JSDOM('<div class="cal-page"><section><div class="cal-grid"></div><div class="cal-legend"></div></section><div class="cal-agenda-head"></div></div>',{url:'https://example.org'});
const {document}=window,grid=document.querySelector('.cal-grid');
const dates=['2026-11-05','2026-11-12','2026-11-13','2026-11-20','2026-11-04','2026-11-14'];
for(const date of dates)grid.insertAdjacentHTML('beforeend','<button class="cal-day" data-a="'+date+'" aria-pressed="'+(date==='2026-11-12')+'" aria-label="Day '+date+'"><i class="planned"></i></button>');
const ctx={owner:'alice'},state={route:'orders'},events=dates.map(date=>({kind:'plan',city:'Shanghai',date}));
events[5]={kind:'reservation',tag:'Cancelled',city:'Shanghai',date:dates[5]};
const report=()=>({city:'Shanghai',source:'Amap',forecastDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(time),days:[{date:'2026-11-05',icon:'cloud',condition:'Overcast',tempC:19,period:'Daytime',source:'Amap'},{date:'2026-11-12',icon:'rain',condition:'Rain',tempC:17,period:'12:00',source:'MET Norway'}],expiresAt:new Date(time+1800000).toISOString()});
const context={document,window,sessionStorage:window.sessionStorage,Date:Clock,state,cal:ctx,calEvents:()=>events,calCurrent:c=>c===ctx,
  calInstantDate:(v,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date(v)),
  calAdd:(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),
  setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
  sb:{functions:{invoke:async(_name,{body})=>{calls++;assert.deepEqual(JSON.parse(JSON.stringify(body)),{action:'calendar_weather',city:'Shanghai'});if(hold)await hold;if(fail)throw Error('offline');return {data:report()};}}}
};
const weather=runInNewContext(readFileSync(new URL('./calendar-weather.js',import.meta.url),'utf8')+'\n;({calWeatherAttach,calWeatherCity,calWeatherPrefetch,calWeatherFetch,calWeatherSaved,calWeatherInRange})',context);
const cell=date=>grid.querySelector('[data-a="'+date+'"]');
assert(weather.calWeatherInRange('Shanghai','2026-11-12',new Clock()));
assert(!weather.calWeatherInRange('Shanghai','2026-11-20',new Clock()));
await Promise.all([weather.calWeatherPrefetch({city:'Shanghai',date:dates[1],days:2}),weather.calWeatherPrefetch({city:'Shanghai',date:dates[0],days:4})]);
assert.equal(calls,1);
weather.calWeatherAttach(ctx,events);await tick();
assert.equal(calls,1);assert.equal(document.querySelectorAll('.cal-weather-icon').length,5);
assert.equal(cell(dates[1]).querySelector('.cal-weather-icon').dataset.sky,'rain');
assert.match(cell(dates[1]).getAttribute('aria-label'),/Rain.*MET Norway/);
assert.match(document.querySelector('.cal-weather-summary').textContent,/17°C/);
assert.equal(document.querySelectorAll('.cal-weather-credit').length,1);
assert.match(cell(dates[3]).title,/Forecast not available yet/);
assert.match(cell(dates[4]).title,/Historical weather unavailable/);
assert.match(cell(dates[2]).title,/temporarily unavailable/);
assert.equal(cell(dates[5]).querySelector('.cal-weather-icon'),null);
assert.equal(grid.querySelectorAll('i.planned').length,6);
weather.calWeatherAttach(ctx,events);await tick();
assert.equal(document.querySelectorAll('.cal-weather-icon').length,5);
assert.equal((cell(dates[1]).getAttribute('aria-label').match(/MET Norway/g)||[]).length,1);
assert.equal(timers.size,1);
assert(window.sessionStorage.getItem('jh-city-weather-v2:Shanghai'));
time+=1800001;fail=true;weather.calWeatherAttach(ctx,events);await tick();
assert.equal(calls,2);assert.match(cell(dates[1]).title,/temporarily unavailable/);
assert.equal(cell(dates[1]).querySelector('.cal-weather-icon').dataset.sky,'pending');
time+=120001;fail=false;window.dispatchEvent(new window.Event('focus'));await tick();
assert.equal(calls,3);assert.equal(cell(dates[1]).querySelector('.cal-weather-icon').dataset.sky,'rain');
time=Date.parse('2026-11-05T15:59:50Z');await weather.calWeatherFetch('Shanghai');
time=Date.parse('2026-11-05T16:00:01Z');assert.equal(weather.calWeatherSaved('Shanghai'),null);
await weather.calWeatherPrefetch({city:'Shanghai',date:'2026-11-12'});assert.equal(calls,5);
assert.equal(await weather.calWeatherPrefetch({city:'__proto__'}),null);
time+=1800001;let release;hold=new Promise(r=>release=r);weather.calWeatherAttach(ctx,events);
const before=cell(dates[1]).title;state.route='journey';release();await tick();assert.equal(cell(dates[1]).title,before);hold=null;
assert.equal(weather.calWeatherCity([{kind:'reservation',tag:'Reserved',city:'Bangkok'}]),'Bangkok');
assert.equal(weather.calWeatherCity([{kind:'plan',city:'Shanghai'},{kind:'plan',city:'Bangkok'}]),'');
window.close();
console.log('PASS: automatic prefetch, Nov12 forecast, mixed-source credits, pending states, cache/expiry/midnight refresh, repeated renders, cancelled exclusions and stale-view guard.');
