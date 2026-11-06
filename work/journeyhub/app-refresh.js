/* Additive traveler UI. Original views/actions remain available beneath these overrides. */
// Replace the prototype's 188–634px embedded thumbnails with real, sharp photos.
// Workshop/store/product pictures are illustrations, not supplier product photography.
const ixFreshPhotos={
 craft:{image:'https://images.pexels.com/photos/5974280/pexels-photo-5974280.jpeg?auto=compress&fit=crop&w=1200&q=90',source:'https://www.pexels.com/photo/close-up-photo-of-craftsman-crafting-wood-5974280/',credit:'Ono Kosuki',alt:'Illustrative woodworking: a craftsperson carving wood',license:'Pexels License',licenseUrl:'https://www.pexels.com/license/',note:'Workshop illustration; not the listed host or venue.'},
 silk:{image:'https://images.pexels.com/photos/29848182/pexels-photo-29848182/free-photo-of-traditional-hand-weaving-on-a-loom.jpeg?auto=compress&fit=crop&w=1200&q=90',source:'https://www.pexels.com/photo/traditional-hand-weaving-on-a-loom-29848182/',credit:'HONG SON',alt:'Illustrative traditional hand weaving on a wooden loom',license:'Pexels License',licenseUrl:'https://www.pexels.com/license/',note:'Weaving illustration; not the listed host or venue.'},
 food:{image:'https://images.pexels.com/photos/36648767/pexels-photo-36648767/free-photo-of-vendor-in-traditional-hat-preparing-street-food.jpeg?auto=compress&fit=crop&w=1200&q=90',source:'https://www.pexels.com/photo/vendor-in-traditional-hat-preparing-street-food-36648767/',credit:'Aakash Goel',alt:'Street food preparation in Bangkok, illustrative photo',license:'Pexels License',licenseUrl:'https://www.pexels.com/license/',note:'Bangkok street-food illustration; not the listed operator.'},
 herbal:{image:'https://images.pexels.com/photos/5480236/pexels-photo-5480236.jpeg?auto=compress&fit=crop&w=1200&q=90',source:'https://www.pexels.com/photo/close-up-of-dry-herbs-and-mortar-and-pestle-5480236/',credit:'Yan Krukau',alt:'Dried herbs and a mortar, workshop illustration',license:'Pexels License',licenseUrl:'https://www.pexels.com/license/',note:'Herbal workshop illustration; not the listed venue.'},
 tote:{image:'https://images.pexels.com/photos/30382341/pexels-photo-30382341/free-photo-of-canvas-tote-bag-with-books-and-dried-flowers.jpeg?auto=compress&fit=crop&w=1200&q=90',source:'https://www.pexels.com/photo/canvas-tote-bag-with-books-and-dried-flowers-30382341/',credit:'fzaytt',alt:'Canvas tote with books and dried flowers, illustrative product photo',license:'Pexels License',licenseUrl:'https://www.pexels.com/license/'},
 scarf:{image:'https://images.pexels.com/photos/6070106/pexels-photo-6070106.jpeg?auto=compress&fit=crop&w=1200&q=90',source:'https://www.pexels.com/photo/elegant-smooth-blue-headscarf-composed-with-wildflowers-on-timber-table-6070106/',credit:'Teguh Sugi',alt:'Blue silk scarf with dried flowers, illustrative product photo',license:'Pexels License',licenseUrl:'https://www.pexels.com/license/'},
 balm:{image:'https://images.pexels.com/photos/6690236/pexels-photo-6690236.jpeg?auto=compress&fit=crop&w=1200&q=90',source:'https://www.pexels.com/photo/cream-in-a-jar-6690236/',credit:'Tara Winstead',alt:'Cream jar with natural leaves, illustrative product photo',license:'Pexels License',licenseUrl:'https://www.pexels.com/license/'},
 runner:{image:'https://c.pxhere.com/images/79/8f/531fa87fd923fd9f6cff36bea93e-1422459.jpg!d',source:'https://pxhere.com/en/photo/1422459',credit:'Cimi',alt:'A decorative table runner, illustrative product photo',license:'CC0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/'},
 wat:{image:'https://images.unsplash.com/photo-1762950297550-1d8d7cce12ae?auto=format&fit=crop&w=1600&q=90',source:'https://unsplash.com/photos/wat-arun-temple-illuminated-at-sunset-with-colorful-sky-MKVGJ4d3E6c',credit:'Haley Hong',alt:'Wat Arun temple beside the Chao Phraya river in Bangkok',license:'Unsplash License',licenseUrl:'https://unsplash.com/license'}
};
for(const [id,photo] of Object.entries(ixFreshPhotos))IMG[id]=photo.image;
IMG.tcraft=IMG.craft;IMG.tsilk=IMG.silk;IMG.rf=IMG.tote;IMG.ct=IMG.silk;
for(const collection of [SEED,DBC]){
 for(const id of ['craft','silk','food','herbal']){const e=collection.experiences?.[id],p=ixFreshPhotos[id];if(e)Object.assign(e,{img:p.image,thumb:p.image,alt:p.alt});}
 for(const id of ['tote','scarf','balm','runner']){const p=collection.products?.[id],photo=ixFreshPhotos[id];if(p){Object.assign(p,{img:photo.image,alt:photo.alt,pos:'50% 50%'});if(p.gallery)p.gallery=[photo,ixFreshPhotos.silk].map(x=>({src:x.image,alt:x.alt}));}}
 if(collection.stores?.rf)collection.stores.rf.img=IMG.rf;
 if(collection.stores?.ct)collection.stores.ct.img=IMG.ct;
}
const ixCities = {
  Bangkok: {...ixFreshPhotos.wat,headline:'Find your own<br>Bangkok.', area:'Riverside & beyond'},
  Shanghai: {image:'https://images.unsplash.com/photo-1751161749900-990bf22bb2ad?auto=format&fit=crop&w=1000&q=85', alt:'Shanghai skyline from the Bund', headline:'A different side<br>of Shanghai.', area:'The Bund & beyond', credit:'George Dagerotip', source:'https://unsplash.com/photos/shanghais-skyline-stands-tall-at-dusk-_klbOmCI05I'},
  Singapore: {image:'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?auto=format&fit=crop&w=1000&q=85', alt:'Marina Bay in Singapore at sunset', headline:'Small island.<br>Endless discovery.', area:'Marina Bay & beyond', credit:'Hu Chen', source:'https://unsplash.com/photos/marina-bay-sands-singapore-__cBlRzLSTg'}
};
const ixPhotos={
 craft:ixFreshPhotos.craft,silk:ixFreshPhotos.silk,food:ixFreshPhotos.food,herbal:ixFreshPhotos.herbal,
 'sh-oldtown':{image:'https://images.unsplash.com/photo-1550467576-a22a93fb3b52?auto=format&fit=crop&w=900&q=85',source:'https://unsplash.com/photos/FXzdsbhH5Dw',credit:'Yiran Ding',alt:'Yuyuan in Shanghai'},
 'sh-tea':{image:'https://images.unsplash.com/photo-1531876066433-09d3a1f79fac?auto=format&fit=crop&w=900&q=85',source:'https://unsplash.com/photos/person-pouring-water-on-ceramic-teapot-fLZeuI-OFBc',credit:'ORIENTO',alt:'Chinese tea ceremony, illustrative photo'},
 'sg-chinatown':{image:'https://images.unsplash.com/photo-1728494141437-ee81f251d56b?auto=format&fit=crop&w=900&q=85',source:'https://unsplash.com/photos/a-city-street-filled-with-lots-of-shops-s7sTmNlkKLw',credit:'Ivan Wong',alt:'Shophouses in Singapore Chinatown'},
 'sg-kampong':{image:'https://images.unsplash.com/photo-1746211724431-0c8ae575c3bb?auto=format&fit=crop&w=900&q=85',source:'https://unsplash.com/photos/a-golden-dome-adorns-the-magnificent-mosque-ljJ1VN2nF5I',credit:'Farnaz Kohankhaki',alt:'Sultan Mosque in Kampong Glam, Singapore'}
};
const ixPhotoInfo = e => e.details?.photo||ixPhotos[e.id]||ixCities[e.city];
const ixPhoto = e => e.details?.photo?.image || ixPhotos[e.id]?.image || (e.city==='Bangkok' ? e.img : ixPhotoInfo(e)?.image || e.img);
const ixAlt = e => e.details?.photo?.alt || ixPhotos[e.id]?.alt || (e.city==='Bangkok'?e.alt:ixPhotoInfo(e)?.alt||e.city+' destination inspiration');
function ixImageAttrs(image,sizes='(max-width: 460px) calc(100vw - 48px), 430px'){
 try{const url=new URL(image);if(!['images.pexels.com','images.unsplash.com'].includes(url.hostname))return ' decoding="async"';const variants=[480,960,1440].map(width=>{const variant=new URL(url);variant.searchParams.set('w',width);variant.searchParams.set('q','90');return esc(variant.href)+' '+width+'w';});return ' decoding="async" srcset="'+variants.join(', ')+'" sizes="'+sizes+'"';}catch{return '';}
}
const ixPhotoCredit=photo=>'<p class="ix-note jc-credit" style="font-size:13px;line-height:1.5;padding:12px 20px">Photo · <a href="'+esc(photo.source)+'" target="_blank" rel="noopener noreferrer">'+esc(photo.credit||'Source')+'</a>'+(photo.license?' · <a href="'+esc(photo.licenseUrl||photo.source)+'" target="_blank" rel="noopener noreferrer">'+esc(photo.license)+'</a>':' / Unsplash')+(photo.note?'<br>'+esc(photo.note):'')+'</p>';
const ixBadge = () => '<span class="ix-preview-label">Design preview</span>';
const ixAiEntry = () => '<button class="ix-ai-entry" data-act="ixStart"><span class="ix-orb">'+ic('sparkle',26)+'</span><span><span class="ix-eyebrow">AI CONCIERGE · PREVIEW</span><strong>A trip that feels like you.</strong></span><span class="ix-entry-right">'+ic('right',17)+'</span></button>';
Object.assign(TAB_OF, {ai:'journey','ai-plan':'journey','ai-tasks':'journey','ai-email':'journey',saved:'home','city-map':'home'});
// Keep input-driven search tied to the final city-aware function.
REGIONS.homeResults = () => homeResults();

