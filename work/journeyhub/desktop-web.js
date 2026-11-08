// Desktop web shell: keeps the same views and actions, and adds route hooks, a sidebar, a command palette and motion on wide screens.
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const calm=window.matchMedia?.('(prefers-reduced-motion:reduce)');
  const bare=new Set(['welcome','login']);
  const isMac=/Mac|iPhone|iPad/.test(navigator.platform||'');
  let lastRoute=null,enterTimer=null;

  // Top navigation: brand, section links, then search and the global bar actions on the right.
  function dkDecorateNav(nav){
    if(nav.querySelector('.dx-brand'))return;
    const home=state.role==='staff'?'s-today':'journey';
    nav.insertAdjacentHTML('afterbegin','<button type="button" class="dx-brand" data-act="tab" data-a="'+home+'" aria-label="Journey Hub home">'+mark(30)+'<span>Journey Hub</span></button>');
    if(state.role==='staff')nav.querySelector('.dx-brand').insertAdjacentHTML('afterend','<span class="dx-ws">Staff workspace</span>');
    nav.insertAdjacentHTML('beforeend','<div class="dx-actions"><button type="button" class="dk-search" data-dk-palette aria-haspopup="dialog">'+ic('search',16)+'<span>Search</span><kbd>'+(isMac?'⌘K':'Ctrl K')+'</kbd></button></div>');
  }
  const dxGlobal=':scope>:is(.fx-switch,.sn-entry,[data-act=bell],[data-act=go][data-a=bag])';
  function dkLiftActions(nav){
    const bar=app.querySelector(':scope>.bar'),slot=nav.querySelector('.dx-actions');
    if(!bar||!slot)return;
    const order=['fx-switch','bell','bag','sn-entry'],rank=el=>order.findIndex(k=>el.classList.contains(k)||el.dataset.act===k||el.dataset.a===k);
    [...bar.querySelectorAll(dxGlobal)].sort((a,b)=>rank(a)-rank(b)).forEach(el=>slot.appendChild(el));
    // Staff: the traveler switch and an initials avatar sit on the right, as in the staff design.
    if(state.role==='staff'){
      const sw=nav.querySelector(':scope>.tab[data-act=role]');
      if(sw){sw.classList.add('dx-switch');sw.querySelector('.tab-pill')?.remove();sw.innerHTML=ic('swap',16)+'<span>Traveler view</span>';slot.appendChild(sw);}
      if(!slot.querySelector('.dx-avatar')){const name=String(me()?.name||'Staff').trim(),initials=name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();slot.insertAdjacentHTML('beforeend','<button type="button" class="dx-avatar" data-act="staffMenu" aria-label="Staff account, '+esc(name)+'">'+esc(initials)+'</button>');}
    }
    // Travelers see currency, notifications and bag on every page, as in the design.
    if(state.role==='traveler'){
      const have=sel=>slot.querySelector(sel);
      const search=slot.querySelector('.dk-search');
      if(!have('.fx-switch')&&typeof jhFxSwitch==='function')search.insertAdjacentHTML('afterend',jhFxSwitch());
      const after=have('.fx-switch')||search;
      if(!have('[data-act=bell]'))after.insertAdjacentHTML('afterend','<button class="icon-btn ring" data-act="bell" aria-label="Notifications">'+ic('bell',19)+(myOrders().some(o=>orderInfo(o).needsChoice)?'<span class="dot"></span>':'')+'</button>');
      if(!have('[data-a=bag]')){const n=cartCount();have('[data-act=bell]').insertAdjacentHTML('afterend','<button class="icon-btn ring" data-act="go" data-a="bag" aria-label="Bag, '+plural(n,'item')+'">'+ic('bag',20)+(n?'<span class="count">'+n+'</span>':'')+'</button>');}
    }
  }
  // Eyebrow over the page title names the section, unless the title already does.
  const dxSections={journey:'AI Journey',home:'Explore',orders:'Calendar',me:'Account','s-today':'Staff workspace','s-orders':'Staff workspace','s-sessions':'Staff workspace','s-bookings':'Staff workspace','s-insights':'Performance & planning'};
  function dkEyebrow(){
    const bar=app.querySelector(':scope>.bar');if(!bar)return;
    const section=dxSections[TAB_OF[state.route]||state.route],title=bar.querySelector('.bar-title,h1')?.textContent.trim();
    if(section&&title&&title.toLowerCase()!==section.toLowerCase())bar.dataset.dxEyebrow=section;
  }
  function dkBackdrop(){
    if(document.querySelector('.dx-bg'))return;
    const fog='<svg viewBox="0 0 2880 400" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs><filter id="dxFog" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.0016 0.0075" numOctaves="4" seed="6" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.7 0 0 0 -0.62" result="a"/><feFlood flood-color="#f2e6ff" result="c"/><feComposite in="c" in2="a" operator="in"/></filter><linearGradient id="dxFogFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".42" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff"/></linearGradient><mask id="dxFogMask"><rect width="2880" height="400" fill="url(#dxFogFade)"/></mask></defs><g mask="url(#dxFogMask)"><rect width="2880" height="400" filter="url(#dxFog)"/></g></svg>';
    app.insertAdjacentHTML('beforebegin','<div class="dx-bg" aria-hidden="true"><div class="dx-bg-scene"></div><div class="dx-fog">'+fog+'</div></div>');
  }
  // The golden-hour film is one layer shared by the landing page and sign-in, so moving
  // between them never cuts the film: sign-in blurs and dims it, other pages fade it out.
  let dkFilmTimer=null;
  function dkFilm(route){
    let film=document.querySelector('.gh-film');
    if(!film){app.insertAdjacentHTML('beforebegin','<div class="gh-film" aria-hidden="true"><video src="./media/golden-hour.mp4" poster="./media/golden-hour.jpg" muted loop playsinline preload="auto"></video><div class="gh-film-shade"></div></div>');film=document.querySelector('.gh-film');}
    const on=route==='welcome'||route==='login',video=film.querySelector('video');
    document.body.classList.toggle('gh-on',on);
    document.body.classList.toggle('gh-blur',route==='login');
    if(on)document.body.classList.remove('gh-out');
    clearTimeout(dkFilmTimer);
    if(on){video.muted=true;if(calm?.matches)video.pause();else video.play()?.catch?.(()=>{});}
    else dkFilmTimer=setTimeout(()=>video.pause(),900);
  }
  function dkSync(){
    const route=state.route||'';
    if(app.dataset.route!==route)app.dataset.route=route;
    const screen=!!app.querySelector(':scope>.screen');
    const shell=!!wide?.matches&&screen&&!!state.role&&!bare.has(route);
    const mode=shell?'on':'off';
    if(app.dataset.shell!==mode)app.dataset.shell=mode;
    document.body.classList.toggle('dx-staff',shell&&state.role==='staff');
    let nav=app.querySelector(':scope>.tabbar');
    if(shell&&!nav){
      app.insertAdjacentHTML('beforeend',tabbar());
      nav=app.querySelector(':scope>.tabbar');
      nav.dataset.dkAdded='1';
    }else if(!shell&&nav?.dataset.dkAdded){nav.remove();nav=null;}
    if(shell&&nav){dkDecorateNav(nav);dkLiftActions(nav);dkEyebrow();}
    if(wide?.matches){dkBackdrop();dkFilm(route);}
    if(route!==lastRoute){
      if(lastRoute!==null&&wide?.matches&&!calm?.matches){
        app.dataset.enter='1';clearTimeout(enterTimer);
        enterTimer=setTimeout(()=>{delete app.dataset.enter;},700);
      }
      lastRoute=route;
    }
  }

  // On wide screens the home page shows trip details as a side panel, always open.
  const dkJourney=V.journey;
  V.journey=function(){if(wide?.matches){if(typeof jlDetailsOpen!=='undefined')jlDetailsOpen=true;if(typeof jhHomeOptionsOpen!=='undefined')jhHomeOptionsOpen=true;}return dkJourney.apply(this,arguments);};
  const dkJlDetails=A.jlDetails;
  A.jlDetails=function(){if(wide?.matches&&state.route==='journey'){const d=document.querySelector('.jl-home>.jl-details');if(d){d.open=true;d.querySelector('input,select,button')?.focus();return;}}return dkJlDetails.apply(this,arguments);};

  // Command palette
  const travelerItems=[['AI Journey','journey','Plan a trip'],['Explore','home','Places and experiences'],['Shopping','shop','Local stores'],['Calendar','orders','Your schedule'],['Reservations','reserved-trips','Saved bookings'],['Trip history','trip-history','Searches and plans'],['Travel memories','memories','Photos and stories'],['Saved','saved','Places you liked'],['Purchases','purchases','Orders and delivery'],['Demo wallet','demo-wallet','Virtual credits'],['Display currency','currency','Prices and rates'],['Me','me','Profile and settings']];
  const staffItems=[['Today','s-today','Live operations'],['Orders','s-orders','All orders'],['Bookings','s-bookings','Experience bookings'],['Sessions','s-sessions','Availability'],['Insights','s-insights','Performance'],['Assistant','s-assistant','Staff assistant']];
  let palette=null,matches=[],active=0,returnFocus=null;
  const dkItems=()=>state.role==='staff'?staffItems:travelerItems;
  function dkPaint(){
    const list=palette.querySelector('.dk-palette-list'),q=palette.querySelector('input').value.trim().toLowerCase();
    matches=dkItems().filter(item=>(item[0]+' '+item[2]).toLowerCase().includes(q));
    if(active>=matches.length)active=Math.max(0,matches.length-1);
    list.innerHTML=matches.length?matches.map((item,i)=>'<li role="presentation"><button type="button" class="dk-palette-item" role="option" id="dk-opt-'+i+'" data-i="'+i+'" aria-selected="'+(i===active)+'" tabindex="-1"><span>'+esc(item[0])+'</span><small>'+esc(item[2])+'</small></button></li>').join(''):'<li class="dk-palette-empty">No matching pages</li>';
    const input=palette.querySelector('input');
    if(matches.length)input.setAttribute('aria-activedescendant','dk-opt-'+active);else input.removeAttribute('aria-activedescendant');
    list.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});
  }
  function dkClose(){if(!palette||palette.hidden)return;palette.hidden=true;returnFocus?.isConnected&&returnFocus.focus();returnFocus=null;}
  function dkRun(i){const item=matches[i];if(!item)return;dkClose();go(item[1]);}
  function dkOpen(){
    if(!palette){
      document.body.insertAdjacentHTML('beforeend','<div class="dk-palette" role="dialog" aria-modal="true" aria-label="Search pages" hidden><div class="dk-palette-box"><div class="dk-palette-field">'+ic('search',18)+'<input type="text" role="combobox" aria-expanded="true" aria-controls="dk-palette-list" aria-label="Search pages" placeholder="Search anything…" autocomplete="off"><kbd>Esc</kbd></div><ul class="dk-palette-list" id="dk-palette-list" role="listbox"></ul></div></div>');
      palette=document.body.lastElementChild;
      const input=palette.querySelector('input');
      input.addEventListener('input',()=>{active=0;dkPaint();});
      palette.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();dkClose();}
        else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(matches.length){active=(active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;dkPaint();}}
        else if(event.key==='Enter'){event.preventDefault();dkRun(active);}
        else if(event.key==='Tab'){event.preventDefault();input.focus();}
      });
      palette.addEventListener('click',event=>{
        const option=event.target.closest('.dk-palette-item');
        if(option)dkRun(+option.dataset.i);else if(event.target===palette)dkClose();
      });
      palette.addEventListener('mousemove',event=>{
        const option=event.target.closest('.dk-palette-item');
        if(option&&+option.dataset.i!==active){active=+option.dataset.i;dkPaint();}
      });
    }
    returnFocus=document.activeElement;active=0;palette.hidden=false;
    const input=palette.querySelector('input');input.value='';dkPaint();input.focus();
  }
  document.addEventListener('keydown',event=>{
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&app.dataset.shell==='on'){
      event.preventDefault();palette&&!palette.hidden?dkClose():dkOpen();
    }
  });
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-dk-palette]'))dkOpen();});

  // Primary buttons lean slightly toward the pointer.
  document.addEventListener('pointermove',event=>{
    if(!wide?.matches||calm?.matches||event.pointerType!=='mouse')return;
    const button=event.target.closest?.('#app .btn-primary:not(:disabled)');
    if(!button)return;
    const box=button.getBoundingClientRect();
    button.style.transform='translate('+(((event.clientX-box.left)/box.width-.5)*6).toFixed(1)+'px,'+(((event.clientY-box.top)/box.height-.5)*4-1).toFixed(1)+'px)';
    button.addEventListener('pointerleave',()=>{button.style.transform='';},{once:true});
  });

  // Sign-in landing on wide screens: a golden-hour film with two ways in. Same actions as the mobile welcome.
  const dkWelcome=V.welcome;
  V.welcome=()=>{
    if(!wide?.matches)return dkWelcome();
    // A remembered session continues straight in; without one, the entry asks for email and password.
    const t=traveler(),staff=me();
    // Each ticket: an entrance wrapper, a float layer that sways with the carriage, and the button that tilts toward the pointer.
    const entry=(kind,cls,icon,title,sub)=>'<div class="gh-ticket" style="--i:'+(kind==='traveler'?0:1)+'"><div class="gh-float"><button type="button" class="gh-entry '+cls+'" data-act="'+((kind==='traveler'?t:staff)?'dkContinue':'dkSignIn')+'" data-a="'+kind+'"><span class="gh-sheen" aria-hidden="true"></span><span class="gh-entry-icon" aria-hidden="true">'+icon+'</span><span class="gh-entry-text"><span class="gh-entry-title">'+title+'</span><span class="gh-entry-sub">'+sub+'</span></span><span class="gh-entry-stub" aria-hidden="true">'+ic('right',22)+'</span></button></div></div>';
    return {
      body:'<div class="gh"><main class="gh-hero"><div class="gh-shade"></div>'+
        '<header class="gh-nav"><span class="gh-brand">'+mark(30)+'Journey Hub</span></header>'+
        '<div class="gh-sky"><h1>Explore Bangkok,<br>Shanghai <em>and</em> Singapore</h1><p>Workshops, food walks and local stores, combined into one day, with purchases delivered to your hotel.</p></div>'+
        '<section class="gh-panel" aria-labelledby="gh-entry-q"><div class="gh-panel-head"><h2 id="gh-entry-q">How will you use Journey Hub?</h2><p>Concept prototype · stores, prices and people are illustrative'+(t||staff?' · <button type="button" class="gh-switch" data-act="dkSignIn" data-a="'+(t?'traveler':'staff')+'">Use another account</button>':'')+'</p></div><div class="gh-entries">'+
        entry('traveler','gh-entry-traveler',ic('explore',26),'I\'m traveling',t?'Continue as '+esc(t.name):'Sign in with your email and password')+
        entry('staff','gh-entry-staff',ic('grid',24),staff?'Staff workspace':'Staff sign in',staff?'Continue as '+esc(staff.name):'Use your assigned email and password')+
        '</div></section></main></div>',
      after(){
        // Tickets lean toward the pointer, as if lifted off the table.
        const panel=app.querySelector('.gh-panel');if(!panel||calm?.matches)return;
        const tickets=[...panel.querySelectorAll('.gh-entry')];
        panel.addEventListener('pointermove',e=>{
          if(e.pointerType!=='mouse')return;
          for(const el of tickets){const r=el.getBoundingClientRect(),dx=Math.max(-1,Math.min(1,(e.clientX-(r.left+r.width/2))/r.width)),dy=Math.max(-1,Math.min(1,(e.clientY-(r.top+r.height/2))/r.height));
            el.classList.add('is-tilting');el.style.setProperty('--ry',(dx*7).toFixed(2)+'deg');el.style.setProperty('--rx',(-dy*9).toFixed(2)+'deg');}
        });
        panel.addEventListener('pointerleave',()=>{for(const el of tickets){el.classList.remove('is-tilting');el.style.removeProperty('--rx');el.style.removeProperty('--ry');}});
      }
    };
  };

  // Opening the site starts on the landing page, signed in or not. Its two entries
  // continue straight to the saved session. A reload in the same tab, or a
  // password-recovery link, keeps its place.
  const dkBoot=jhStart;
  jhStart=async function(){
    const result=await dkBoot.apply(this,arguments);
    let seen=false;try{seen=sessionStorage.getItem('jh-landing-seen')==='1';sessionStorage.setItem('jh-landing-seen','1');}catch{}
    if(wide?.matches&&!seen&&!jhRecovery&&state.route!=='welcome'&&state.route!=='login'){
      state.role=null;state.route='welcome';state.params={};state.hist=[];render();
    }
    return result;
  };

  // Both landing entries go to the email and password form first, then into the app.
  // The traveler form still offers Continue as guest.
  A.dkContinue=mode=>{
    mode=mode==='staff'?'staff':'traveler';
    if(mode==='staff'?!me():!traveler())return A.dkSignIn(mode);
    setRole(mode,mode==='staff'?(me().role==='host'?'s-session':'s-today'):'journey');
  };
  A.dkSignIn=mode=>{
    mode=mode==='staff'?'staff':'traveler';
    state.hist=[];state.role=mode;state.guestOk=false;
    openLogin(mode,{route:mode==='staff'?'s-today':'journey'});
    const email=mode==='traveler'&&jhUser?.email||'';if(email&&ui.loginDraft&&!ui.loginDraft.email){ui.loginDraft.email=email;render();}
  };

  // Calendar: the selected day's route map sits under the month, in the left column.
  const dkOrders=V.orders;
  V.orders=function(){
    const view=dkOrders.apply(this,arguments);
    if(!wide?.matches||!view?.body||!view.body.includes('cal-inline-map'))return view;
    const t=document.createElement('template');t.innerHTML=view.body;
    const page=t.content.querySelector('.cal-page'),month=page?.querySelector(':scope>.cal-month'),map=t.content.querySelector('.cal-inline-map');
    if(!page||!month||!map)return view;
    const side=document.createElement('div');side.className='cal-side';
    month.replaceWith(side);side.append(month);
    // The trip agent becomes a chat panel under the month; the map takes its place on the right.
    const entry=t.content.querySelector('.tch-entry'),open=entry?.querySelector('button[data-act]');
    if(entry&&open){
      const panel=document.createElement('div');panel.innerHTML=dkAgentPanel(open);
      entry.replaceWith(map);side.append(panel.firstElementChild);
    }else side.append(map);
    view.body=t.innerHTML;
    const after=view.after;view.after=function(){if(after)after.apply(this,arguments);const box=app.querySelector('#dk-agent-msg');if(box){box.value=dkAgentDraft;dkAgentSize(box);}};
    return view;
  };
  // Trip agent chat panel on the Calendar: suggestions and a message box open the trip
  // conversation and send the message there, so travelers can start talking right away.
  let dkAgentDraft='',dkAgentTarget=null,dkAgentTimer=null;
  const dkAgentPrompts=[['clock','Check timing','Check whether the times on {day} work, including opening hours and travel between stops.'],['map','Optimise route','Reorder {day} so there is less travel between places.'],['food','Add local food','Add a well-rated local food stop to {day} that fits the route.'],['leaf','Slower pace','Make {day} more relaxed, with fewer stops and longer breaks.'],['wallet','Save money','Find ways to lower the cost of {day} without losing the highlights.']];
  function dkAgentPanel(open){
    const day=open.dataset.act==='tchStart'?open.dataset.c:open.dataset.b,label=day?'Day '+day:'this day',busy=open.disabled;
    dkAgentTarget={act:open.dataset.act,a:open.dataset.a,b:open.dataset.b,c:open.dataset.c,day:label};
    return '<section class="dk-agent" aria-label="Trip agent"><header class="dk-agent-head">'+(typeof tchAvatar==='function'?tchAvatar('dk-agent-avatar'):'')+'<span><strong>Trip agent</strong><small>Your personal travel assistant</small></span><i class="dk-agent-dot" title="Ready"></i></header>'+
      '<div class="dk-agent-msg"><span class="dk-agent-kicker">'+ic('sparkle',13)+'Agent</span><p>Hi! I can change '+esc(label)+' for you: move stops, check opening hours, add food or slow the pace down.</p><p>Tap a suggestion or tell me what you would like, for example “make '+esc(label)+' more relaxed”.</p></div>'+
      '<div class="dk-agent-chips">'+dkAgentPrompts.map((p,i)=>'<button type="button" data-act="dkAgentAsk" data-a="'+i+'"'+(busy?' disabled':'')+'>'+ic(p[0],15)+p[1]+'</button>').join('')+'</div>'+
      '<div class="dk-agent-input"><textarea id="dk-agent-msg" rows="1" maxlength="1800" placeholder="Try: make '+esc(label)+' more relaxed…" aria-label="Message your trip agent"></textarea><button type="button" class="dk-agent-send" data-act="dkAgentAsk" aria-label="Send to trip agent"'+(busy?' disabled':'')+'>'+ic('right',20)+'</button></div>'+
      '<p class="dk-agent-foot">Changes are suggested first. Nothing is booked or changed until you confirm.</p></section>';
  }
  function dkAgentSize(box){box.style.height='auto';box.style.height=Math.min(140,box.scrollHeight)+'px';}
  document.addEventListener('input',e=>{if(e.target.id==='dk-agent-msg'){dkAgentDraft=e.target.value;dkAgentSize(e.target);}});
  document.addEventListener('keydown',e=>{if(e.target.id==='dk-agent-msg'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();A.dkAgentAsk();}});
  A.dkAgentAsk=function(i){
    const t=dkAgentTarget;if(!t)return;
    const preset=dkAgentPrompts[+i],message=(preset?preset[2].replace('{day}',t.day):dkAgentDraft).trim();
    if(!message){app.querySelector('#dk-agent-msg')?.focus();return;}
    if(!preset)dkAgentDraft='';
    clearInterval(dkAgentTimer);
    if(t.act==='tchStart')A.tchStart(t.a,t.b,t.c);else A.tchOpen(t.a,t.b);
    // Send once the conversation has loaded; give up if the traveler leaves or it takes too long.
    let tries=0;
    dkAgentTimer=setInterval(()=>{
      tries++;const ctx=state.route==='trip-chat'&&typeof tchActive==='function'?tchActive():null;
      if(tries>100||(tries>20&&state.route!=='trip-chat')){clearInterval(dkAgentTimer);return;}
      if(!ctx||!ctx.loaded||ctx.busy||(typeof tchRunning==='function'&&tchRunning(ctx)))return;
      clearInterval(dkAgentTimer);ctx.draft=message;void A.tchSend();
    },150);
  };

  // Leaving the landing page: the headline lifts away, the chosen ticket rises toward where
  // the sign-in card appears, the other ticket settles out, and the film blurs (sign-in) or
  // fades (straight into the app). Then the next page enters over it.
  let dkLeaving=false;
  function dkLeave(mode,kind,next){
    const gh=app.querySelector('.gh');
    if(state.route!=='welcome'||!gh||!wide?.matches||calm?.matches||gh.classList.contains('is-leaving')){next();return;}
    if(dkLeaving)return;dkLeaving=true;
    gh.classList.add('is-leaving');
    gh.querySelector('.gh-entry-'+(mode==='staff'?'staff':'traveler'))?.closest('.gh-ticket')?.classList.add('is-chosen');
    document.body.classList.add(kind==='continue'?'gh-out':'gh-blur');
    setTimeout(()=>{dkLeaving=false;next();},430);
  }
  const dkSignInNow=A.dkSignIn,dkContinueNow=A.dkContinue;
  A.dkSignIn=mode=>dkLeave(mode,'signin',()=>dkSignInNow(mode));
  A.dkContinue=mode=>dkLeave(mode,'continue',()=>dkContinueNow(mode));

  new MutationObserver(dkSync).observe(app,{childList:true});
  wide?.addEventListener?.('change',()=>{dkClose();render();});
  dkSync();
})();
