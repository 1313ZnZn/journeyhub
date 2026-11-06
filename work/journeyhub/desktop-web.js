// Desktop web shell: keeps the same views and actions, and adds route hooks plus a persistent sidebar on wide screens.
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const bare=new Set(['welcome','login']);
  function dkSync(){
    const route=state.route||'';
    if(app.dataset.route!==route)app.dataset.route=route;
    const screen=!!app.querySelector(':scope>.screen');
    const shell=!!wide?.matches&&screen&&!!state.role&&!bare.has(route);
    const mode=shell?'on':'off';
    if(app.dataset.shell!==mode)app.dataset.shell=mode;
    const nav=app.querySelector(':scope>.tabbar');
    if(shell&&!nav){
      app.insertAdjacentHTML('beforeend',tabbar());
      app.querySelector(':scope>.tabbar').dataset.dkAdded='1';
    }else if(!shell&&nav?.dataset.dkAdded)nav.remove();
  }
  new MutationObserver(dkSync).observe(app,{childList:true});
  wide?.addEventListener?.('change',()=>render());
  dkSync();
})();