expCard = function(id) {
  const e=EXPS[id];
  const price=e.details?.browseOnly?'<span class="price">Explore independently</span>':'<span class="price">'+fmt(e.price)+' <span class="ix-tag">/ guest</span></span>';
  return '<button class="xcard" data-act="go" data-a="exp" data-b="'+esc(id)+'"><span class="ix-card-image"><img src="'+esc(ixPhoto(e))+'" alt="'+esc(ixAlt(e))+'"'+ixImageAttrs(ixPhoto(e),'230px')+' loading="lazy"><span class="ix-duration">'+esc(e.dur)+'</span><span class="ix-fav">'+ic(state.saved[id]?'heartFill':'heart',16)+'</span></span><span class="ix-card-b"><span class="ix-tag">'+esc(e.kind)+' · '+esc(e.city)+'</span><span class="h3">'+esc(e.name)+'</span><span class="row-between">'+price+(e.details?.sample?'<span class="ix-tag">'+(e.details.browseOnly?'Browse only':'Sample')+'</span>':stars(e.rating))+'</span></span></button>';
};
V.home = () => {
  const c=ixCities[jhCity], need=myOrders().find(o=>orderInfo(o).needsChoice);
  const cats=[['all','For you'],['culture','Culture'],['food','Food'],['nature','Nature'],['family','Family'],['art','Art'],['workshops','Workshops'],['wellness','Wellness']].filter(([k])=>k==='all'||Object.values(EXPS).some(e=>e.city===jhCity&&e.cats.includes(k)));
  const list=Object.keys(EXPS).filter(k=>EXPS[k].city===jhCity&&(state.homeCat==='all'||EXPS[k].cats.includes(state.homeCat)));
  const saved=state.plan.aiDraft||state.plan.savedStops;
  return {tabs:true, bar:'<header class="bar top"><div class="ix-top-left">'+mark(28)+'<span class="ix-brand-name">journey hub<span style="color:var(--forest)">.</span></span></div><button class="icon-btn ring" data-act="bell" aria-label="Notifications">'+ic('bell',19)+(need?'<span class="dot"></span>':'')+'</button></header>', body:
    '<div class="ix-home"><div class="ix-citybar" role="group" aria-label="Destination">'+Object.keys(jhCities).map(k=>'<button data-act="destination" data-a="'+k+'" aria-pressed="'+(jhCity===k)+'">'+k+'</button>').join('')+'</div>'+
    '<div class="ix-hero"><img src="'+esc(c.image)+'" alt="'+esc(c.alt)+'"'+ixImageAttrs(c.image)+' fetchpriority="high"><span class="ix-hero-label">'+ic('pin',12)+esc(c.area)+'</span>'+(c.source?'<a class="ix-photo-credit" href="'+c.source+'" target="_blank" rel="noopener noreferrer" aria-label="Photo by '+c.credit+'">↗ Photo</a>':'')+'<div class="ix-hero-text"><span class="ix-eyebrow">Go beyond the guidebook</span><h1>'+c.headline+'</h1></div></div>'+
    '<label class="input ix-search">'+ic('search',19)+'<input id="home-q" type="search" data-in="homeQuery" value="'+esc(state.homeQuery)+'" placeholder="What would you love to discover?" aria-label="Search this destination"></label><div data-region="homeResults" class="results">'+homeResults()+'</div>'+
    '<div class="ix-home-content">'+
    '<div class="ix-quick"><button data-act="tab" data-a="journey"><i>'+ic('journey',21)+'</i>My journey</button><button data-act="go" data-a="saved"><i>'+ic('heart',21)+'</i>Saved</button><button data-act="ixMap"><i>'+ic('map',21)+'</i>City map</button><button data-act="tab" data-a="orders"><i>'+ic('calendar',21)+'</i>Calendar</button></div>'+
    (need?'<button class="ix-resume" data-act="go" data-a="order" data-b="'+esc(need.id)+'">'+ic('alert',20)+'<span>Choose your delivery option</span>'+ic('right',18)+'</button>':'')+
    (saved?'<button class="ix-resume" data-act="tab" data-a="journey">'+ic('journey',20)+'<span>Your journey is waiting</span>'+ic('right',18)+'</button>':'')+
    '<section><div class="ix-section-top"><h2>Worth a little detour</h2><button data-act="jcOpen">View all · '+list.length+' '+ic('right',12)+'</button></div><div class="ix-categories" role="group" aria-label="Categories">'+cats.map(([k,l])=>'<button data-act="homeCat" data-a="'+k+'" aria-pressed="'+(state.homeCat===k)+'">'+l+'</button>').join('')+'</div><div class="ix-carousel">'+list.map(expCard).join('')+'</div></section>'+
    '<p class="ix-note">Sample catalog · No payment taken</p></div></div>'};
};

