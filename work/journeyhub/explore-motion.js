/* Explore on wide screens, cinematic motion version (design canvas: "Explore · motion").
   A city stage with skyline, giant title, fog and an orbit of city thumbnails, a sticky search
   pill, shortcut pills and a card grid. Data and actions are the existing Explore ones:
   destination, category, search, save, reservations and experience pages. Phones keep V.home. */
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const calm=window.matchMedia?.('(prefers-reduced-motion:reduce)');
  const CITIES=['Bangkok','Shanghai','Singapore'];
  const TOUR_MS=7000;
  let playing=!calm?.matches,dir=1;
  const angles={};

  const cityIndex=()=>Math.max(0,CITIES.indexOf(jhCity));
  // Each city keeps an unwrapped angle so it always travels the short way round the ring.
  function angle(i,ci){
    const r=((i-ci)%3+3)%3,target=r===0?180:r===1?228:132,prev=angles[i];
    let a=target;
    if(prev!=null){
      if(dir>0){while(a>prev)a-=360;while(a+360<=prev)a+=360;}
      else{while(a<prev)a+=360;while(a-360>=prev)a-=360;}
    }
    angles[i]=a;return a;
  }
  const thumbStyle=(i,ci)=>'--a:'+angle(i,ci)+'deg;--s:'+(i===ci?'var(--s-on,132px)':'var(--s-off,64px)');
  const headline=c=>(ixCities[c]?.headline||c).replace(/<br>/g,' ');
  const area=c=>ixCities[c]?.area||c;
  const cats=()=>[['all','For you'],['culture','Culture'],['food','Food'],['nature','Nature'],['family','Family'],['art','Art'],['workshops','Workshops'],['wellness','Wellness']]
    .filter(([k])=>k==='all'||Object.values(EXPS).some(e=>e.city===jhCity&&e.cats.includes(k)));
  const listIds=()=>Object.keys(EXPS).filter(k=>EXPS[k].city===jhCity&&(state.homeCat==='all'||EXPS[k].cats.includes(state.homeCat)));
  const heart='<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-9-9.1C1.6 7.6 3.6 4.5 6.9 4.5c2 0 3.4 1.1 5.1 3c1.7-1.9 3.1-3 5.1-3c3.3 0 5.3 3.1 3.9 6.4C19 15.6 12 20 12 20Z"/></svg>';
  const pauseIc='<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  const playIc='<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';

  function card(id,i){
    const e=EXPS[id],browse=e.details?.browseOnly;
    const price=browse?'Explore independently':fmt(e.price)+' / guest';
    const badge=e.details?.sample?'<span class="ex-chip">'+(browse?'Browse only':'Sample')+'</span>':'<span class="ex-chip is-star">★ '+esc(String(e.rating))+'</span>';
    return '<article class="ex-card" style="--i:'+Math.min(i,11)+';--col:'+(i%4)+'"><button type="button" class="ex-card-in" data-act="go" data-a="exp" data-b="'+esc(id)+'" aria-label="Open '+esc(e.name)+'">'+
      '<span class="ex-art"><img src="'+esc(ixPhoto(e))+'" alt=""'+ixImageAttrs(ixPhoto(e),'300px')+' loading="lazy"></span><span class="ex-price">'+price+'</span>'+
      '<span class="ex-card-text"><strong>'+esc(e.name)+'</strong><small>'+ic('pin',14)+esc(e.kind)+' · '+esc(e.city)+'</small><span class="ex-meta"><span class="ex-chip">'+esc(e.dur)+'</span>'+badge+'</span></span></button>'+
      '<button type="button" class="ex-heart" data-act="save" data-a="'+esc(id)+'" aria-pressed="'+!!state.saved[id]+'" aria-label="'+(state.saved[id]?'Remove ':'Save ')+esc(e.name)+'">'+heart+'</button></article>';
  }
  function listing(){
    const ids=listIds();
    return '<section class="ex-list" data-dx-list><div class="ex-section-head"><h2>Worth a little detour</h2><div class="ex-cats" role="group" aria-label="Categories">'+
      cats().map(([k,l])=>'<button type="button" class="chip" data-act="homeCat" data-a="'+k+'" aria-pressed="'+(state.homeCat===k)+'">'+l+'</button>').join('')+'</div>'+
      '<button type="button" class="ex-viewall" data-act="jcOpen">View all · '+ids.length+' '+ic('right',16)+'</button></div>'+
      (ids.length?'<div class="ex-grid">'+ids.map(card).join('')+'</div>':'<div class="ex-empty"><h3>Nothing in this category yet</h3><p>Try another category or switch city.</p></div>')+
      '<p class="ex-note">Sample catalog · No payment taken</p></section>';
  }
  function quick(){
    const n=myBookings().length,need=myOrders().find(o=>orderInfo(o).needsChoice);
    return '<nav class="ex-quick" aria-label="Shortcuts">'+
      (need?'<button type="button" class="ex-pill is-key" data-act="go" data-a="order" data-b="'+esc(need.id)+'">'+ic('alert',18)+'Choose your delivery option</button>':'')+
      '<button type="button" class="ex-pill'+(need?'':' is-key')+'" data-act="go" data-a="reserved-trips">'+ic('ticket',18)+'Your reservations <small>'+(n?plural(n,'reserved session'):'None yet')+'</small></button>'+
      '<button type="button" class="ex-pill" data-act="tab" data-a="journey">'+ic('journey',18)+'My journey</button>'+
      '<button type="button" class="ex-pill" data-act="go" data-a="saved">'+ic('heart',18)+'Saved</button>'+
      '<button type="button" class="ex-pill" data-act="ixMap">'+ic('map',18)+'City map</button>'+
      '<button type="button" class="ex-pill" data-act="tab" data-a="orders">'+ic('calendar',18)+'Calendar</button></nav>';
  }
  function hero(){
    const ci=cityIndex(),on=i=>i===ci?' is-on':'';
    return '<section class="ex-hero" data-city="'+CITIES[ci]+'" aria-label="Explore '+CITIES[ci]+'"><h1 class="ex-sr">Explore '+CITIES[ci]+'</h1>'+
      '<div class="ex-layer ex-back-stack">'+CITIES.map((c,i)=>'<div class="ex-scene'+on(i)+'" data-i="'+i+'"><div class="ex-kb">'+dxExArt.back[c]+'</div></div>').join('')+'</div>'+
      '<div class="ex-giant-wrap" aria-hidden="true">'+CITIES.map((c,i)=>'<h2 class="ex-giant'+on(i)+'" data-i="'+i+'">'+[...c.toUpperCase()].map((ch,j)=>'<span style="--i:'+j+'">'+ch+'</span>').join('')+'</h2>').join('')+'</div>'+
      '<div class="ex-layer ex-front-stack">'+CITIES.map((c,i)=>'<div class="ex-scene ex-front'+on(i)+'" data-i="'+i+'"><div class="ex-kb">'+dxExArt.front[c]+'</div></div>').join('')+'</div>'+
      '<div class="ex-fog ex-fog-a">'+dxExArt.fog[0]+'</div><div class="ex-fog ex-fog-b">'+dxExArt.fog[1]+'</div><div class="ex-fog-base"></div><div class="ex-veil"></div>'+
      '<div class="ex-orbit-wrap"><div class="ex-orbit"><span class="ex-ring r2"></span><span class="ex-ring r1"></span><span class="ex-halo"></span>'+
      CITIES.map((c,i)=>'<button type="button" class="ex-thumb'+on(i)+'" data-act="dxExCity" data-a="'+c+'" data-i="'+i+'" style="'+thumbStyle(i,ci)+'" aria-label="Show '+c+'" aria-pressed="'+(i===ci)+'">'+dxExArt.thumb[c]+'</button>').join('')+'</div></div>'+
      '<div class="ex-connector-wrap ex-layer"><span class="ex-connector"></span></div>'+
      '<div class="ex-label" aria-live="polite">'+CITIES.map((c,i)=>'<div class="ex-label-item'+on(i)+'" data-i="'+i+'"><small>Go beyond the guidebook</small><strong>'+esc(headline(c))+'</strong><span>'+ic('pin',14)+esc(area(c))+'</span></div>').join('')+'</div>'+
      '<div class="ex-pager"><span class="ex-count"><b>0'+(ci+1)+'</b> / 03</span><span class="ex-bars">'+CITIES.map((c,i)=>'<button type="button" class="ex-bar'+on(i)+(i===ci&&playing?' is-play':'')+'" data-act="dxExCity" data-a="'+c+'" data-i="'+i+'" aria-label="Show '+c+'"><i></i></button>').join('')+'</span>'+
      '<button type="button" class="ex-play" data-act="dxExPlay" aria-label="'+(playing?'Pause the city tour':'Play the city tour')+'">'+(playing?pauseIc:playIc)+'</button></div></section>';
  }
  function search(){
    const date=ag?.prefs?.date?agDate(ag.prefs.date):'Choose a date';
    return '<div class="ex-search-wrap"><div class="ex-search" role="search">'+
      '<button type="button" class="ex-seg" data-act="dxExNext">'+ic('pin',20)+'<span class="ex-seg-text"><b data-dx-city>'+jhCity+'</b><small>Choose the destination</small></span></button><span class="ex-div"></span>'+
      '<button type="button" class="ex-seg" data-act="tab" data-a="journey">'+ic('calendar',20)+'<span class="ex-seg-text"><b>'+esc(date)+'</b><small>Trip date</small></span></button><span class="ex-div"></span>'+
      '<label class="ex-seg ex-q">'+ic('search',20)+'<span class="ex-seg-text"><b>Search</b><input id="home-q" type="search" data-in="homeQuery" value="'+esc(state.homeQuery)+'" placeholder="Experiences, food, markets…" aria-label="Search experiences, food, markets"></span></label>'+
      '<div class="ex-browse" role="group" aria-label="Browse"><button type="button" data-act="exBrowse" data-a="home" aria-pressed="true">Experiences</button><button type="button" data-act="exBrowse" data-a="shop" aria-pressed="false">Shopping</button></div>'+
      '<button type="button" class="ex-go" data-act="dxExSearch" aria-label="Search '+jhCity+'"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></div>'+
      '<div data-region="homeResults" class="results ex-results">'+homeResults()+'</div></div>';
  }

  // Move the stage to another city in place, so scenes, title, orbit and label animate.
  function show(city,{user=false}={}){
    const root=app.querySelector('.ex-page');
    if(!root||!CITIES.includes(city))return;
    const prev=cityIndex(),ci=CITIES.indexOf(city);
    if(ci===prev)return;
    dir=((ci-prev)%3+3)%3===1?1:-1;
    // A tour step only changes what Explore shows; a chosen city also updates trip planning, as before.
    jhSetCity(city,{syncPreferences:user});
    state.homeCat='all';state.homeQuery='';
    const heroEl=root.querySelector('.ex-hero');heroEl.dataset.city=city;heroEl.setAttribute('aria-label','Explore '+city);
    heroEl.querySelector('.ex-sr').textContent='Explore '+city;
    root.querySelectorAll('.ex-hero [data-i]').forEach(el=>{
      const i=+el.dataset.i,cls=el.classList.contains('ex-bar')?'is-on':null;
      el.classList.toggle('is-on',i===ci);
      if(el.classList.contains('ex-thumb')){el.style.cssText=thumbStyle(i,ci);el.setAttribute('aria-pressed',String(i===ci));}
      if(cls){el.classList.remove('is-play');if(i===ci&&playing){void el.offsetWidth;el.classList.add('is-play');}}
    });
    const connector=root.querySelector('.ex-connector');connector.style.animation='none';void connector.offsetWidth;connector.style.animation='';
    root.querySelector('.ex-count b').textContent='0'+(ci+1);
    root.querySelector('[data-dx-city]').textContent=city;
    root.querySelector('.ex-go').setAttribute('aria-label','Search '+city);
    const input=root.querySelector('#home-q');if(input)input.value='';
    const results=root.querySelector('[data-region=homeResults]');if(results)results.innerHTML='';
    root.querySelector('[data-dx-list]').outerHTML=listing();
  }
  function setPlaying(on){
    playing=on;
    const btn=app.querySelector('.ex-play');if(!btn)return;
    btn.innerHTML=on?pauseIc:playIc;btn.setAttribute('aria-label',on?'Pause the city tour':'Play the city tour');
    app.querySelectorAll('.ex-bar').forEach(b=>b.classList.toggle('is-play',on&&b.classList.contains('is-on')));
  }
  A.dxExCity=city=>{setPlaying(false);show(city,{user:true});};
  A.dxExNext=()=>{setPlaying(false);show(CITIES[(cityIndex()+1)%3],{user:true});};
  A.dxExPlay=()=>{if(playing){setPlaying(false);return;}setPlaying(true);show(CITIES[(cityIndex()+1)%3]);};
  A.dxExSearch=()=>{const input=app.querySelector('#home-q');if(!input)return;if(input.value.trim())app.querySelector('.ex-results')?.scrollIntoView({block:'nearest',behavior:calm?.matches?'auto':'smooth'});else input.focus();};

  // Tour the cities while the stage is in view and nothing else has the traveler's attention.
  setInterval(()=>{
    if(!playing||document.hidden||state.route!=='home'||ui.sheet)return;
    const root=app.querySelector('.ex-page'),screen=app.querySelector(':scope>.screen');
    if(!root||!screen||screen.scrollTop>160||root.contains(document.activeElement)&&document.activeElement.id==='home-q')return;
    show(CITIES[(cityIndex()+1)%3]);
  },TOUR_MS);
  calm?.addEventListener?.('change',()=>{if(calm.matches)setPlaying(false);});
  // Pause the hero's looping motion once it has scrolled out of view.
  document.addEventListener('scroll',event=>{
    const screen=event.target;if(!(screen instanceof Element)||!screen.matches('#app>.screen'))return;
    const root=screen.querySelector('.ex-page');if(root)root.classList.toggle('is-past',screen.scrollTop>760);
  },{capture:true,passive:true});

  const dxMobileHome=V.home;
  V.home=function(){
    if(!wide?.matches||state.role==='staff')return dxMobileHome.apply(this,arguments);
    if(!document.getElementById('dx-ex-sprite'))document.body.insertAdjacentHTML('afterbegin',dxExArt.sprite.replace('<svg ','<svg id="dx-ex-sprite" '));
    const n=cartCount(),need=myOrders().some(o=>orderInfo(o).needsChoice);
    return {tabs:true,
      bar:'<header class="bar top ex-header"><h1 class="h1">Explore</h1>'+jhFxSwitch()+'<button class="icon-btn ring" data-act="go" data-a="bag" aria-label="Bag, '+plural(n,'item')+'">'+ic('bag',20)+(n?'<span class="count">'+n+'</span>':'')+'</button><button class="icon-btn ring" data-act="bell" aria-label="Notifications">'+ic('bell',19)+(need?'<span class="dot"></span>':'')+'</button><button class="sn-entry" data-act="staffEntry">'+ic('grid',15)+'<span>'+(me()?'Staff workspace':'Staff sign in')+'</span></button></header>',
      body:'<div class="ex-page">'+hero()+search()+'<main class="ex-main">'+quick()+listing()+'</main></div>'};
  };
})();
