/* Presentation only: reuse existing discovery, confirmation and map actions. */
let tuPlan=null,tuOwner=null,tuExpanded=false,tuTab='overview',tuFocusStop=null,tuPositions=new Map();
function tuSheetState(){const shell=document.querySelector('.tu-trip');if(!shell)return;shell.classList.toggle('tu-expanded',tuExpanded);shell.dataset.view=tuTab;const handle=shell.querySelector('.tu-handle');handle?.setAttribute('aria-expanded',String(!tuExpanded));if(handle)handle.innerHTML=tuExpanded?'Show map':'Hide map';shell.querySelectorAll('[data-act="tuTab"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.a===tuTab)));}
A.tuExpand=()=>{tuExpanded=!tuExpanded;tuSheetState();};
A.tuTab=tab=>{tuTab=tab==='itinerary'?'itinerary':'overview';tuExpanded=tuTab==='itinerary';tuSheetState();};
const tuSelect=A.pmSelect;
A.pmSelect=id=>{tuExpanded=false;tuTab='overview';tuFocusStop=null;tuSelect(id);requestAnimationFrame(()=>document.querySelector('.tu-trip')?.scrollIntoView({block:'start',behavior:'smooth'}));};
function tuVisitDuration(start,end){
  const minutes=value=>/^\d{2}:\d{2}$/.test(value||'')?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;
  const duration=minutes(end)-minutes(start);if(!Number.isFinite(duration)||duration<=0)return '';
  return duration>=60?Math.floor(duration/60)+' hr'+(duration%60?' '+duration%60+' min':''):duration+' min';
}
function tuDirectionsLink(from,to,transport){
  if(!from||!to)return null;
  const modes={walk:['walk','walking'],drive:['car','driving'],transit:['bus','transit'],bicycle:['ride','bicycling']};
  if(!Object.hasOwn(modes,transport))return null;
  const mode=modes[transport];
  const isAmap=p=>p.source==='Amap'||p.id?.startsWith('amap_');
  if(isAmap(from)||isAmap(to)){
    // Do not send Google/WGS84 or missing coordinates to the GCJ-02 route URI.
    const valid=p=>isAmap(p)&&!p.unavailable&&(p.coordinateSystem==='GCJ-02'||(!p.coordinateSystem&&p.source==='Amap'))&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
    if(!valid(from)||!valid(to))return null;
    const point=p=>[Number(p.lng.toFixed(6)),Number(p.lat.toFixed(6)),String(p.originalName||p.name||'Place').replace(/[\u0000-\u001f]/g,' ').replaceAll(',','，').slice(0,160)].join(',');
    // Official HTTPS URI attempts the installed app on mobile, retaining its
    // web route page when native launch is unavailable. PC ignores callnative.
    // No timers/custom-scheme redirect, API key or current-location request.
    return {href:'https://uri.amap.com/navigation?'+new URLSearchParams({from:point(from),to:point(to),mode:mode[0],src:'JourneyHub',callnative:'1'}),label:'Open in Amap ↗',title:'Open the Amap app when available, or view web directions'};
  }
  return {href:'https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',origin:from.name||'Place',origin_place_id:from.id||'',destination:to.name||'Place',destination_place_id:to.id||'',travelmode:mode[1]}),label:'Directions ↗',title:'View directions in Google Maps'};
}
function tuRememberSheet(){
  const shell=document.querySelector('.tu-trip'),scroll=shell?.closest('.screen');if(!scroll)return;
  tuPositions.set(shell.dataset.day,{top:scroll.scrollTop,open:[...scroll.querySelectorAll('details[data-tu-detail][open]')].map(d=>d.dataset.tuDetail)});
}
const tuView=V['place-plan'];
V['place-plan']=()=>{
  const view=tuView(),plan=pd.plan;if(!plan)return view;
  if(tuPlan!==plan||tuOwner!==pd.owner){tuPlan=plan;tuOwner=pd.owner;tuExpanded=false;tuTab='overview';tuFocusStop=null;tuPositions=new Map();}else tuRememberSheet();
  const saved=tuPositions.get(String(pd.day));
  const t=document.createElement('template');t.innerHTML=view.body;const root=t.content.querySelector('.pd-plan'),route=root?.querySelector('.pm-route');if(!route)return view;
  root.classList.add('tu-trip');root.classList.remove('content');root.classList.toggle('tu-expanded',tuExpanded);root.dataset.view=tuTab;root.dataset.day=String(pd.day);
  const map=route.querySelector('.pm-map-shell');root.prepend(map);
  const sheet=document.createElement('div');sheet.className='tu-sheet';
  sheet.innerHTML='<button class="tu-handle" data-act="tuExpand" aria-label="Show or hide map" aria-expanded="'+(!tuExpanded)+'">'+(tuExpanded?'Show map':'Hide map')+'</button><div class="tu-title"><div><small>YOUR NEXT ADVENTURE</small><h1>'+plan.days+' days in '+esc(plan.city)+'</h1><p>'+agDate(plan.date)+' · '+plan.stops.length+' places</p></div><button class="tu-edit" data-act="go" data-a="ai-picks" aria-label="Edit shortlist">'+ic('sliders',18)+'</button></div><div class="tu-tabs"><button data-act="tuTab" data-a="overview" aria-pressed="'+(tuTab==='overview')+'">Overview</button><button data-act="tuTab" data-a="itinerary" aria-pressed="'+(tuTab==='itinerary')+'">Itinerary</button></div>';
  const legend=route.querySelector('.pm-legend');sheet.append(legend);
  const scroll=document.createElement('div');scroll.className='tu-sheet-scroll';
  const details=document.createElement('details');details.className='tu-trip-details';details.dataset.tuDetail='trip';details.innerHTML='<summary>Trip notes & map details</summary>';
  [...root.children].forEach(node=>{if(node===map)return;if(node===route){details.append(node);return;}if(node.matches('.jr-eyebrow,h1')){node.remove();return;}if(node.matches('p')){details.append(node);return;}scroll.append(node);});
  const stops=plan.stops.filter(s=>pd.day==='all'||s.dayIndex===pd.day);
  scroll.querySelectorAll('.pd-stop').forEach((el,i)=>{
    const stop=stops[i];if(!stop)return;const place=pd.places.find(p=>p.id===stop.id),photo=place?.photo;
    const dayStops=plan.stops.filter(s=>s.dayIndex===stop.dayIndex),number=dayStops.findIndex(s=>s.id===stop.id)+1,duration=tuVisitDuration(stop.start,stop.end);
    const title=el.querySelector('h3'),warning=el.querySelector('.pm-warning'),hours=el.querySelector('details'),source=el.querySelector('a'),attributions=[...el.children].filter(n=>n.matches('span'));
    el.style.setProperty('--stop-color',pmColors[stop.dayIndex-1]);
    el.replaceChildren();
    const time=document.createElement('div');time.className='tu-stop-time';
    time.innerHTML='<span class="tu-stop-number">'+number+'</span><strong>'+esc(stop.start)+'–'+esc(stop.end)+'</strong>'+(duration?'<span class="tu-duration">'+duration+'</span>':'')+'<small>Suggested visit</small>';el.append(time);
    const head=document.createElement('div');head.className='tu-stop-head';
    head.innerHTML=(photo?.url?'<img loading="lazy" src="'+esc(pdSafeURL(photo.url))+'" alt="">':'<span class="tu-photo-placeholder" aria-hidden="true">'+ic('pin',24)+'</span>');
    const heading=document.createElement('div');heading.className='tu-stop-heading';heading.append(title);
    if(place?.kind){const kind=document.createElement('span');kind.className='tu-place-kind';kind.textContent=place.kind;heading.append(kind);}head.append(heading);el.append(head);
    if(stop.reason){const reason=document.createElement('p');reason.className='tu-stop-reason';reason.textContent=stop.reason;el.append(reason);}
    if(stop.address){const address=document.createElement('p');address.className='tu-stop-address';address.innerHTML=ic('pin',17)+'<span>'+esc(stop.address)+'</span>';el.append(address);}
    if(warning)el.append(warning);
    const footer=document.createElement('div');footer.className='tu-stop-footer';if(source)footer.append(source);
    const mapButton=document.createElement('button');mapButton.dataset.act='pmSelect';mapButton.dataset.a=stop.id;mapButton.disabled=!pmLocated(stop);mapButton.innerHTML=ic('globe',16)+(mapButton.disabled?' Location unavailable':' Show on map');footer.append(mapButton);el.append(footer);
    if(hours){hours.className='tu-opening-hours';hours.dataset.tuDetail='hours:'+stop.id;el.append(hours);}else{const note=document.createElement('small');note.className='tu-hours-note';note.textContent='Opening hours unavailable · check before visiting.';el.append(note);}
    if(attributions.length||photo?.authors?.length){const credits=document.createElement('div');credits.className='tu-place-credits';credits.append(...attributions);if(photo?.authors?.length)credits.insertAdjacentHTML('beforeend','<small>Photo: '+photo.authors.map(a=>esc(a.name)).join(', ')+'</small>');el.append(credits);}
    const transfer=el.previousElementSibling;if(transfer?.matches('.pd-transfer')){
      const previous=dayStops[number-2],travel=stop.travel,mode=travel?.mode==='walk'?'Walking':travel?.mode==='drive'?'Car / taxi':travel?.mode||'Transfer';
      const minutes=Number(travel?.durationMinutes),distance=Number(travel?.distanceMeters),durationLabel=Number.isFinite(minutes)&&minutes>=0?minutes+' min · ':'';
      transfer.classList.add('tu-transfer');transfer.innerHTML='<span class="tu-transfer-dot" aria-hidden="true"></span><span><strong>'+durationLabel+esc(mode)+'</strong><small>'+(['Google Routes','Amap'].includes(travel?.source)?((Number.isFinite(distance)&&distance>=0?(distance/1000).toFixed(1)+' km · ':'')+esc(travel.source)):'Estimated transfer')+'</small></span>';
      const link=tuDirectionsLink(previous,stop,travel?.mode||plan.transport);
      if(link)transfer.insertAdjacentHTML('beforeend','<a target="_blank" rel="noopener noreferrer" title="'+esc(link.title)+'" href="'+esc(link.href)+'">'+esc(link.label)+'</a>');
    }
  });
  scroll.querySelectorAll(':scope>section').forEach(section=>{const heading=section.querySelector(':scope>h2'),rows=section.querySelectorAll('.pd-stop'),first=stops.find(s=>s.id===rows[0]?.dataset.pmStop);if(!heading||!first)return;const date=new Date(Date.parse(plan.date+'T12:00:00Z')+(first.dayIndex-1)*86400000).toISOString().slice(0,10);const sub=document.createElement('span');sub.textContent=agDate(date)+' · '+rows.length+' places';heading.append(sub);section.classList.add('tu-day-section');});
  scroll.append(details);for(const d of scroll.querySelectorAll('details[data-tu-detail]'))d.open=!!saved?.open.includes(d.dataset.tuDetail);
  sheet.append(scroll);root.append(sheet);view.body=t.innerHTML;
  const after=view.after;view.after=()=>{
    after?.();tuSheetState();const currentScroll=document.querySelector('.tu-trip')?.closest('.screen');if(currentScroll)currentScroll.scrollTop=saved?.top||0;
    if(tuFocusStop){const target=[...document.querySelectorAll('[data-pm-stop]')].find(el=>el.dataset.pmStop===tuFocusStop);target?.scrollIntoView?.({block:'nearest',behavior:'auto'});tuFocusStop=null;}
  };return view;
};