let ixDraft=null, ixPrefs={city:jhCity,day:1,guests:2,prompt:''};
let ixOwner=jhUser?.id||null;
const ixCurrent = () => ixDraft || state.plan.aiDraft || null;
const ixRows = d => (d?.stops||[]).map(id=>DBC.sessions[id]).filter(s=>s&&EXPS[s.exp]);
const ixTotal = d => ixRows(d).reduce((n,s)=>n+slotPrice(s.exp,s)*(d.guests||2),0);
const ixLocalDate = d => dayLabel(Number(d.day)||0);
const ixSessionLabel = s => s.start||s.time||'';
const ixSegments = active => '<div class="ix-segments"><button data-act="go" data-a="ai-plan" aria-pressed="'+(active==='plan')+'">Itinerary</button><button data-act="go" data-a="ai-tasks" aria-pressed="'+(active==='tasks')+'">Trip tasks</button></div>';
function ixCover(d) {
  const c=ixCities[d.city]||ixCities.Bangkok;
  return '<div class="ix-plan-cover"><img src="'+esc(c.image)+'" alt="'+esc(c.alt)+'">'+ixBadge()+'<div><span class="ix-eyebrow">YOUR NEXT LITTLE ADVENTURE</span><h1>A day in '+esc(d.city)+'</h1><p class="ix-plan-meta">'+ixLocalDate(d)+' <span>·</span> '+d.guests+' guests <span>·</span> '+ixRows(d).length+' stops</p></div></div>';
}
A.ixStart = () => { ixPrefs.city=jhCity; go('ai'); };
A.ixEdit = () => {const d=ixCurrent();if(d)ixPrefs={city:d.city,day:d.day,guests:d.guests,prompt:d.prompt||''};go('ai');};
INPUTS.ixPrompt = v => {ixPrefs.prompt=String(v).slice(0,300);};
document.addEventListener('keydown',e=>{if(e.target.id==='ix-prompt'&&e.key==='Enter'&&!e.isComposing){e.preventDefault();A.ixBuild();}});
CHANGES.ixCity = el => {if(jhCities[el.value])ixPrefs.city=el.value;};
CHANGES.ixDay = el => {ixPrefs.day=Math.max(0,Math.min(6,Number(el.value)||0));};
CHANGES.ixGuests = el => {ixPrefs.guests=Math.max(1,Math.min(6,Number(el.value)||2));};
A.ixBuild = prompt => {
  const city=ixPrefs.city, day=ixPrefs.day, guests=ixPrefs.guests;
  const candidates=Object.values(DBC.sessions).filter(s=>EXPS[s.exp]?.city===city&&s.day===day&&!slotClosed(s)&&seatsLeft(s.exp,s.id)>=guests).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt));
  const picked=[], used=new Set();let end=0;
  for(const s of candidates){
    const start=new Date(s.startsAt).getTime();if(used.has(s.exp)||start<end)continue;
    picked.push(s.id);used.add(s.exp);end=start+(Number(EXPS[s.exp].details?.durationMinutes)||parseFloat(EXPS[s.exp].dur)*60||90)*60000+30*60000;
    if(picked.length===3)break;
  }
  ixDraft={version:1,preview:true,city,day,guests,stops:picked,prompt:String(prompt||ixPrefs.prompt||'A day of discovery').slice(0,300),reminders:false};
  go('ai-plan');
};
A.ixRemove = id => {const current=ixCurrent();if(!current)return;ixDraft=clone(current);ixDraft.stops=ixDraft.stops.filter(s=>s!==id);render();};
A.ixSave = () => {const d=ixCurrent();if(!d)return;state.plan.aiDraft=clone(d);save();toast(traveler()?'Journey draft saved':'Draft saved for this session');go('journey');};
A.ixResume = () => {ixDraft=state.plan.aiDraft?clone(state.plan.aiDraft):ixDraft;go('ai-plan');};
A.ixSession = id => {const s=DBC.sessions[id],d=ixCurrent();if(!s)return;state.expSel[s.exp]={slot:s.id,guests:d?.guests||2};go('exp',{id:s.exp});};
A.ixReminder = () => {const d=ixCurrent();if(!d)return;ixDraft=clone(d);ixDraft.reminders=!ixDraft.reminders;toast('Preview preference only · no email scheduled');render();};
A.ixMap = () => go(jhCity==='Bangkok'?'map':'city-map');

