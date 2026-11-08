/* This week on JourneyHub (desktop): the places travelers most often put in Must go, and the
   place-debate champions, per city. Shown on Explore (following the city on screen) and as a
   small "#N this week" badge on the focused card while choosing places. Counts only; no names. */
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const CITIES=['Shanghai','Bangkok','Singapore'];
  const TTL=5*60*1000;
  const boards=new Map(); // city -> {data, at, loading, error}
  let shown=null;          // city chosen in the section (null = follow Explore's city)
  let tab='must';          // sidebar board: 'must' or 'debates'
  const pipOn=()=>typeof window.jhPipShowing==='function'&&window.jhPipShowing();
  const signedIn=()=>typeof jhUser!=='undefined'&&!!jhUser;
  const head=(p,size)=>typeof jhBuddyHead==='function'?jhBuddyHead({id:p.placeId,name:p.name,kind:String(p.kind||'').replace(/ /g,'_')},size):'';

  function load(city){
    const b=boards.get(city);
    if(!signedIn()||typeof window.jhPipPost!=='function'||b?.loading||(b?.data&&Date.now()-b.at<TTL)||(b?.error&&Date.now()-b.at<30000))return;
    const rec={...(b||{}),loading:true};boards.set(city,rec);
    window.jhPipPost({action:'leaderboard',city}).then(data=>{boards.set(city,{data,at:Date.now(),loading:false});},e=>{boards.set(city,{...rec,loading:false,error:e.message||'The leaderboard is unavailable.',at:Date.now()});})
      .finally(()=>{paintExplore();window.jhPipSync?.();if(state.route==='ai-picks')render();});
  }
  const exploreCity=()=>{const t=document.querySelector('#app [data-dx-city]')?.textContent?.trim();return CITIES.includes(t)?t:'Shanghai';};
  const currentCity=()=>shown||exploreCity();

  const medal=i=>['🥇','🥈','🥉'][i]||'<b>'+(i+1)+'</b>';
  function mustHTML(rows){
    if(!rows.length)return '<p class="lb-empty">No Must go picks yet this week. Yours could be the first.</p>';
    const top=rows[0].travelers||1;
    return '<ol class="lb-list">'+rows.slice(0,5).map((r,i)=>'<li style="--i:'+i+'"><span class="lb-rank">'+medal(i)+'</span>'+head(r,34)+'<span class="lb-name"><strong>'+esc(r.name)+'</strong><small>'+plural(r.travelers,'traveler')+' · '+plural(r.trips,'trip')+'</small></span><span class="lb-bar"><i style="width:'+Math.max(12,Math.round(r.travelers/top*100))+'%"></i></span></li>').join('')+'</ol>';
  }
  function debateHTML(rows){
    if(!rows.length)return '<p class="lb-empty">No debates finished this week. Put two places in <b>Maybe</b> and let them argue it out 🎤</p>';
    return '<ol class="lb-list">'+rows.slice(0,5).map((r,i)=>{const rate=Math.round(r.wins/r.debates*100);
      return '<li style="--i:'+i+'"><span class="lb-rank">'+medal(i)+'</span>'+head(r,34)+'<span class="lb-name"><strong>'+esc(r.name)+'</strong><small>Won '+r.wins+' of '+plural(r.debates,'debate')+'</small></span><span class="lb-rate">'+rate+'%</span></li>';}).join('')+'</ol>';
  }
  function sectionInner(){
    const city=currentCity();
    const tabs='<div class="lb-tabs" role="tablist" aria-label="City">'+CITIES.map(c=>'<button type="button" role="tab" aria-selected="'+(c===city)+'" data-act="lbCity" data-a="'+c+'">'+c+'</button>').join('')+'</div>';
    const top='<div class="lb-head"><div><span class="lb-kicker">🏆 This week on JourneyHub</span><h2>What travelers pick in '+esc(city)+'</h2></div>'+tabs+'</div>';
    if(!signedIn())return top+'<div class="lb-guest"><p>See which places travelers put in <b>Must go</b> this week, and which ones win place debates.</p><button type="button" class="lb-go" data-act="lbSignIn">Sign in to see the leaderboard</button></div>';
    load(city);
    const b=boards.get(city);
    if(!b?.data)return top+(b?.error?'<p class="lb-empty" role="alert">'+esc(b.error)+' <button type="button" class="lb-link" data-act="lbRetry">Try again</button></p>':'<div class="lb-boards is-loading"><div class="lb-board"></div><div class="lb-board"></div></div>');
    return top+'<div class="lb-boards"><section class="lb-board"><h3>🧳 Most picked for Must go</h3>'+mustHTML(b.data.mustGo||[])+'</section><section class="lb-board"><h3>🎤 Debate champions</h3>'+debateHTML(b.data.debates||[])+'</section></div>'+
      '<p class="lb-note">Last 7 days · all JourneyHub travelers · counts only, no names.</p>';
  }
  function paintExplore(){const el=document.querySelector('#app [data-lb]');if(!el)return;const html=sectionInner();if(el.dataset.html!==html){el.innerHTML=html;el.dataset.html=html;}}

  A.lbCity=c=>{if(!CITIES.includes(c))return;shown=c;paintExplore();window.jhPipSync?.();};
  A.lbTab=t=>{tab=t==='debates'?'debates':'must';window.jhPipSync?.();};
  A.lbRetry=()=>{boards.delete(currentCity());paintExplore();window.jhPipSync?.();};
  A.lbSignIn=()=>openLogin('traveler',{route:'home'});
  // Follow the city Explore is showing, unless the traveler picked one in the section.
  document.addEventListener('jh:painted',()=>{if(state.route==='home'){paintExplore();window.jhPipSync?.();}});

  const lbHome=V.home;
  V.home=function(){
    const view=lbHome.apply(this,arguments);
    // With Pip's sidebar showing, the leaderboard lives there instead.
    if(!wide?.matches||state.role==='staff'||pipOn()||!view?.body?.includes('</main></div>'))return view;
    const inner=sectionInner();
    view.body=view.body.replace(/<\/main><\/div>$/,'<section class="lb" data-lb aria-label="This week on JourneyHub">'+inner+'</section></main></div>');
    setTimeout(paintExplore,0); // pick up the city Explore actually shows once it is on screen
    return view;
  };

  // In Pip's sidebar on Explore: one board at a time, for the city on screen.
  window.jhLeaderboardCard=()=>{
    if(!wide?.matches)return '';
    const city=currentCity();
    const cities='<div class="lb-tabs is-side" role="tablist" aria-label="City">'+CITIES.map(c=>'<button type="button" role="tab" aria-selected="'+(c===city)+'" data-act="lbCity" data-a="'+c+'">'+c+'</button>').join('')+'</div>';
    const boardsTabs='<div class="lb-switch" role="tablist" aria-label="Leaderboard"><button type="button" role="tab" aria-selected="'+(tab==='must')+'" data-act="lbTab" data-a="must">🧳 Must go</button><button type="button" role="tab" aria-selected="'+(tab==='debates')+'" data-act="lbTab" data-a="debates">🎤 Debates</button></div>';
    let body;
    if(!signedIn())body='<p class="lb-empty">Sign in to see what travelers pick this week.</p><button type="button" class="lb-go" data-act="lbSignIn">Sign in</button>';
    else{load(city);const b=boards.get(city);
      body=!b?.data?(b?.error?'<p class="lb-empty" role="alert">'+esc(b.error)+' <button type="button" class="lb-link" data-act="lbRetry">Try again</button></p>':'<div class="lb-board is-side-loading"></div>')
        :tab==='must'?mustHTML(b.data.mustGo||[]):debateHTML(b.data.debates||[]);}
    return '<div class="pip-card lb-side"><div class="pip-card-body"><strong>🏆 This week in '+esc(city)+'</strong>'+cities+boardsTabs+body+'<small class="lb-note">Last 7 days · all travelers · counts only.</small></div></div>';
  };

  // On the card screen: a badge when the focused place is in this week's Must go top five.
  window.jhRankBadge=p=>{
    if(!wide?.matches||typeof pd==='undefined'||!pd.mode||pd.sample)return '';
    const city=pd.input?.city;if(!CITIES.includes(city))return '';
    load(city);const rows=boards.get(city)?.data?.mustGo||[],i=rows.slice(0,5).findIndex(r=>r.placeId===p.id);
    if(i<0)return '';
    return '<span class="lb-badge" title="'+esc(plural(rows[i].travelers,'traveler'))+' put this in Must go this week">🔥 #'+(i+1)+' Must go this week</span>';
  };
})();
