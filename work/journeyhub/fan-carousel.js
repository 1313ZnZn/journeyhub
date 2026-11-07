/* Choosing places on wide screens: a fan carousel instead of the one-card swipe deck.
   Every remaining place sits in a fan; the centered card is the one you decide on.
   Arrow keys, the side buttons, a click on a side card, a horizontal drag or trackpad
   scroll turn the fan. Skip and Must visit use the same choices as the swipe deck
   (A.jpPick), so saving, undo and planning are unchanged. Phones keep swiping. */
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const calm=window.matchMedia?.('(prefers-reduced-motion:reduce)');
  const SPREAD=4; // cards shown on each side of the centre
  let focusId=null,focusIdx=0,flip=null;

  const live=()=>typeof pd!=='undefined'&&pd.mode;
  function deck(){
    if(live())return pd.places.filter(p=>!pd.wanted.includes(p.id)&&!pd.skipped.includes(p.id)).map(p=>({id:p.id,place:p}));
    return jpRemaining().map(e=>({id:e.id,exp:e}));
  }
  function currentIndex(items){
    let i=items.findIndex(x=>x.id===focusId);
    if(i<0)i=Math.min(focusIdx,items.length-1);
    focusIdx=Math.max(0,i);focusId=items[focusIdx]?.id||null;
    return focusIdx;
  }
  const pose=(i,f)=>{const k=i-f,a=Math.abs(k);return '--k:'+k+';--fd:'+a+';--z:'+(40-a)+(a>SPREAD?';--hide:1':'');};

  function cardHTML(item,i,f){
    const k=i-f,on=k===0;
    const attrs=' class="fc-card'+(on?' is-focus':'')+'" data-pick-id="'+esc(item.id)+'" style="'+pose(i,f)+'"'+(Math.abs(k)>SPREAD?' aria-hidden="true"':'');
    if(item.place){
      const p=item.place;
      return '<article'+attrs+'>'+pdPhotoHTML(p)+'<div class="fc-shade"></div>'+
        (on?'':'<button type="button" class="fc-peek" data-act="fcFocus" data-a="'+esc(p.id)+'" tabindex="-1" aria-label="Show '+esc(p.name)+'"></button>')+
        '<div class="fc-copy"><span class="fc-tag">'+esc(pd.sample?'Sample place':'Place')+'</span><h2>'+esc(p.name)+'</h2>'+(on&&typeof pdReviewHTML==='function'?pdReviewHTML(p):'')+'</div></article>';
    }
    const e=item.exp;
    return '<article'+attrs+'><img class="fc-photo" src="'+esc(ixPhoto(e))+'" alt="'+esc(ixAlt(e))+'" draggable="false" loading="lazy"><div class="fc-shade"></div>'+
      (on?'':'<button type="button" class="fc-peek" data-act="fcFocus" data-a="'+esc(e.id)+'" tabindex="-1" aria-label="Show '+esc(e.name)+'"></button>')+
      '<div class="fc-copy"><span class="fc-tag">'+esc(e.kind)+'</span><h2>'+esc(e.name)+'</h2><p>'+esc(e.dur)+' · '+fmt(e.price)+' / guest</p></div></article>';
  }
  function infoHTML(item){
    if(item.place){
      const p=item.place;
      return '<div class="fc-info" aria-live="polite"><p>'+esc(p.reason||'')+'</p><p class="fc-addr">'+ic('pin',15)+esc(p.address||'')+'</p><div class="fc-src">'+pdSource(p)+(p.photo?.authors?.length?'<small>Photo: '+p.photo.authors.map(a=>esc(a.name)).join(', ')+'</small>':'')+'</div></div>';
    }
    const e=item.exp;
    return '<div class="fc-info" aria-live="polite"><p>'+esc(e.details?.summary||e.details?.en||e.does?.[0]||e.venue||'')+'</p><p class="fc-addr">'+ic('pin',15)+esc(e.venue||e.city)+'</p></div>';
  }
  function fanHTML(items){
    const f=currentIndex(items),item=items[f];
    const wantLabel=live()?(pd.sample?'Like':'Must visit'):'Want to go';
    const busy=live()&&pd.busy;
    const undo=live()?(pd.undo.length&&!busy?'pdUndo':''):(jpUndo.length?'jpUndo':'');
    return '<section class="fc" aria-label="Choose places" aria-roledescription="carousel">'+
      '<div class="fc-stage" tabindex="0" aria-label="'+esc((item.place||item.exp).name)+', '+(f+1)+' of '+items.length+'. Left and right arrows to browse.">'+
      '<div class="fc-fan">'+items.map((x,i)=>cardHTML(x,i,f)).join('')+'</div>'+
      '<button type="button" class="fc-nav prev" data-act="fcStep" data-a="-1" aria-label="Previous place"'+(f===0?' disabled':'')+'>'+ic('left',22)+'</button>'+
      '<button type="button" class="fc-nav next" data-act="fcStep" data-a="1" aria-label="Next place"'+(f>=items.length-1?' disabled':'')+'>'+ic('right',22)+'</button></div>'+
      '<div class="fc-actions"><button type="button" class="fc-choice skip" data-act="fcVote" data-a="skip"'+(busy?' disabled':'')+'>'+ic('x',22)+'<span>Skip</span></button>'+
      '<span class="fc-count"><b>'+(f+1)+'</b> / '+items.length+'</span>'+
      '<button type="button" class="fc-choice want" data-act="fcVote" data-a="want"'+(busy?' disabled':'')+'>'+ic('heart',22)+'<span>'+wantLabel+'</span></button></div>'+
      infoHTML(item)+
      '<div class="fc-tools">'+(undo?'<button type="button" class="btn-text" data-act="'+undo+'">'+ic('refresh',14)+' Undo last choice</button>':'')+
      (live()&&pd.sample?'<button type="button" class="btn-text" data-act="pdNewSearch">Plan my own trip</button>':'')+'</div></section>';
  }

  const snapshot=()=>{flip={};app.querySelectorAll('.fc-card').forEach(el=>{flip[el.dataset.pickId]=getComputedStyle(el).transform;});};
  // Turn the fan: re-render with the new centre, then animate each card from where it stood.
  function refocus(index){
    const stage=app.querySelector('.fc-stage');if(!stage)return;
    const items=deck();if(!items.length)return;
    index=Math.max(0,Math.min(items.length-1,index));
    if(index===focusIdx&&items[index]?.id===focusId)return;
    focusIdx=index;focusId=items[index].id;
    snapshot();render();
    app.querySelector('.fc-stage')?.focus({preventScroll:true});
  }
  A.fcStep=d=>refocus(focusIdx+Number(d));
  A.fcFocus=id=>{const i=deck().findIndex(x=>x.id===id);if(i>=0)refocus(i);};
  A.fcVote=vote=>{
    const items=deck(),f=currentIndex(items),item=items[f];if(!item)return;
    if(live()&&pd.busy)return;
    // Remember where every card stood so the fan can close the gap smoothly after the choice.
    snapshot();
    const card=app.querySelector('.fc-card.is-focus');
    if(card&&!calm?.matches){
      const box=card.getBoundingClientRect(),ghost=card.cloneNode(true);
      ghost.classList.add('fc-flight');ghost.dataset.vote=vote;ghost.setAttribute('aria-hidden','true');
      Object.assign(ghost.style,{position:'fixed',left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px',margin:'0',transform:'none',zIndex:'1000',pointerEvents:'none'});
      document.body.append(ghost);
      const to=vote==='want'?'translateY(-46%) scale(.62) rotate(-4deg)':'translateY(38%) scale(.86) rotate(10deg)';
      ghost.animate([{transform:'none',opacity:1},{transform:to,opacity:0}],{duration:420,easing:'cubic-bezier(.3,.7,.2,1)',fill:'forwards'}).finished.then(()=>ghost.remove(),()=>ghost.remove());
      setTimeout(()=>ghost.remove(),600);
    }
    focusId=items[f+1]?.id||items[f-1]?.id||null;focusIdx=items[f+1]?f:Math.max(0,f-1);
    A.jpPick(item.id,vote);
  };
  function playFlip(){
    if(!flip)return;const before=flip;flip=null;
    if(calm?.matches)return;
    app.querySelectorAll('.fc-card').forEach(el=>{
      const from=before[el.dataset.pickId],to=getComputedStyle(el).transform;
      if(from&&from!==to)el.animate([{transform:from},{transform:to}],{duration:520,easing:'cubic-bezier(.16,.84,.24,1)'});
    });
  }

  // Keyboard, drag and trackpad turn the fan.
  document.addEventListener('keydown',e=>{
    const stage=e.target.closest?.('.fc-stage');if(!stage||e.isComposing||e.altKey||e.metaKey||e.ctrlKey)return;
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();A.fcStep(e.key==='ArrowRight'?1:-1);}
    else if(e.key==='Home'||e.key==='End'){e.preventDefault();refocus(e.key==='Home'?0:deck().length-1);}
  });
  let drag=null,wheelAt=0,wheelSum=0;
  document.addEventListener('pointerdown',e=>{
    const stage=e.target.closest?.('.fc-stage');if(!stage||e.button>0||e.target.closest('.fc-nav'))return;
    drag={x:e.clientX,id:e.pointerId,moved:false};
  });
  document.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const dx=e.clientX-drag.x;
    if(Math.abs(dx)>=90){drag.x=e.clientX;drag.moved=true;A.fcStep(dx<0?1:-1);}
  });
  const endDrag=e=>{if(drag&&drag.id===e.pointerId){if(drag.moved)e.preventDefault?.();drag=null;}};
  document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);
  document.addEventListener('click',e=>{if(e.target.closest?.('.fc-stage')&&drag?.moved){e.stopPropagation();e.preventDefault();}},true);
  document.addEventListener('wheel',e=>{
    if(!e.target.closest?.('.fc-stage')||Math.abs(e.deltaX)<=Math.abs(e.deltaY))return;
    e.preventDefault();const now=Date.now();if(now-wheelAt>260)wheelSum=0;
    wheelSum+=e.deltaX;
    if(Math.abs(wheelSum)>60){wheelAt=now;A.fcStep(wheelSum>0?1:-1);wheelSum=0;}
  },{passive:false});

  const fcPicks=V['ai-picks'];
  V['ai-picks']=function(){
    const view=fcPicks.apply(this,arguments);
    if(!wide?.matches||!view?.body||!view.body.includes('jp-swipe-card'))return view;
    const items=deck();if(!items.length)return view;
    const root=document.createElement('template');root.innerHTML=view.body;
    const swipe=root.content.querySelector('.jp-deck');if(!swipe)return view;
    const slot=document.createElement('div');slot.innerHTML=fanHTML(items);
    swipe.replaceWith(slot.firstElementChild);
    root.content.querySelectorAll('.jp-swipe-actions,.pd-card-credit').forEach(el=>el.remove());
    // The swipe deck's place-details panel described its top card; the fan shows the centered one instead.
    root.content.querySelectorAll('.pd-card-details').forEach(el=>{if(el.querySelector('summary')?.textContent==='Place details')el.remove();});
    root.content.querySelector('.jp-swipe-heading [data-act="jpUndo"]')?.remove();
    view.body=root.innerHTML.replace('jp-swipe-page','jp-swipe-page fc-page');
    const after=view.after;
    view.after=function(){if(after)after.apply(this,arguments);playFlip();};
    return view;
  };
  wide?.addEventListener?.('change',()=>{flip=null;});
})();