V.ai = () => ({bar:bar({title:'AI concierge',right:ixBadge()}),tabs:true,
  body:'<div class="ix-chat-head"><span class="ix-orb">'+ic('sparkle',32)+'</span><h1>Less planning.<br>More discovering.</h1><p>What does your perfect day feel like?</p></div><div class="ix-chat-settings"><select data-ch="ixCity" aria-label="AI destination">'+Object.keys(jhCities).map(c=>'<option'+(c===ixPrefs.city?' selected':'')+'>'+c+'</option>').join('')+'</select><select data-ch="ixDay" aria-label="Travel date">'+[0,1,2,3,4,5,6].map(d=>'<option value="'+d+'"'+(d===ixPrefs.day?' selected':'')+'>'+dayLabel(d)+'</option>').join('')+'</select><select data-ch="ixGuests" aria-label="Number of guests">'+[1,2,3,4,5,6].map(n=>'<option value="'+n+'"'+(n===ixPrefs.guests?' selected':'')+'>'+n+' guest'+(n===1?'':'s')+'</option>').join('')+'</select></div>'+
  '<div class="ix-prompt-grid">'+[['food','Local flavors'],['sun','Slow & scenic'],['globe','Culture first'],['sparkle','Surprise me']].map(([i,p])=>'<button class="ix-prompt" data-act="ixBuild" data-a="'+p+'"><span>'+ic(i,19)+'</span>'+p+'</button>').join('')+'</div><p class="ix-note" style="margin:8px 22px">Preview a sample itinerary from the current catalog.</p>'+(ixCurrent()?'<div style="margin:20px"><button class="ix-resume" data-act="go" data-a="ai-plan">'+ic('journey',18)+'<span>Continue your draft</span>'+ic('right',18)+'</button></div>':''),
  foot:'<div class="ix-chat-foot"><div class="ix-composer"><input id="ix-prompt" data-in="ixPrompt" value="'+esc(ixPrefs.prompt)+'" placeholder="Coffee, culture, no early starts…" aria-label="Describe your trip"><button class="ix-send" data-act="ixBuild" aria-label="Preview an itinerary">'+ic('right',18)+'</button></div><p class="ix-ai-status">Design preview · AI service not connected</p></div>'
});
V['ai-plan'] = () => {
  const d=ixCurrent();if(!d)return {bar:bar({title:'Your itinerary'}),tabs:true,body:'<div class="content">'+ixAiEntry()+'<p class="ix-detail-note">Start with a destination and a little inspiration.</p></div>'};
  return {bar:bar({title:'Your itinerary',right:'<button class="icon-btn" data-act="ixEdit" aria-label="Edit trip preferences">'+ic('sliders',20)+'</button>'}),tabs:true,body:ixCover(d)+ixSegments('plan')+
    '<div class="ix-timeline">'+(ixRows(d).length?ixRows(d).map((s,i)=>{const e=EXPS[s.exp];return '<div class="ix-stop"><div class="ix-stop-track"><span class="ix-stop-number">'+(i+1)+'</span></div><div class="ix-stop-content"><p class="ix-stop-time">'+esc(ixSessionLabel(s))+' · '+esc(e.dur)+'</p><div class="ix-stop-card"><div class="ix-stop-card-top"><img src="'+esc(ixPhoto(e))+'" alt=""><div><h3>'+esc(e.name)+'</h3><p>'+esc(e.kind)+'</p><p>'+fmt(slotPrice(s.exp,s))+' / guest</p></div></div><div class="ix-stop-actions"><button data-act="ixSession" data-a="'+esc(s.id)+'">View session '+ic('right',12)+'</button><button class="ix-remove" data-act="ixRemove" data-a="'+esc(s.id)+'" aria-label="Remove '+esc(e.name)+'">'+ic('x',13)+'</button></div></div></div></div>';}).join(''):'<p class="ix-empty-mini">No available stops for this date. Try another day.</p>')+'</div>'+
    '<div class="ix-plan-actions"><button data-act="ixEdit">'+ic('sliders',14)+' Edit preferences</button><button data-act="go" data-a="ai-tasks">'+ic('ticket',14)+' Review trip tasks</button></div><p class="ix-note" style="margin:0 20px 20px">Sample route · Local times · Stops are not reserved</p>',
    foot:'<div class="foot"><div class="ix-price-foot"><span><small>Sample subtotal · '+d.guests+' guests</small><strong>'+fmt(ixTotal(d))+'</strong></span><button class="btn btn-primary" data-act="ixSave"'+(!ixRows(d).length?' disabled':'')+'>Save to Journey</button></div></div>'};
};
V['ai-tasks'] = () => {
  const d=ixCurrent();
  if(!d)return {bar:bar({title:'Trip tasks',right:ixBadge()}),tabs:true,body:'<div class="content">'+ixAiEntry()+'<div class="empty"><span class="tile-ic">'+ic('ticket',28)+'</span><h2 class="h2">Your next step starts here</h2><p class="lead">Create a draft to review sessions and reminders.</p></div></div>'};
  return {bar:bar({title:'Trip tasks',right:ixBadge()}),tabs:true,body:ixSegments('tasks')+'<div class="content"><section class="ix-task-section"><h2>Reservations · '+ixRows(d).length+' sessions</h2>'+ixRows(d).map(s=>{const e=EXPS[s.exp],b=bookingFor(s.id);return '<article class="ix-task"><div class="ix-task-main"><span class="ix-task-icon">'+ic('ticket',18)+'</span><div><h3>'+esc(e.name)+'</h3><p>'+ixLocalDate(d)+' · '+esc(ixSessionLabel(s))+' · '+d.guests+' guests</p></div></div><button class="ix-task-button" data-act="'+(b?'ticket':'ixSession')+'" data-a="'+esc(b?b.id:s.id)+'">'+(b?'View sample reservation':'Review session')+ic('right',15)+'</button></article>';}).join('')+'</section><section class="ix-task-section"><h2>Stay a step ahead</h2><article class="ix-task"><div class="row-between"><div class="ix-task-main"><span class="ix-task-icon">'+ic('bell',18)+'</span><div><h3>Trip reminders</h3><p>'+(d.reminders?'Selected for this draft':'Off for this draft')+' · Not scheduled</p></div></div><button class="ix-toggle" role="switch" aria-label="Preview trip reminders" aria-checked="'+!!d.reminders+'" data-act="ixReminder"></button></div><button class="ix-task-button" data-act="go" data-a="ai-email">Preview email '+ic('right',15)+'</button></article></section><p class="ix-detail-note">Review each session before reserving. Automatic booking and email delivery are not connected.</p></div>'};
};
V['ai-email'] = () => {
  const d=ixCurrent();return {bar:bar({title:'Reminder preview',right:ixBadge()}),tabs:true,body:'<div class="content"><div class="ix-mail-preview"><div class="brandrow">'+mark(25)+'<b>journey hub.</b></div><h2>Your next adventure<br>is almost here.</h2><p>'+(d?esc(d.city)+' · '+ixLocalDate(d):'Your destination')+'</p><hr>'+ixRows(d).map(s=>'<p><b>'+esc(ixSessionLabel(s))+'</b> &nbsp; '+esc(EXPS[s.exp].name)+'</p>').join('')+'<hr><p>Check your itinerary for session details and reservation status.</p><button class="btn btn-primary btn-block" style="margin-top:18px" data-act="go" data-a="ai-plan">Open my itinerary</button></div><p class="ix-note">Email preview · Nothing has been sent or scheduled</p></div>'};
};
V.saved = () => {const ids=Object.keys(state.saved).filter(id=>state.saved[id]&&EXPS[id]);return {bar:bar({title:'Saved experiences'}),tabs:true,body:'<div class="content">'+(ids.length?'<div class="ix-saved-grid">'+ids.map(expCard).join('')+'</div>':'<div class="empty"><span class="tile-ic">'+ic('heart',30)+'</span><h2 class="h2">Keep something for later</h2><p class="lead">Tap the heart on an experience to save it.</p><button class="btn btn-primary" data-act="tab" data-a="home">Explore experiences</button></div>')+'</div>'};};
V['city-map'] = () => ({bar:bar({title:jhCity+' places'}),tabs:true,body:'<div class="content"><div class="ix-plan-cover" style="margin:0"><img src="'+esc(ixCities[jhCity].image)+'" alt="'+esc(ixCities[jhCity].alt)+'"><div><span class="ix-eyebrow">Explore the neighborhood</span><h1>'+jhCity+'</h1></div></div><div class="list">'+Object.values(EXPS).filter(e=>e.city===jhCity).map(e=>'<a class="li" href="https://www.google.com/maps/search/?api=1&amp;query='+encodeURIComponent(e.details?.mapSearch||e.venue+' '+e.city)+'" target="_blank" rel="noopener noreferrer"><span class="tile-ic">'+ic('pin',19)+'</span><span class="li-main"><span class="li-title">'+esc(e.name)+'</span><span class="meta">'+esc(e.venue)+'</span></span>'+ic('right',18)+'</a>').join('')+'</div></div>'});

