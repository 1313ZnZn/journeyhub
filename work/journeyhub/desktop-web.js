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
  // between them never cuts the film: sign-in blurs and dims it; app pages hide it.
  function dkFilm(route){
    let film=document.querySelector('.gh-film');
    if(!film){app.insertAdjacentHTML('beforebegin','<div class="gh-film" aria-hidden="true"><video src="./media/golden-hour.mp4" poster="./media/golden-hour.jpg" muted loop playsinline preload="auto"></video><div class="gh-film-shade"></div></div>');film=document.querySelector('.gh-film');}
    const on=route==='welcome'||route==='login',video=film.querySelector('video');
    // The welcome film must never cover the app's city backdrop while fading out.
    // Keep the node for welcome/sign-in continuity, but remove it from app painting.
    film.hidden=!on;
    document.body.classList.toggle('gh-on',on);
    document.body.classList.toggle('gh-blur',route==='login');
    if(on)document.body.classList.remove('gh-out');
    if(on){video.muted=true;if(calm?.matches)video.pause();else video.play()?.catch?.(()=>{});}
    else video.pause();
  }
  // Nav highlight that glides from the previous tab to the current one.
  let dkInkLast=null;
  function dkInk(nav){
    const tab=nav.querySelector(':scope>.tab[aria-current=page]');
    if(!tab){dkInkLast=null;return;}
    let ink=nav.querySelector(':scope>.dx-ink');
    if(!ink){nav.insertAdjacentHTML('afterbegin','<span class="dx-ink" aria-hidden="true"></span>');ink=nav.firstElementChild;}
    nav.classList.add('has-ink');
    const n=nav.getBoundingClientRect(),r=tab.getBoundingClientRect(),to={x:r.left-n.left,y:r.top-n.top,w:r.width};
    const place=p=>{ink.style.transform='translate('+p.x+'px,'+p.y+'px)';ink.style.width=p.w+'px';};
    if(dkInkLast&&!calm?.matches&&(dkInkLast.x!==to.x||dkInkLast.w!==to.w)){
      ink.style.transition='none';place(dkInkLast);void ink.offsetWidth;ink.style.transition='';requestAnimationFrame(()=>place(to));
    }else place(to);
    dkInkLast=to;
  }
  // Numbers in the summary cards count up when a page opens.
  function dkCount(){
    if(calm?.matches)return;
    const cells=app.querySelectorAll('.screen :is(.sd-kpi>b,.kpi>b)');
    for(const cell of cells){
      const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
      for(const node of nodes){
        const text=node.nodeValue;if(!/\d/.test(text))continue;
        const parts=text.split(/(\d[\d,]*(?:\.\d+)?)/);
        const start=performance.now(),dur=900;
        const frame=now=>{
          if(!node.isConnected)return;
          const t=Math.min(1,(now-start)/dur),k=1-Math.pow(1-t,3);
          node.nodeValue=parts.map((part,i)=>{
            if(i%2===0)return part;
            const value=Number(part.replace(/,/g,'')),dec=(part.split('.')[1]||'').length,v=value*k;
            const out=v.toFixed(dec);return part.includes(',')?Number(out).toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec}):out;
          }).join('');
          if(t<1)requestAnimationFrame(frame);else node.nodeValue=text;
        };
        requestAnimationFrame(frame);
      }
    }
  }
  // Glass panels: a light that follows the pointer.
  document.addEventListener('pointermove',e=>{
    if(!wide?.matches)return;
    const panel=e.target.closest?.('.sd-card,.sd-kpi,.dk-agent,.jl-composer,.jl-details,.cal-month');if(!panel)return;
    const r=panel.getBoundingClientRect();panel.style.setProperty('--mx',(e.clientX-r.left)+'px');panel.style.setProperty('--my',(e.clientY-r.top)+'px');
  },{passive:true});
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
    if(shell&&nav){dkDecorateNav(nav);dkLiftActions(nav);dkEyebrow();dkInk(nav);}
    if(wide?.matches){dkBackdrop();dkFilm(route);}
    if(route!==lastRoute){
      if(lastRoute!==null&&wide?.matches&&!calm?.matches){
        app.dataset.enter='1';clearTimeout(enterTimer);
        enterTimer=setTimeout(()=>{delete app.dataset.enter;},1500);
        dkCount();
      }
      lastRoute=route;
    }
  }

  // On wide screens the home page shows trip details as a side panel, always open.
  const dkJourney=V.journey;
  // Under the chat box, three full-sentence ideas replace the short interest tags; a click
  // adds the sentence to the message box (and a second click takes it out again).
  const dkIdeas=[['food','I want to eat where locals eat, from street food stalls to small family restaurants.'],['globe','Show me the city’s culture and art: museums, temples and creative neighbourhoods.'],['sun','Plan a relaxed day outdoors with parks, riverside walks and the best views.']];
  window.jhHomeIdeas=()=>dkIdeas.map(([icon,text])=>({icon,text}));
  V.journey=function(){
    if(!wide?.matches)return dkJourney.apply(this,arguments);
    if(typeof jlDetailsOpen!=='undefined')jlDetailsOpen=true;if(typeof jhHomeOptionsOpen!=='undefined')jhHomeOptionsOpen=true;
    const view=dkJourney.apply(this,arguments);
    if(!view?.body||!view.body.includes('jl-suggestions'))return view;
    const t=document.createElement('template');t.innerHTML=view.body;
    // With Pip open, Pip is the one place to type: the page keeps the title and trip details.
    if(typeof window.jhPipShowing==='function'&&window.jhPipShowing()){
      const home=t.content.querySelector('.jl-home');
      t.content.querySelectorAll('.jl-composer,.jl-suggestions').forEach(el=>el.remove());
      if(home){
        home.classList.add('is-pip');
        home.querySelector('.jl-copy')?.insertAdjacentHTML('beforeend','<p class="jl-pip-hint">Tell <b>Pip</b> what you love — it scouts, helps you choose and plans the days.</p>');
        // Opened from Pip's trip chips as a panel over the page.
        home.querySelector('.jl-details')?.insertAdjacentHTML('afterbegin','<button type="button" class="jl-trip-done" data-act="pipTrip">'+ic('check',15)+'Done</button>');
      }
      view.body=t.innerHTML;return view;
    }
    const box=t.content.querySelector('.jl-suggestions');
    if(box){
      const lines=String(ag.prefs.prompt||'').split('\n');
      box.className='jl-suggestions dk-ideas';box.setAttribute('aria-label','Ideas to start with');
      box.innerHTML='<span class="dk-ideas-label">Not sure where to start? Try one of these</span>'+dkIdeas.map(([icon,text],i)=>'<button type="button" data-act="dkHomeIdea" data-a="'+i+'" aria-pressed="'+lines.includes(text)+'">'+'<span class="dk-idea-ic">'+ic(icon,17)+'</span><span class="dk-idea-text">'+esc(text)+'</span>'+ic(lines.includes(text)?'check':'plus',16)+'</button>').join('');
    }
    view.body=t.innerHTML;return view;
  };
  A.dkHomeIdea=i=>{
    const text=dkIdeas[+i]?.[1];if(!text)return;
    const lines=String(ag.prefs.prompt||'').split('\n'),has=lines.includes(text);
    ag.prefs.prompt=(has?lines.filter(x=>x!==text):[...lines.filter(Boolean),text]).join('\n').slice(0,1200);
    if(typeof jpSavePrefs==='function')jpSavePrefs();render();
    const field=app.querySelector('.jl-composer textarea');if(field){field.focus();field.setSelectionRange(field.value.length,field.value.length);}
  };
  const dkJlDetails=A.jlDetails;
  A.jlDetails=function(){if(wide?.matches&&state.route==='journey'){const d=document.querySelector('.jl-home>.jl-details');if(d){d.open=true;d.querySelector('input,select,button')?.focus();return;}}return dkJlDetails.apply(this,arguments);};

  // Command palette
  const travelerItems=[['AI Journey','journey','Plan a trip'],['Explore','home','Places and experiences'],['Shopping','shop','Local stores'],['Calendar','orders','Your schedule'],['Reservations','reserved-trips','Saved bookings'],['Trip history','trip-history','Searches and plans'],['Travel memories','memories','Photos and stories'],['Saved','saved','Places you liked'],['Purchases','purchases','Orders and delivery'],['Demo wallet','demo-wallet','Virtual credits'],['Display currency','currency','Prices and rates'],['Me','me','Profile and settings']];
  const staffItems=[['Today','s-today','Live operations'],['Orders','s-orders','All orders'],['Bookings','s-bookings','Experience bookings'],['Sessions','s-sessions','Availability'],['Session plans','s-approvals','Plans and publication'],['Insights','s-insights','Performance'],['Assistant','s-assistant','Staff assistant']];
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
        '<div class="gh-sky"><h1 aria-label="Go local. Travel lighter."><span class="gh-hl" aria-hidden="true"><span class="gh-line"><span class="gh-w" style="--i:0">Go</span> <span class="gh-w" style="--i:1">local.</span></span><em class="gh-line"><span class="gh-w" style="--i:2">Travel</span> <span class="gh-w gh-lift" style="--i:3"><i style="--l:0">l</i><i style="--l:1">i</i><i style="--l:2">g</i><i style="--l:3">h</i><i style="--l:4">t</i><i style="--l:5">e</i><i style="--l:6">r</i><i style="--l:7">.</i></span></em></span></h1><p>Plan your trip with AI, book local experiences, and combine purchases from different stores into one delivery.</p></div>'+
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
    setRole(mode,mode==='staff'?'s-today':'journey');
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
    dkAgentTarget=null;
    if(!wide?.matches||!view?.body||!/cal-inline-map|tch-entry/.test(view.body))return view;
    const t=document.createElement('template');t.innerHTML=view.body;
    const page=t.content.querySelector('.cal-page'),month=page?.querySelector(':scope>.cal-month'),map=t.content.querySelector('.cal-inline-map');
    const entry=t.content.querySelector('.tch-entry'),open=entry?.querySelector('button[data-act]');
    if(!page||!month||(!map&&!(entry&&open)))return view;
    const side=document.createElement('div');side.className='cal-side';
    month.replaceWith(side);side.append(month);
    // The trip agent always becomes a chat panel under the month, whether or not the day has a
    // map yet; when it does, the map takes the agent's former place on the right.
    // With the Pip companion open, the conversation lives in Pip; the map stays under the month.
    const pip=typeof window.jhPipShowing==='function'&&window.jhPipShowing();
    if(entry&&open){
      const panel=document.createElement('div');panel.innerHTML=dkAgentPanel(open);
      if(pip){entry.remove();if(map)side.append(map);}
      else{if(map)entry.replaceWith(map);else entry.remove();side.append(panel.firstElementChild);}
    }else if(map)side.append(map);
    view.body=t.innerHTML;
    const after=view.after;view.after=function(){if(after)after.apply(this,arguments);const box=app.querySelector('#dk-agent-msg');if(box){box.value=dkAgentDraft;dkAgentSize(box);}};
    return view;
  };
  // Trip agent conversation (desktop): the day at a glance on the left, the chat in a panel on
  // the right with the same suggestions as the Calendar panel, so both look and work alike.
  const dkChat=V['trip-chat'];
  V['trip-chat']=function(){
    const view=dkChat.apply(this,arguments);
    if(!wide?.matches||!view?.body?.includes('tch-history'))return view;
    const t=document.createElement('template');t.innerHTML=view.body;
    const page=t.content.querySelector('.tch-page'),history=page?.querySelector('.tch-history'),composer=page?.querySelector('.tch-composer'),priorities=history?.querySelector('[data-tch-priorities]');
    if(!page||!history||!composer)return view;
    const day=state.params?.day,label=day?'Day '+day:'this day';
    const aside=document.createElement('aside');aside.className='tch-aside';
    aside.innerHTML='<section class="tch-aside-card"><span class="dk-agent-kicker">'+ic('calendar',13)+'Your plan</span><h2>'+esc(label)+'</h2><div class="tch-aside-day"></div></section><section class="tch-aside-card tch-aside-can"><span class="dk-agent-kicker">'+ic('sparkle',13)+'What I can do</span><ul><li>'+ic('clock',15)+'Check opening hours and timing</li><li>'+ic('map',15)+'Reorder stops to cut travel</li><li>'+ic('food',15)+'Add places to eat that fit the route</li><li>'+ic('wallet',15)+'Find ways to spend less</li></ul><p>Changes are suggested first. Nothing changes until you tap Apply.</p></section>';
    if(priorities)aside.querySelector('.tch-aside-day').append(priorities);else aside.querySelector('.tch-aside-day').innerHTML='<p class="tch-aside-empty">Your saved stops for '+esc(label)+' appear here.</p>';
    const card=document.createElement('section');card.className='tch-card';card.setAttribute('aria-label','Conversation with your trip agent');
    card.innerHTML='<header class="dk-agent-head">'+tchAvatar('dk-agent-avatar')+'<span><strong>Trip agent</strong><small>Planning '+esc(label)+' with you</small></span><i class="dk-agent-dot" title="Ready"></i></header>';
    const chips=document.createElement('div');chips.className='dk-agent-chips tch-chips';
    chips.innerHTML=dkAgentPrompts.map((p,i)=>'<button type="button" data-act="dkChatIdea" data-a="'+i+'">'+ic(p[0],15)+p[1]+'</button>').join('');
    composer.classList.add('dk-agent-input');
    card.append(history,chips,composer);
    page.classList.add('tch-desk');page.replaceChildren(aside,card);
    view.body=t.innerHTML;return view;
  };
  A.dkChatIdea=i=>{
    const p=dkAgentPrompts[+i],ctx=typeof tchActive==='function'?tchActive():null;if(!p||!ctx)return;
    const day=state.params?.day;ctx.draft=p[2].replace('{day}',day?'Day '+day:'this day');void A.tchSend();
  };

  // Trip agent chat panel on the Calendar: suggestions and a message box open the trip
  // conversation and send the message there, so travelers can start talking right away.
  let dkAgentDraft='',dkAgentTarget=null,dkAgentTimer=null;
  const dkAgentPrompts=[['clock','Check timing','Check whether the times on {day} work, including opening hours and travel between stops.'],['map','Optimise route','Reorder {day} so there is less travel between places.'],['food','Add local food','Add a well-rated local food stop to {day} that fits the route.'],['leaf','Slower pace','Make {day} more relaxed, with fewer stops and longer breaks.'],['wallet','Save money','Find ways to lower the cost of {day} without losing the highlights.']];
  dkAgentPrompts.push(
    ['map','Less walking','Suggest a route for {day} with less walking. Keep my must-visit places and existing reservations. Show the proposed changes before applying them.'],
    ['leaf','Indoor route','Suggest an indoor alternative for {day}, keeping existing reservations. Explain any must-visit places that cannot fit and show a proposal before changing the plan.']
  );
  function dkAgentPanel(open){
    const day=open.dataset.act==='tchStart'?open.dataset.c:open.dataset.b,label=day?'Day '+day:'this day',busy=open.disabled;
    dkAgentTarget={act:open.dataset.act,a:open.dataset.a,b:open.dataset.b,c:open.dataset.c,day:label};
    return '<section class="dk-agent" aria-label="Trip agent"><header class="dk-agent-head">'+(typeof tchAvatar==='function'?tchAvatar('dk-agent-avatar'):'')+'<span><strong>Trip agent</strong><small>Your personal travel assistant</small></span><i class="dk-agent-dot" title="Ready"></i></header>'+
      '<div class="dk-agent-msg"><span class="dk-agent-kicker">'+ic('sparkle',13)+'Agent</span><p>Hi! I can change '+esc(label)+' for you: move stops, check opening hours, add food or slow the pace down.</p><p>Tap a suggestion or tell me what you would like, for example “make '+esc(label)+' more relaxed”.</p></div>'+
      '<div class="dk-agent-chips">'+dkAgentPrompts.map((p,i)=>'<button type="button" data-act="dkAgentAsk" data-a="'+i+'"'+(busy?' disabled':'')+'>'+ic(p[0],15)+p[1]+'</button>').join('')+'</div>'+
      '<div class="dk-agent-input"><textarea id="dk-agent-msg" rows="1" maxlength="1800" placeholder="Try: make '+esc(label)+' more relaxed…" aria-label="Message your trip agent"></textarea><button type="button" class="dk-agent-send" data-act="dkAgentAsk" aria-label="Send to trip agent"'+(busy?' disabled':'')+'>'+ic('right',20)+'</button></div>'+
      '<p class="dk-agent-foot">Changes are suggested first. Nothing is booked or changed until you confirm.</p></section>';
  }
  // Pip uses the selected Calendar day's trip conversation through these.
  window.jhCalendarAgent={target:()=>dkAgentTarget,prompts:()=>dkAgentPrompts.map(p=>({icon:p[0],label:p[1]})),ask:i=>A.dkAgentAsk(i),say:text=>{dkAgentDraft=String(text||'');A.dkAgentAsk();}};
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

  // Background updates (status polls, snapshot syncs) re-render the page even when nothing on
  // it changed, which rebuilds maps and images and makes the page flicker. A render that the
  // traveler did not trigger is skipped when the page would look the same.
  // Every page, except the two that already update themselves in place (picking cards, agent chat).
  const dkSelfPainting=new Set(['ai-picks','trip-chat']);
  let dkLastSig='',dkUserAt=0;
  for(const type of ['pointerdown','click','keydown','input','change','submit'])document.addEventListener(type,()=>{dkUserAt=performance.now();},true);
  const dkSignature=()=>{try{const v=V[state.route]();return JSON.stringify([state.role,state.route,state.params,v.bar||'',v.body||'',v.foot||'',v.tabs?tabbar():'',sheetView(),toastView()]);}catch{return '';}};
  // A page that updates itself in place (Explore's city tour) announces it, so the next
  // background render compares against what is really on screen.
  document.addEventListener('jh:painted',()=>{if(wide?.matches&&!dkSelfPainting.has(state.route)&&typeof V[state.route]==='function')dkLastSig=dkSignature();});
  const dkInnerRender=render;
  render=function(){
    let sig='';
    // The connecting screen is not the page itself: never treat it as already showing the page.
    const real=typeof MODE==='undefined'||!(MODE.kind==='connecting'||(MODE.kind==='live'&&(!allReady()||catalogEmpty())));
    if(real&&wide?.matches&&(state.role||state.route==='welcome'||state.route==='login')&&!dkSelfPainting.has(state.route)&&typeof V[state.route]==='function'){
      sig=dkSignature();
      const userDriven=performance.now()-dkUserAt<1200;
      if(sig&&!userDriven&&sig===dkLastSig&&app.dataset.route===state.route&&app.querySelector(':scope>.screen'))return;
    }
    dkLastSig=sig;
    // A pending navigation flag belongs to the old DOM. Do not replay its entry
    // animations when a status response or an explicit refresh rebuilds the view.
    clearTimeout(enterTimer);delete app.dataset.enter;
    return dkInnerRender.apply(this,arguments);
  };

  new MutationObserver(dkSync).observe(app,{childList:true});
  wide?.addEventListener?.('change',()=>{dkClose();render();});
  dkSync();
})();
