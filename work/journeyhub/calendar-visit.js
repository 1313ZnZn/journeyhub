/* Compact Calendar cards share existing place and reservation records. No fetch. */
const cvEnglish=value=>typeof value==='string'&&value.trim()&&!/[\p{Script=Han}\p{Script=Thai}]/u.test(value)?value.trim():'';
const cvURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
// Legacy Amap places can carry only a Chinese address. Format its supplied
// street/house number locally; omit metro directions and never infer a number.
const cvDistricts={'黄浦区':'Huangpu District','徐汇区':'Xuhui District','长宁区':'Changning District','静安区':"Jing’an District",'普陀区':'Putuo District','虹口区':'Hongkou District','杨浦区':'Yangpu District','浦东新区':'Pudong New Area','闵行区':'Minhang District','宝山区':'Baoshan District','嘉定区':'Jiading District','金山区':'Jinshan District','松江区':'Songjiang District','青浦区':'Qingpu District','奉贤区':'Fengxian District','崇明区':'Chongming District'};
function cvLegacyAddress(raw){
  if(typeof raw!=='string'||!raw.includes('上海'))return '';
  let rest=raw.normalize('NFKC').trim().replace(/^(?:中国)?\s*上海市?\s*/,''),district=Object.keys(cvDistricts).find(d=>rest.startsWith(d));
  if(district)rest=rest.slice(district.length).trim();
  const area=[district&&cvDistricts[district],'Shanghai'].filter(Boolean).join(', ');
  const street=rest.split(/[（(]/)[0].trim().match(/^([\p{Script=Han}·]{1,18}?)(高速公路|大道|公路|大街|路|街|弄|巷)(?:\s*(\d+(?:[-–]\d+)?)\s*号)?/u);
  if(!street||typeof cvPinyin==='undefined'||!cvPinyin.isSupported())return district?'Area: '+area:'';
  let name=street[1],direction='';const dir={东:'East',南:'South',西:'West',北:'North',中:'Middle'};
  if(name.length>2&&dir[name.slice(-1)]){direction=dir[name.slice(-1)];name=name.slice(0,-1);}
  const converted=cvPinyin.convertToPinyin(name,'',true);
  if(!/^[a-z]+$/i.test(converted))return district?'Area: '+area:'';
  const suffix={高速公路:'Expressway',大道:'Avenue',公路:'Highway',大街:'Street',路:'Road',街:'Street',弄:'Lane',巷:'Lane'}[street[2]];
  return [street[3],converted.charAt(0).toUpperCase()+converted.slice(1),direction,suffix].filter(Boolean).join(' ')+', '+area;
}
function cvPlace(event,stop){
  const owner=jhUser?.id,history=event.manageKind==='history'&&pd.owner===owner&&pd.historyId===event.manageId;
  const cached=history?pd.places?.find(p=>p.id===stop.id):null;
  // Reuse the search card photo and metadata, without substituting its timing.
  const result={...cached,...stop};
  for(const key of ['photo','addressEnglish','sourceURL','venueDetails'])if(!result[key]&&cached?.[key])result[key]=cached[key];
  if(!result.openingHours?.length&&cached?.openingHours?.length)result.openingHours=cached.openingHours;
  return result;
}
function cvAddressLink(stop){
  const amap=stop.source==='Amap'||stop.id?.startsWith('amap_');
  let href='';
  if(amap&&Number.isFinite(stop.lat)&&Number.isFinite(stop.lng)&&(stop.coordinateSystem==='GCJ-02'||stop.source==='Amap'))href='https://uri.amap.com/marker?'+new URLSearchParams({position:stop.lng+','+stop.lat,name:stop.originalName||stop.name,src:'JourneyHub',callnative:'1'});
  else href=cvURL(stop.sourceURL);
  if(!href&&amap&&/^amap_[A-Za-z0-9]+$/.test(stop.id))href='https://www.amap.com/place/'+encodeURIComponent(stop.id.slice(5));
  if(!href&&(stop.addressEnglish||stop.address)&&!amap)href='https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:[stop.name,stop.addressEnglish||stop.address].filter(Boolean).join(', ')});
  return {href,label:cvEnglish(stop.addressEnglish)||cvEnglish(stop.address)||(amap&&cvLegacyAddress(stop.address))||(amap?'View address on Amap':'View place on map')};
}
function cvEstimate(event,stop){
  const record=typeof dw!=='undefined'&&dw.owner===jhUser?.id?dw.quotes?.[dwKey(event.manageKind,event.manageId)]:null;
  const quote=record?.quote,valid=quote&&quote.status==='quoted'&&Date.parse(quote.expiresAt)>Date.now();
  return (valid?quote.items?.find(i=>i.stopId===stop.id):null)||stop.estimate||null;
}
function cvStatus(event,stop){
  const b=typeof ubStopBooking==='function'?ubStopBooking(event,stop):null;
  const receipt=typeof dwBookings==='function'&&dw.owner===jhUser?.id?dwBookings(event.manageKind,event.manageId).find(r=>r.stopId===stop.id):null;
  const virtual=b?.demo||['virtual_paid','demo_paid','simulated_paid'].includes(b?.paymentStatus);
  if(b){
    if(b.status==='cancelled')return {tone:'muted',label:'Cancelled',price:b.paymentStatus==='refunded'?'Credits refunded':'No active ticket',booking:b};
    if(b.status==='no_show')return {tone:'attention',label:'Missed visit',price:'View reservation',booking:b};
    if(b.status==='confirmed')return {tone:'paid',label:b.checkedIn?'Checked in':['virtual_paid','demo_paid','paid','simulated_paid'].includes(b.paymentStatus)?(virtual?'Paid with credits':'Paid'):'Reserved',price:typeof b.amountMinor==='number'?dwMoney(b.amountMinor)+' · group':b.paymentStatus==='legacy_unpaid'?'No payment taken':'',booking:b};
    return {tone:'attention',label:'Action needed',price:'Review reservation',booking:b};
  }
  if(receipt){
    if(receipt.status==='cancelled')return {tone:'muted',label:'Cancelled',price:receipt.paymentStatus==='refunded'?'Credits refunded':'',receipt};
    if(dwPaid(receipt))return {tone:'paid',label:'Paid with credits',price:dwMoney(receipt.amountMinor)+' · group',receipt};
    if(receipt.status==='unavailable')return {tone:'attention',label:'Action needed',price:'Check with venue',receipt};
  }
  const session=DBC.sessions[stop.sessionId],experience=session&&EXPS[session.exp];
  if(session&&experience){
    const left=Math.max(0,Number(session.cap||0)-Number(session.held||0)-Number(session.taken||0));
    const closed=session.closed||session.status!=='open'||Date.parse(session.startsAt)<=Date.now();
    const price=typeof slotPrice==='function'?slotPrice(session.exp,session):(session.price??experience.price);
    return {tone:closed||!left?'attention':'pending',label:closed?'Session closed':!left?'Sold out':'Booking required',price:Number.isFinite(price)?fmt(price)+' / guest':'Price to confirm',availability:closed?'Session closed':left+' seats available',session};
  }
  // A verified admission fact and a zero demo estimate are different things.
  const facts=stop.visitInfo,verified=facts?.verified===true&&cvURL(facts.sourceURL);
  if(verified&&facts.admission==='free'&&facts.reservationRequired===false)return {tone:'free',label:'No ticket needed',price:'Free admission'};
  if(verified&&facts.admission==='free')return {tone:'pending',label:'Free admission',price:facts.reservationRequired?'Reservation required':'Check booking rules'};
  const guide=attractionGuide(stop,event);
  const estimate=cvEstimate(event,stop);
  if(estimate&&Number.isSafeInteger(estimate.unitMinor)&&estimate.unitMinor>=0&&estimate.kind!=='unavailable'){
    if(estimate.kind==='free')return {tone:'muted',label:'No wallet charge',price:guide?'See entry rules':'Admission to confirm'};
    return {tone:'pending',label:'Awaiting payment',price:dwMoney(estimate.unitMinor)+(guide?' / guest · wallet estimate':' / guest · estimate'),estimate};
  }
  if (guide?.price) {
    const price=typeof guide.price==='function'?guide.price(event.date):guide.price;
    return {tone:price.startsWith('Free')?'free':'muted',label:'Admission',price:price.split('. ')[0]};
  }
  return {tone:'attention',label:calStopTheme(stop).key==='dining'?'Table booking to check':'Ticket details to check',price:'Price not confirmed'};
}
function cvStopHTML(event,original,index){
  const stop=cvPlace(event,original),theme=calStopTheme(stop),status=cvStatus(event,stop),link=cvAddressLink(stop);
  return '<li class="cal-schedule-stop cal-stop-'+theme.key+' cv-card" data-stop-id="'+esc(stop.id)+'"><button class="cv-open" data-act="cvOpen" data-a="'+esc(event.key)+'" data-b="'+esc(stop.id)+'" aria-label="View details for '+esc(stop.name)+'"></button><div class="cal-schedule-time"><span class="cal-stop-dot">'+(index+1)+'</span><time>'+esc(stop.time||stop.start||'Time not set')+(stop.end?'–'+esc(stop.end):'')+'</time><span class="cal-stop-category">'+theme.label+'</span></div><h4>'+esc(calReadableName(stop.name)?stop.name:'Saved visit')+'</h4>'+(link.href?'<a class="cv-address" href="'+esc(link.href)+'" target="_blank" rel="noopener noreferrer">'+ic('pin',14)+'<span>'+esc(link.label)+'</span>'+ic('right',13)+'</a>':'')+'<div class="cv-card-bottom"><span class="cv-details-hint">Details '+ic('right',13)+'</span><div class="cv-payment '+status.tone+'"><strong>'+esc(status.label)+'</strong>'+(status.price?'<small>'+esc(status.price)+'</small>':'')+'</div></div></li>';
}
A.cvOpen=(key,id)=>{const event=calEvents().find(e=>e.key===key),stop=event?.stops.find(s=>s.id===id);if(!event||!stop)return;ui.sheet={type:'calendar-visit',key,id,owner:jhUser?.id};render();if(calStopTheme(stop).key!=='dining'&&typeof cvLoadResearch==='function')void cvLoadResearch(event,id);};
A.cvReview=(type,id)=>{ui.sheet=null;A.dwReview(type,id);};
A.cvSession=id=>{ui.sheet=null;A.ubSession(id);};
A.cvTicket=id=>{ui.sheet=null;A.ticket(id);};
function cvPhotoHTML(stop){
  const url=cvURL(stop.photo?.url);if(!url)return '';
  const authors=(stop.photo.authors||[]).map(a=>cvEnglish(a.name)).filter(Boolean);
  return '<figure class="cv-photo"><img src="'+esc(url)+'" alt="'+esc(stop.name)+'" loading="lazy" decoding="async"><figcaption>'+esc([stop.source,authors.length?'Photo: '+authors.join(', '):''].filter(Boolean).join(' · '))+'</figcaption></figure>';
}
function cvVenueHTML(stop,event,hours,facts,verified,documents,status) {
  const attraction=calStopTheme(stop).key!=='dining';
  const data=stop.venueDetails || {};
  const todayHours=cvEnglish(data.todayHours);
  const datedHours=calDate(data.hoursDate) && todayHours;
  const rows=[];
  const factsBlock=(label,html)=>'<section class="cv-facts"><h3>'+label+'</h3>'+html+'</section>';
  if (attraction) {
    rows.push(cvAttractionHTML(stop,event,status));
  } else if (hours.length || datedHours) {
    const weekly=hours.map(h=>'<li>'+esc(h)+'</li>').join('');
    const dated=datedHours?'<p>'+esc(calFormat(data.hoursDate,{day:'numeric',month:'short',year:'numeric'}))+' · '+esc(todayHours)+'</p>':'';
    rows.push(factsBlock('Opening hours',(weekly?'<ul>'+weekly+'</ul>':'')+dated+'<small>'+esc(stop.source||'Venue')+' · Hours may change on holidays.</small>'));
  } else {
    const updating=typeof thSnapshotUpdating==='function' && thSnapshotUpdating(event.id);
    rows.push(factsBlock('Opening hours','<p>'+(updating?'Updating venue hours…':'Hours unlisted. Check with the venue.')+'</p>'));
  }
  const venue=[];
  if (Number.isFinite(data.rating)) venue.push('<li>Rating · '+esc(data.rating)+' / 5</li>');
  if (Number.isFinite(data.averageSpendCny)) venue.push('<li>Average spend · CNY '+esc(data.averageSpendCny)+' per person</li>');
  if (typeof data.phone==='string' && /^\+?[\d() -]{5,24}$/.test(data.phone)) {
    venue.push('<li>Phone · <a href="tel:'+esc(data.phone.replace(/[() -]/g,''))+'">'+esc(data.phone)+'</a></li>');
  }
  if (venue.length) rows.push(factsBlock('Venue information','<ul>'+venue.join('')+'</ul><small>Source: Amap</small>'));
  if (!attraction && verified && (facts.admission==='free'||cvEnglish(facts.admissionNote))) {
    const admission=facts.admission==='free'?'Free admission':cvEnglish(facts.admissionNote);
    rows.push(factsBlock('Tickets & admission','<p>'+esc(admission)+(facts.reservationRequired?' · Advance reservation required':'')+'</p>'));
  } else if (!attraction && status.availability) {
    rows.push(factsBlock('Session availability','<p>'+esc(status.availability)+' · JourneyHub session</p>'));
  }
  if (!attraction && documents.length) rows.push(factsBlock('What to bring','<p>'+esc(documents.join(' · '))+'</p>'));
  return rows.join('');
}
const cvOldSheet=sheetView;
sheetView=function(){
  const selection=ui.sheet;if(selection?.type!=='calendar-visit')return cvOldSheet();
  if(selection.owner!==jhUser?.id)return '';
  const event=calEvents().find(e=>e.key===selection.key),original=event?.stops.find(s=>s.id===selection.id);
  if(!original)return '<div class="scrim" data-act="scrim"><section class="sheet cv-sheet"><h2>This visit is no longer available</h2><button class="btn btn-soft" data-act="closeSheet">Close</button></section></div>';
  const stop=cvPlace(event,original),status=cvStatus(event,stop),link=cvAddressLink(stop),theme=calStopTheme(stop);
  const hours=(Array.isArray(stop.openingHours)?stop.openingHours:[]).map(cvEnglish).filter(Boolean),facts=stop.visitInfo,verified=facts?.verified===true&&cvURL(facts.sourceURL);
  const documents=verified&&Array.isArray(facts.documents)?facts.documents.map(cvEnglish).filter(Boolean):[];
  const bookingHTML=typeof dwStopHTML==='function'?dwStopHTML(event,stop):'';
  const booking= status.booking,canReview=event.manageKind&&event.manageId&&!event.sample;
  const action=booking?'<button class="btn btn-primary btn-block" data-act="cvTicket" data-a="'+esc(booking.id)+'">'+(booking.status==='cancelled'?'View cancelled record':'View ticket')+'</button>':stop.sessionId?'<button class="btn btn-primary btn-block" data-act="cvSession" data-a="'+esc(stop.sessionId)+'">Review session</button>':canReview?'<button class="btn btn-primary btn-block" data-act="cvReview" data-a="'+esc(event.manageKind)+'" data-b="'+esc(event.manageId)+'">'+ic('sparkle',17)+' Review booking with agent</button>':'';
  return '<div class="scrim" data-act="scrim"><section class="sheet cv-sheet" role="dialog" aria-modal="true" aria-label="'+esc(stop.name)+' details"><header class="cv-sheet-head"><span class="cal-stop-category">'+theme.label+'</span><button class="icon-btn" data-act="closeSheet" aria-label="Close visit details">'+ic('x',21)+'</button></header>'+cvPhotoHTML(stop)+'<div class="cv-sheet-content"><h2>'+esc(stop.name)+'</h2><p class="cv-visit-time">'+esc(calFormat(event.date,{day:'numeric',month:'short'}))+' · '+esc(stop.start||stop.time)+(stop.end?'–'+esc(stop.end):'')+' <small>Planned visit</small></p>'+(link.href?'<a class="cv-address" href="'+esc(link.href)+'" target="_blank" rel="noopener noreferrer">'+ic('pin',16)+esc(link.label)+' ↗</a>':'')+(cvEnglish(stop.reason)?'<p class="cv-reason">'+esc(stop.reason)+'</p>':'')+'<div class="cv-detail-status '+status.tone+'"><strong>'+esc(status.label)+'</strong><span>'+esc(status.price)+'</span></div>'+cvVenueHTML(stop,event,hours,facts,verified,documents,status)+(cvURL(facts?.sourceURL||stop.sourceURL)?'<a class="cv-source" href="'+esc(cvURL(facts?.sourceURL||stop.sourceURL))+'" target="_blank" rel="noopener noreferrer">'+esc(stop.source||'Venue')+' visitor information ↗</a>':'')+(bookingHTML?'<section class="cv-facts"><h3>Your reservation</h3>'+bookingHTML+'</section>':'')+action+'<p class="cv-demo-note">Reservations here use virtual credits. No money is charged or venue ticket issued.</p></div></section></div>';
};
// Delegated listeners survive rerenders and do not restart photo requests.
document.addEventListener('error',event=>{if(event.target?.matches?.('.cv-photo img')){const figure=event.target.closest('figure');if(figure)figure.hidden=true;}},true);
const cvOldTransfer=calTransferHTML;
calTransferHTML=function(event,from,to){
  const original=cvOldTransfer(event,from,to);if(!original)return '';
  const transit=tuDirectionsLink(from,to,'transit'),taxi=tuDirectionsLink(from,to,'drive');
  if(!transit||!taxi)return original;
  const template=document.createElement('template');template.innerHTML=original;const row=template.content.firstElementChild;
  row.querySelector('a')?.remove();
  const links=document.createElement('div');links.className='cv-transport-links';
  for(const [label,route] of [['Public transit',transit],['Taxi',taxi]]){const a=document.createElement('a');a.textContent=label+' ↗';a.href=route.href;a.target='_blank';a.rel='noopener noreferrer';a.title=route.title;links.append(a);}row.append(links);
  return template.innerHTML;
};