const ixOriginalJourney=V.journey;
V.journey=()=>{
  const v=ixOriginalJourney(),d=ixCurrent();
  v.bar='<header class="bar top"><h1 class="h1" style="flex:1">Journey</h1></header>';
  const entry='<section class="ix-journey-ai" aria-label="AI trip planning">'+ixAiEntry()+
    (d?'<button class="ix-resume" data-act="go" data-a="ai-plan">'+ic('journey',21)+'<span>'+esc(d.city)+' · Your AI draft<small class="ix-sub" style="display:block;margin-top:3px">'+ixLocalDate(d)+' · '+d.stops.length+' stops · Preview</small></span>'+ic('right',18)+'</button>':'')+
    '<button class="ix-journey-tasks" data-act="go" data-a="ai-tasks"><span class="ix-task-icon">'+ic('ticket',18)+'</span><span class="li-main"><strong>Trip tasks</strong><span class="ix-sub">Reservations & reminders</span></span>'+ic('right',18)+'</button></section>';
  v.body=v.body.replace('<div class="content">','<div class="content">'+entry).replace('Build a day with Claude, or book an experience from Explore.','Plan a day or book an experience from Explore.').replace('Plan a day</button>','Bangkok day planner</button>');
  if(d)v.body=v.body.replace('No plans yet','Your bookings belong here');
  v.body=v.body.replace('<button class="btn btn-primary btn-block" data-act="go" data-a="planner">','<button class="btn btn-primary btn-block" data-act="ixStart">').replace('Bangkok day planner</button>','Plan my trip</button>');
  return v;
};
// Keep all original date, seat, guest, booking and favorite controls on detail pages.
const ixOriginalExp=V.exp;
V.exp=()=>{
 const v=ixOriginalExp(),e=EXPS[state.params.id];if(!e)return v;
 const photo=ixPhotoInfo(e);v.body=v.body.replace('<img src="'+esc(e.img)+'" alt="'+esc(e.alt)+'">','<img src="'+esc(ixPhoto(e))+'" alt="'+esc(ixAlt(e))+'"'+ixImageAttrs(ixPhoto(e))+'>');
 if(e.details?.sample)v.body=v.body.replace('<p class="lead">'+esc(e.details.en)+'</p>',e.details.summary?'<p class="lead">'+esc(e.details.summary)+'</p>':'');
 if(photo?.source)v.body+=ixPhotoCredit(photo);return v;
};
const ixOriginalProductCard=productCard;
productCard=function(id){const p=PRODUCTS[id],photo=ixFreshPhotos[id];let html=ixOriginalProductCard(id);if(photo)html=html.replace('<img class="pcard-img"','<img'+ixImageAttrs(p.img,'(max-width: 460px) calc((100vw - 60px) / 2), 196px')+' class="pcard-img"').replace('<span class="pcard-b">','<span class="pcard-b"><span class="cap">Illustrative photo</span>');return html;};
const ixOriginalProduct=V.product;
V.product=()=>{const view=ixOriginalProduct(),id=state.params.id||'scarf',photo=ixFreshPhotos[id];if(!photo)return view;const t=document.createElement('template');t.innerHTML=view.body;t.content.querySelectorAll('img').forEach(img=>{const temp=document.createElement('template');temp.innerHTML='<img'+ixImageAttrs(img.getAttribute('src'))+'>';for(const attr of temp.content.firstChild.attributes)img.setAttribute(attr.name,attr.value);});view.body=t.innerHTML+ixPhotoCredit({...photo,note:'Illustrative product photography. Actual design and contents depend on the supplier.'})+(id==='scarf'?ixPhotoCredit(ixFreshPhotos.silk):'');return view;};

const ixOriginalRender=render;
render=function(){const owner=jhUser?.id||null;if(owner!==ixOwner){ixOwner=owner;ixDraft=null;ixPrefs={city:jhCity,day:1,guests:2,prompt:''};}ixOriginalRender();app.dataset.route=state.route;app.dataset.role=state.role||'traveler';};
