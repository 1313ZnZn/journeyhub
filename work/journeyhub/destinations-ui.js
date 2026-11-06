// City selection is a browsing preference; bookings keep their own destination.
const jhCities={Bangkok:{label:'Bangkok',greeting:'Hello, Bangkok',intro:'Workshops, food walks and local culture.',tz:'Asia/Bangkok'},Shanghai:{label:'Shanghai',greeting:'Hello, Shanghai',intro:'Discover waterfront architecture, old-town flavors and tea traditions.',tz:'Asia/Shanghai'},Singapore:{label:'Singapore',greeting:'Hello, Singapore',intro:'Explore the bay, heritage neighborhoods and the flavors of Singapore.',tz:'Asia/Singapore'}};
let jhCity='Bangkok';try{const saved=sessionStorage.getItem('journeyhub-city');if(jhCities[saved])jhCity=saved;}catch{}
function jhSetCity(city,{syncPreferences=true}={}){
 if(!jhCities[city])return false;jhCity=city;try{sessionStorage.setItem('journeyhub-city',city);}catch{}
 if(syncPreferences&&typeof ag!=='undefined'&&ag.prefs&&ag.prefs.city!==city){ag.prefs.city=city;ag.prefs.preferredExperienceIds=[];ag.prefs.excludedExperienceIds=[];if(typeof jpUndo!=='undefined')jpUndo=[];if(typeof jpSavePrefs==='function')jpSavePrefs();}
 return true;
}
const jhCityPicker=()=>'<div class="chips wrap" role="group" aria-label="Destination">'+Object.entries(jhCities).map(([key,c])=>'<button class="chip" data-act="destination" data-a="'+key+'" aria-pressed="'+(jhCity===key)+'">'+c.label+'</button>').join('')+'</div>';
A.destination=city=>{if(!jhSetCity(city))return;state.homeCat='all';state.homeQuery='';state.route='home';state.params={};scrollTop=true;render();};
const jhOriginalExpCard=expCard;
expCard=function(id){const e=EXPS[id];if(!e.details?.sample)return jhOriginalExpCard(id);return '<button class="xcard" data-act="go" data-a="exp" data-b="'+esc(id)+'"><img src="'+esc(e.img)+'" alt="'+esc(e.alt)+'" loading="lazy"><span class="xcard-b"><span class="cap">'+esc(e.city)+' · '+esc(e.kind)+' · '+esc(e.dur)+'</span><span class="h3">'+esc(e.name)+'</span><span class="cap">'+esc(e.details.en)+'</span><span class="row-between" style="margin-top:6px"><span class="price">'+fmt(e.price)+' <span class="cap">/ person</span></span><span class="badge b-muted">Sample</span></span></span></button>';};
homeResults=function(){
 const q=state.homeQuery.trim().toLowerCase();if(!q)return '';
 const ex=Object.values(EXPS).filter(e=>e.city===jhCity&&[e.name,e.details?.en,e.details?.summary,e.kind,e.venue,e.city,...e.cats,...e.does].join(' ').toLowerCase().includes(q));
 const pr=jhCity==='Bangkok'?Object.values(PRODUCTS).filter(p=>(p.name+' '+STORES[p.store].name+' '+p.cats.join(' ')).toLowerCase().includes(q)):[];
 const st=jhCity==='Bangkok'?Object.values(STORES).filter(s=>(s.name+' '+s.area+' '+s.kind).toLowerCase().includes(q)):[];
 if(!ex.length&&!pr.length&&!st.length)return '<div class="notice plain">No matches in this destination. Try another keyword.</div>';
 return '<div class="list">'+ex.map(e=>'<button class="li" data-act="go" data-a="exp" data-b="'+esc(e.id)+'"><img class="thumb sm" src="'+esc(e.thumb)+'" alt=""><span class="li-main"><span class="li-title">'+esc(e.name)+'</span><span class="meta">'+esc(e.city)+' · '+fmt(e.price)+'</span></span>'+ic('right',18)+'</button>').join('')+pr.map(p=>'<button class="li" data-act="go" data-a="product" data-b="'+esc(p.id)+'"><span class="li-title">'+esc(p.name)+' · '+fmt(p.price)+'</span>'+ic('right',18)+'</button>').join('')+st.map(s=>'<button class="li" data-act="shopStore" data-a="'+esc(s.id)+'"><span class="li-title">'+esc(s.name)+' · '+esc(s.area)+'</span>'+ic('right',18)+'</button>').join('')+'</div>';
};
const jhOriginalHome=V.home;
V.home=()=>{
 const c=jhCities[jhCity],date=new Intl.DateTimeFormat('en-GB',{timeZone:c.tz,day:'numeric',month:'short',weekday:'short'}).format(new Date());
 if(jhCity==='Bangkok'){
  const v=jhOriginalHome();v.body=v.body.replace('<div class="content">','<div class="content">'+jhCityPicker());return v;
 }
 const cats=[['all','All'],['culture','Culture'],['food','Food'],['workshops','Workshops']].filter(([key])=>key==='all'||Object.values(EXPS).some(e=>e.city===jhCity&&e.cats.includes(key)));
 const list=Object.keys(EXPS).filter(k=>EXPS[k].city===jhCity&&(state.homeCat==='all'||EXPS[k].cats.includes(state.homeCat)));
 return {bar:'<header class="bar top"><div class="brandrow">'+mark(32)+'<span class="wordmark">Journey Hub</span></div></header>',tabs:true,body:'<div class="content">'+jhCityPicker()+
  '<div class="stack-8"><span class="meta">'+ic('pin',16)+' '+c.label+' · '+date+'</span><h1 class="h1">'+c.greeting+'</h1><p class="lead">'+c.intro+'</p></div>'+
  '<label class="input">'+ic('search',20)+'<input id="home-q" type="search" data-in="homeQuery" value="'+esc(state.homeQuery)+'" placeholder="Search experiences, neighborhoods or keywords" aria-label="Search this destination"></label><div data-region="homeResults" class="results">'+homeResults()+'</div>'+
  '<div class="chips wrap" role="group" aria-label="Categories">'+cats.map(([key,label])=>'<button class="chip" data-act="homeCat" data-a="'+key+'" aria-pressed="'+(state.homeCat===key)+'">'+label+'</button>').join('')+'</div>'+
  '<section class="stack-12"><div class="sec-head"><h2 class="h2">'+c.label+' experiences</h2><span class="cap">'+list.length+' experiences</span></div><div class="carousel">'+list.map(expCard).join('')+'</div></section>'+
  '<p class="cap">Sample experiences and sessions. Local operators are not connected. Base prices are in THB. Converted amounts are estimates. No payment is taken.</p></div>'};
};
const jhOriginalExp=V.exp;
V.exp=()=>{
 const id=state.params.id||'craft',e=EXPS[id];if(!e?.details?.sample)return jhOriginalExp();
 const slots=allSlots(id),sel=state.expSel[id]||{},slot=slots.find(s=>s.id===sel.slot)||slots.find(s=>!slotClosed(s)&&seatsLeft(id,s.id)>0)||slots[0];
 const left=slot?seatsLeft(id,slot.id):0,closed=!slot||slotClosed(slot),mine=slot&&bookingFor(slot.id),max=Math.max(1,Math.min(left,6)),guests=Math.min(sel.guests||state.planner.travelers||2,max),price=slot?slotPrice(id,slot):e.price;
 const sample='<div class="notice plain"><span>'+(e.details.browseOnly?'Explore independently. Ferry planning is required, so this place is not included in automatic road itineraries.':e.details.summary?'Sample itinerary. Admission, meals, transport and guided services are separate. Prices and sessions are illustrative. Saved reservations are not operator-confirmed tickets. No payment is taken.':'Sample experience. Reservations are saved online but are not operator-confirmed tickets. Base prices are in THB. No payment is taken.')+'</span></div>';
 const visitor=e.details.source?'<section class="jc-visitor"><p>'+esc(e.details.visitorNote||'Check current admission and opening arrangements before visiting.')+'</p><a href="'+esc(e.details.source)+'" target="_blank" rel="noopener noreferrer">Official visitor information '+ic('right',12)+'</a></section>':'';
 const map='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(e.details.mapSearch);
 return {bar:bar({title:jhCities[e.city].label,back:true}),foot:e.details.browseOnly?'<div class="foot"><a class="btn btn-primary btn-block" href="'+esc(map)+'" target="_blank" rel="noopener noreferrer">Explore area map</a></div>':'<div class="foot"><div class="row-between"><span class="stack"><b>'+fmt(price*guests)+'</b><span class="cap">'+guests+' guests · sample total</span></span>'+(mine?'<span class="badge b-ok">Reserved '+esc(mine.id)+'</span>':closed||!left?'<span class="badge b-muted">No availability</span>':'<button class="btn btn-primary" data-act="book" data-a="'+esc(id)+'" data-b="'+esc(slot.id)+'"'+(ui.busy?' disabled':'')+'>'+(ui.busy?'Saving…':'Reserve sample session')+'</button>')+'</div></div>',body:
 '<div class="cover"><img src="'+esc(e.img)+'" alt="'+esc(e.alt)+'"><button class="icon-btn" style="right:14px" data-act="save" data-a="'+esc(id)+'" aria-label="Save experience" aria-pressed="'+!!state.saved[id]+'">'+ic(state.saved[id]?'heartFill':'heart',20)+'</button></div><div class="content"><div class="stack-8"><h1 class="h1">'+esc(e.name)+'</h1><p class="lead">'+esc(e.details.en)+'</p><p class="meta">'+esc(e.dur)+' · '+esc(e.lang)+' · '+esc(e.city)+'</p><a class="link" href="'+esc(map)+'" target="_blank" rel="noopener noreferrer">'+ic('pin',16)+esc(e.venue)+' · View area map</a></div>'+sample+
 '<section class="card stack-12"><h2 class="h3">What to expect</h2><div class="bullets">'+e.does.map(d=>'<div class="bullet">'+ic('check',20)+'<span>'+esc(d)+'</span></div>').join('')+'</div><p class="cap">The meeting point and guide will be confirmed when an operator is connected.</p></section>'+
 visitor+'<section class="stack-12"><h2 class="h3">'+(e.details.browseOnly?'Independent visit':'Choose a date and session')+'</h2><p class="cap">All times are local: '+esc(e.timeZone)+'.</p><div class="slots" role="group" aria-label="Dates">'+slots.map(s=>'<button class="slot" data-act="expSlot" data-a="'+esc(id)+'" data-b="'+esc(s.id)+'" aria-pressed="'+(slot?.id===s.id)+'"><small>'+weekdayShort(s.day)+'</small><b>'+dayShort(s.day)+'</b><small>'+(bookingFor(s.id)?'Reserved':slotClosed(s)?'Ended':seatsLeft(id,s.id)+' seats')+'</small></button>').join('')+'</div>'+(slot?'<div class="card row-between"><b>'+esc(slot.time)+'</b><span class="meta">'+left+' / '+slot.cap+' seats</span></div>':'<div class="notice plain">'+(e.details.browseOnly?'Browse only · arrange your visit separately':'No sessions available')+'</div>')+'</section>'+
 (!mine&&!closed&&left?'<div class="stepper-card"><span class="h3">Guests</span>'+stepper('expGuests',guests,guests<=1,guests>=max,'guests',id)+'</div>':'')+
 (e.details.browseOnly?'':'<div class="card sum"><div class="sum-row"><span>'+fmt(price)+' × '+guests+'</span><b>'+fmt(price*guests)+'</b></div><p class="cap">Reservation total · '+jhBaseMoney(price*guests)+'. See the description for food and ticket inclusions. No payment is required.</p></div>')+'</div>'};
};
// The existing automatic day planner is specifically for Bangkok. Other cities
// can be booked individually; never blend their sessions into a Bangkok route.
const jhOriginalPlanner=V.planner;
V.planner=()=>{const v=jhOriginalPlanner();v.bar=bar({title:'Bangkok day planner'});v.body=v.body.replace('Tell us about your day','Plan your Bangkok day');return v;};
const jhOriginalShop=V.shop;
V.shop=()=>{const v=jhOriginalShop();if(jhCity!=='Bangkok')v.body='<div class="notice plain" style="margin:16px">The shop currently lists Bangkok stores. Shanghai and Singapore stores are not connected yet.</div>'+v.body;return v;};
