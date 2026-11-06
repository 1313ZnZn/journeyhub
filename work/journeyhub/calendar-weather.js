// A city forecast is public data. The cache contains no trip IDs or visitor preferences.
const calWeatherZones = {Shanghai:'Asia/Shanghai', Singapore:'Asia/Singapore', Bangkok:'Asia/Bangkok'};
const calWeatherCache = new Map();
const calWeatherPending = new Map();
let calWeatherRefreshTimer=null;
let calWeatherAttachVersion=0;
const calWeatherToday=(city,now=new Date())=>calInstantDate(now.toISOString(),calWeatherZones[city]);
const calWeatherCloud = '<path d="M6.5 18h11a4 4 0 0 0 .3-8 6 6 0 0 0-11.6-.6A4.3 4.3 0 0 0 6.5 18Z"/>';
const calWeatherShapes = {
  pending:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/>',
  moon:'<path d="M20 15.2A8.7 8.7 0 0 1 8.8 4a8.7 8.7 0 1 0 11.2 11.2Z"/>',
  cloud:calWeatherCloud,
  partly:'<path d="M8 3V1m-5 4L1.5 3.5M2 10H.5m13-5 1.5-1.5M4 11a4.8 4.8 0 1 1 9-3"/><path d="M8 20h10a3.7 3.7 0 0 0 0-7.4 5 5 0 0 0-9.6-1.3A4.4 4.4 0 0 0 8 20Z"/>',
  rain:'<path d="M5.5 14a3.7 3.7 0 0 1 .7-7.3A5.3 5.3 0 0 1 16.6 7a3.6 3.6 0 0 1 1.2 7"/><path d="m8 15-2 4m7-4-2 4m7-4-2 4"/>',
  storm:'<path d="M6 15a4 4 0 0 1 .4-8A5.2 5.2 0 0 1 16.6 7a4 4 0 0 1 1.4 7.6"/><path d="m12.6 12-3.4 5h4l-2.5 5"/>',
  snow:'<path d="M12 2v20M3.4 7l17.2 10M3.4 17l17.2-10M9.5 4l2.5 2 2.5-2M9.5 20l2.5-2 2.5 2M4 10l.4-2.5 2.4-1M17 17.8l2.7-1 .1-2.5"/>',
  sleet:'<path d="M5 13a3.8 3.8 0 0 1 1-7.3 5.2 5.2 0 0 1 10.1.4 3.8 3.8 0 0 1 1.8 7.2M8 15l-1.8 3.5m9-2-1.8 3.5"/><circle cx="11" cy="20" r=".8"/>',
  fog:'<path d="M4 12a3.6 3.6 0 0 1 2-6.4 5 5 0 0 1 9.7.4 3.8 3.8 0 0 1 4 5M3 15h16M6 19h15"/>',
  wind:'<path d="M2 9h12a3.5 3.5 0 1 0-3.5-3.5M2 13h16a3 3 0 1 0 0-6M5 17h8a2.5 2.5 0 1 1-2.5 2.5"/>'
};
function calWeatherCity(marks) {
  const planned=marks.filter(e=>e.kind==='plan' && e.tag!=='Cancelled');
  const active=planned.length?planned:marks.filter(e=>e.kind==='reservation' && ['Reserved','Checked in'].includes(e.tag));
  const cities=[...new Set(active.map(e=>e.city))];
  return cities.length===1 && Object.hasOwn(calWeatherZones,cities[0])?cities[0]:'';
}
function calWeatherInRange(city,date,now) {
  const today=calWeatherToday(city,now);
  return date>=today && date<=calAdd(today,8);
}
function calWeatherSaved(city) {
  if(!calWeatherCache.has(city)){
    try{const saved=JSON.parse(sessionStorage.getItem('jh-city-weather-v2:'+city));if(saved?.city===city&&Array.isArray(saved.days))calWeatherCache.set(city,saved);}catch{}
  }
  const saved=calWeatherCache.get(city);
  return saved&&saved.forecastDate===calWeatherToday(city)&&Date.parse(saved.expiresAt)>Date.now()?saved:null;
}
async function calWeatherFetch(city) {
  if(!Object.hasOwn(calWeatherZones,city))return null;
  const saved=calWeatherSaved(city);
  if(saved)return saved;
  if(calWeatherPending.has(city))return calWeatherPending.get(city);
  const task=(async()=>{
    let result;
    try{
      const {data,error}=await sb.functions.invoke('journeyhub-agent',{body:{action:'calendar_weather',city}});
      if(error||data?.city!==city||!['Amap','MET Norway'].includes(data.source)||!Array.isArray(data.days)||!Number.isFinite(Date.parse(data.expiresAt)))throw Error();
      result={...data,forecastDate:data.forecastDate||calWeatherToday(city)};
      try{sessionStorage.setItem('jh-city-weather-v2:'+city,JSON.stringify(result));}catch{}
    }catch{result={city,days:[],forecastDate:calWeatherToday(city),unavailable:true,expiresAt:new Date(Date.now()+120000).toISOString()};}
    calWeatherCache.set(city,result);return result;
  })();
  calWeatherPending.set(city,task);
  try{return await task;}finally{calWeatherPending.delete(city);}
}
// Start alongside a new itinerary; weather never holds up a finished plan.
async function calWeatherPrefetch(input) {
  if(!input||!Object.hasOwn(calWeatherZones,input.city))return null;
  return calWeatherFetch(input.city);
}
function calWeatherLink(text,url) {
  const a=document.createElement('a');a.textContent=text;a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;
}
function calWeatherAttach(ctx,events) {
  const version=++calWeatherAttachVersion;
  if(calWeatherRefreshTimer!==null){clearTimeout(calWeatherRefreshTimer);calWeatherRefreshTimer=null;}
  const grid=document.querySelector('.cal-grid');
  if(!grid||!ctx.owner)return;
  const byCity=new Map(),now=new Date();
  for(const button of grid.querySelectorAll('button.cal-day')){
    const date=button.dataset.a,city=calWeatherCity(events.filter(e=>e.date===date));
    if(!city)continue;
    if(!byCity.has(city))byCity.set(city,[]);
    byCity.get(city).push({button,date});
  }
  const apply=(city,report,loading=false)=>{
    if(version!==calWeatherAttachVersion||!grid.isConnected||!calCurrent(ctx)||state.route!=='orders')return;
    for(const {button,date} of byCity.get(city)){
      const today=calWeatherToday(city),inRange=calWeatherInRange(city,date,new Date());
      const item=report.days.find(d=>d.date===date&&d.icon!=='pending'&&Object.hasOwn(calWeatherShapes,d.icon));
      const source=item?.source||report.source;
      const status=date<today?'Historical weather unavailable':!inRange?'Forecast not available yet':loading?'Checking weather…':'Weather temporarily unavailable';
      const description=city+' · '+(item?item.condition+(Number.isFinite(item.tempC)?' · '+item.tempC+'°C':''):status);
      const label=item?description+' ('+item.period+', '+source+')':description;
      const badge=button.querySelector('.cal-weather-icon')||document.createElement('span');badge.className='cal-weather-icon';badge.dataset.sky=item?.icon||'pending';badge.setAttribute('aria-hidden','true');
      badge.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" focusable="false">'+calWeatherShapes[item?.icon||'pending']+'</svg>';
      if(!badge.isConnected)button.append(badge);
      button.dataset.weatherBaseLabel??=button.getAttribute('aria-label')||'';
      button.title=label;button.setAttribute('aria-label',button.dataset.weatherBaseLabel+', '+label);
      if(button.getAttribute('aria-pressed')==='true'){
        const head=grid.closest('.cal-page')?.querySelector('.cal-agenda-head');
        if(head){
          const detail=head.querySelector('.cal-weather-summary')||document.createElement('small');detail.className='cal-weather-summary';detail.textContent=description+(item?' · '+item.period:'');
          detail.title=label;head.append(detail);
        }
      }
      if(item&&source==='MET Norway'){
        const legend=grid.parentElement.querySelector('.cal-legend');
        if(legend&&!legend.querySelector('.cal-weather-credit')){
          const credit=document.createElement('small');credit.className='cal-weather-credit';credit.append('Weather · ',calWeatherLink('MET Norway','https://api.met.no/weatherapi/locationforecast/2.0/documentation'),' · ',calWeatherLink('CC BY 4.0','https://creativecommons.org/licenses/by/4.0/'));
          legend.append(credit);
        }
      }
    }
  };
  const requests=[];
  for(const city of byCity.keys()){
    const saved=calWeatherSaved(city);
    if(saved){apply(city,saved);requests.push(Promise.resolve(saved));}
    else{apply(city,{days:[]},true);requests.push(calWeatherFetch(city).then(report=>{apply(city,report);return report;}));}
  }
  if(requests.length)void Promise.all(requests).then(reports=>{
    if(version!==calWeatherAttachVersion||!grid.isConnected||!calCurrent(ctx)||state.route!=='orders')return;
    // Recheck expiry and the destination's date without rerendering the itinerary.
    const delay=Math.max(1000,Math.min(60000,...reports.map(r=>Date.parse(r.expiresAt)-Date.now())));
    calWeatherRefreshTimer=setTimeout(()=>{calWeatherRefreshTimer=null;if(grid.isConnected&&calCurrent(ctx)&&state.route==='orders')calWeatherAttach(ctx,events);},delay);
  });
}
if(typeof window!=='undefined'){
  const refresh=()=>{if(document.visibilityState!=='hidden'&&typeof cal!=='undefined'&&cal.owner&&state.route==='orders')calWeatherAttach(cal,calEvents());};
  window.addEventListener('focus',refresh);
  document.addEventListener('visibilitychange',refresh);
}
