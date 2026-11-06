// Desktop web shell: keeps the same views and actions, and adds route hooks, a sidebar, a command palette and motion on wide screens.
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const calm=window.matchMedia?.('(prefers-reduced-motion:reduce)');
  const bare=new Set(['welcome','login']);
  const isMac=/Mac|iPhone|iPad/.test(navigator.platform||'');
  let lastRoute=null,enterTimer=null;

  function dkDecorateNav(nav){
    if(nav.querySelector('.dk-brand'))return;
    nav.insertAdjacentHTML('afterbegin','<div class="dk-brand">journey hub<i aria-hidden="true"></i></div><button type="button" class="dk-search" data-dk-palette aria-haspopup="dialog">'+ic('search',16)+'<span>Search anything</span><kbd>'+(isMac?'⌘K':'Ctrl K')+'</kbd></button>');
  }
  function dkSync(){
    const route=state.route||'';
    if(app.dataset.route!==route)app.dataset.route=route;
    const screen=!!app.querySelector(':scope>.screen');
    const shell=!!wide?.matches&&screen&&!!state.role&&!bare.has(route);
    const mode=shell?'on':'off';
    if(app.dataset.shell!==mode)app.dataset.shell=mode;
    let nav=app.querySelector(':scope>.tabbar');
    if(shell&&!nav){
      app.insertAdjacentHTML('beforeend',tabbar());
      nav=app.querySelector(':scope>.tabbar');
      nav.dataset.dkAdded='1';
    }else if(!shell&&nav?.dataset.dkAdded){nav.remove();nav=null;}
    if(shell&&nav)dkDecorateNav(nav);
    if(route!==lastRoute){
      if(lastRoute!==null&&wide?.matches&&!calm?.matches){
        app.dataset.enter='1';clearTimeout(enterTimer);
        enterTimer=setTimeout(()=>{delete app.dataset.enter;},700);
      }
      lastRoute=route;
    }
  }

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

  new MutationObserver(dkSync).observe(app,{childList:true});
  wide?.addEventListener?.('change',()=>{dkClose();render();});
  dkSync();
})();
