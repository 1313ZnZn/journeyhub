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
  const fcUpIc='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';

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
        (on?'<span class="fc-pull" aria-hidden="true">'+fcUpIc+'Pull up, or drag to a slot</span>':'')+
      '<div class="fc-copy"><span class="fc-tag">'+esc(pd.sample?'Sample place':'Place')+'</span><h2>'+esc(p.name)+'</h2>'+(on&&typeof pdReviewHTML==='function'?pdReviewHTML(p):'')+'</div></article>';
    }
    const e=item.exp;
    return '<article'+attrs+'><img class="fc-photo" src="'+esc(ixPhoto(e))+'" alt="'+esc(ixAlt(e))+'" draggable="false" loading="lazy"><div class="fc-shade"></div>'+
      (on?'':'<button type="button" class="fc-peek" data-act="fcFocus" data-a="'+esc(e.id)+'" tabindex="-1" aria-label="Show '+esc(e.name)+'"></button>')+
      (on?'<span class="fc-pull" aria-hidden="true">'+fcUpIc+'Pull up, or drag to a slot</span>':'')+
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
  // Kept places sit in slots, one per place the trip allows, grouped by day.
  let freshId=null,doneAttrs='';
  function keptInfo(id){
    if(live()){const p=pd.places.find(x=>x.id===id);return p?{name:p.name,img:pdPhotoState(p).urls[0]||''}:null;}
    const e=EXPS[id];return e?{name:e.name,img:ixPhoto(e)}:null;
  }
  // Kept places sit in the slot the traveler chose: a day and a position in it. New picks
  // take the slot they were dropped on, or the first free one.
  let jpSlots=[],pendingSlot=null;
  const slotStore=()=>live()?(pd.fcSlots||=[]):jpSlots;
  function slotModel(){
    const cap=jhPickCap(),perDay=jhPickPerDay(cap),total=perDay.reduce((a,b)=>a+b,0),kept=jhPickKept();
    const store=slotStore(),slots=Array.from({length:total},(_,i)=>kept.includes(store[i])?store[i]:null);
    const seen=new Set(),extra=[];
    slots.forEach((id,i)=>{if(id&&seen.has(id))slots[i]=null;else if(id)seen.add(id);});
    for(const id of kept){if(seen.has(id))continue;const i=slots.indexOf(null);if(i>=0)slots[i]=id;else extra.push(id);seen.add(id);}
    store.length=0;store.push(...slots,...extra);
    return {perDay,slots,extra};
  }
  // Day placement for the planner, only once the traveler has arranged places themselves.
  function dayPlan(){
    if(!live()||!pd.fcArranged)return null;
    const {perDay,slots,extra}=slotModel();let at=0;
    const days=perDay.map(n=>{const ids=slots.slice(at,at+n).filter(Boolean);at+=n;return ids;});
    if(extra.length)days[days.length-1].push(...extra);
    return days.some(d=>d.length)?days:null;
  }
  window.jhFanDayPlan=dayPlan;
  function trayHTML(){
    const cap=jhPickCap(),{perDay,slots,extra:over}=slotModel(),kept=jhPickKept();let n=0;
    const slot=id=>{
      const i=n++,info=id&&keptInfo(id);
      if(!info)return '<span class="fc-slot" data-slot="'+i+'" aria-hidden="true">'+ic('plus',16)+'</span>';
      return '<button type="button" class="fc-slot is-kept'+(id===freshId?' is-new':'')+'" data-slot="'+i+'" data-act="fcRelease" data-a="'+esc(id)+'" aria-label="'+esc(info.name)+'. Drag to another slot, or click to put back." title="'+esc(info.name)+' · drag to move">'+
        (info.img?'<img src="'+esc(info.img)+'" alt="" draggable="false" referrerpolicy="no-referrer">':'')+'<span>'+esc(info.name)+'</span><i>'+ic('x',12)+'</i></button>';
    };
    let at=0;
    const groups=perDay.map((count,d)=>{const ids=slots.slice(at,at+count);at+=count;return '<div class="fc-day"><small>'+(perDay.length>1?'Day '+(d+1):'Your day')+'</small><div class="fc-slots">'+ids.map(slot).join('')+'</div></div>';}).join('');
    // Places kept before the trip got shorter still show, past the last slot.
    const extra=over.map(slot).join('');
    freshId=null;
    const busy=live()&&pd.busy;
    const done=doneAttrs?'<button type="button" class="fc-done" '+doneAttrs+(busy?' disabled':'')+'>'+ic('check',18)+'<span>'+(kept.length?'Done · plan '+plural(kept.length,'place'):'Done')+'</span></button>':'';
    return '<div class="fc-tray" aria-label="Your picks"><div class="fc-tray-head"><strong>Your picks <b>'+kept.length+'</b> / '+cap+'</strong><span>'+esc(jhPickLimitText(cap))+(perDay.length>1?' About '+Math.round(cap/perDay.length)+' a day.':'')+'</span></div>'+
      '<div class="fc-days">'+groups+(extra?'<div class="fc-day"><small>Over the limit</small><div class="fc-slots">'+extra+'</div></div>':'')+'</div>'+done+'</div>';
  }
  function fanHTML(items){
    const f=currentIndex(items),item=items[f];
    const wantLabel=live()?(pd.sample?'Like':'Must visit'):'Want to go';
    const busy=live()&&pd.busy,full=jhPickKept().length>=jhPickCap();
    const undo=live()?(pd.undo.length&&!busy?'pdUndo':''):(jpUndo.length?'jpUndo':'');
    return '<section class="fc" aria-label="Choose places" aria-roledescription="carousel">'+trayHTML()+
      '<div class="fc-stage" tabindex="0" aria-label="'+esc((item.place||item.exp).name)+', '+(f+1)+' of '+items.length+'. Left and right arrows to browse.">'+
      '<div class="fc-fan">'+items.map((x,i)=>cardHTML(x,i,f)).join('')+'</div>'+
      '<button type="button" class="fc-nav prev" data-act="fcStep" data-a="-1" aria-label="Previous place"'+(f===0?' disabled':'')+'>'+ic('left',22)+'</button>'+
      '<button type="button" class="fc-nav next" data-act="fcStep" data-a="1" aria-label="Next place"'+(f>=items.length-1?' disabled':'')+'>'+ic('right',22)+'</button></div>'+
      '<div class="fc-actions"><button type="button" class="fc-choice skip" data-act="fcVote" data-a="skip"'+(busy?' disabled':'')+'>'+ic('x',22)+'<span>Skip</span></button>'+
      '<span class="fc-count"><b>'+(f+1)+'</b> / '+items.length+'</span>'+
      '<button type="button" class="fc-choice want" data-act="fcVote" data-a="want"'+(busy||full?' disabled':'')+'>'+ic('heart',22)+'<span>'+(full?'Picks full':wantLabel)+'</span></button></div>'+
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
  A.fcRelease=id=>{snapshot();focusId=id;A.jhPickRelease(id);app.querySelector('.fc-stage')?.focus({preventScroll:true});};
  A.fcFocus=id=>{const i=deck().findIndex(x=>x.id===id);if(i>=0)refocus(i);};
  A.fcVote=vote=>{
    const items=deck(),f=currentIndex(items),item=items[f];if(!item)return;
    if(live()&&pd.busy)return;
    // Remember where every card stood so the fan can close the gap smoothly after the choice.
    snapshot();
    const card=app.querySelector('.fc-card.is-focus');
    if(vote==='want'&&jhPickKept().length>=jhPickCap()){
      if(card&&!calm?.matches)card.animate([{translate:'0 0'},{translate:'-10px 0'},{translate:'10px 0'},{translate:'-6px 0'},{translate:'0 0'}],{duration:360});
      flip=null;A.jpPick(item.id,vote);return;
    }
    if(card&&!calm?.matches){
      const box=card.getBoundingClientRect(),ghost=card.cloneNode(true);
      ghost.classList.add('fc-flight');ghost.dataset.vote=vote;ghost.setAttribute('aria-hidden','true');
      Object.assign(ghost.style,{position:'fixed',left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px',margin:'0',transform:'none',transformOrigin:'0 0',zIndex:'1000',pointerEvents:'none'});
      document.body.append(ghost);
      const slot=vote==='want'?(pendingSlot!=null&&app.querySelector('.fc-slot[data-slot="'+pendingSlot+'"]:not(.is-kept)'))||app.querySelector('.fc-slot:not(.is-kept)'):null,target=slot?.getBoundingClientRect();
      const frames=target
        // Drawn out of the fan, then dropped into the next free slot.
        ?[{transform:'none'},{transform:'translate(0,-90px) scale(1.04) rotate(-2deg)',offset:.32},{transform:'translate('+(target.left-box.left)+'px,'+(target.top-box.top)+'px) scale('+(target.width/box.width)+','+(target.height/box.height)+')'}]
        :[{transform:'none',opacity:1},{transform:vote==='want'?'translateY(-46%) scale(.62) rotate(-4deg)':'translate(0,38%) scale(.86) rotate(10deg)',opacity:0}];
      ghost.animate(frames,{duration:target?680:420,easing:'cubic-bezier(.3,.7,.2,1)',fill:'forwards'}).finished.then(()=>ghost.remove(),()=>ghost.remove());
      setTimeout(()=>ghost.remove(),900);
      if(target)freshId=item.id;
    }
    focusId=items[f+1]?.id||items[f-1]?.id||null;focusIdx=items[f+1]?f:Math.max(0,f-1);
    // Dropped on a particular slot: the place goes there.
    if(vote==='want'&&pendingSlot!=null){const store=slotStore();if(!store[pendingSlot]){store[pendingSlot]=item.id;if(live())pd.fcArranged=true;}}
    pendingSlot=null;
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
  const KEEP_AT=-110;
  document.addEventListener('pointerdown',e=>{
    const stage=e.target.closest?.('.fc-stage');if(!stage||e.button>0||e.target.closest('.fc-nav'))return;
    drag={x:e.clientX,sx:e.clientX,sy:e.clientY,id:e.pointerId,moved:false,axis:null,pull:0,card:e.target.closest('.fc-card.is-focus')};
  });
  document.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const tx=e.clientX-drag.sx,ty=e.clientY-drag.sy;
    if(!drag.axis){
      if(Math.abs(tx)>12&&Math.abs(tx)>Math.abs(ty))drag.axis='x';
      else if(drag.card&&ty<-12&&Math.abs(ty)>Math.abs(tx)){drag.axis='y';drag.card.classList.add('is-pulling');try{drag.card.setPointerCapture?.(e.pointerId);}catch{}}
    }
    if(drag.axis==='x'){const dx=e.clientX-drag.x;if(Math.abs(dx)>=90){drag.x=e.clientX;drag.moved=true;A.fcStep(dx<0?1:-1);}}
    else if(drag.axis==='y'){
      // The centred card follows the pointer up, out of the fan.
      drag.moved=true;drag.pull=Math.max(-220,Math.min(0,ty));
      drag.card.style.transform='translate('+tx+'px,'+(-18+Math.max(-260,Math.min(140,ty)))+'px) scale('+(1.05+Math.min(.05,-drag.pull/2000))+')';
      drag.card.classList.toggle('is-ready',drag.pull<=KEEP_AT);
      const over=slotAt(e.clientX,e.clientY,true);
      app.querySelectorAll('.fc-slot.is-target').forEach(el=>{if(el!==over)el.classList.remove('is-target');});
      over?.classList.add('is-target');drag.slot=over?+over.dataset.slot:null;
    }
  });
  const endDrag=e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const g=drag;drag=null;if(g.moved)e.preventDefault?.();
    if(g.axis!=='y')return;
    app.querySelectorAll('.fc-slot.is-target').forEach(el=>el.classList.remove('is-target'));
    if(e.type==='pointerup'&&(g.pull<=KEEP_AT||g.slot!=null)&&g.card.isConnected){pendingSlot=g.slot;A.fcVote('want');if(g.card.isConnected){g.card.classList.remove('is-pulling','is-ready');g.card.style.transform='';}return;}
    g.card.classList.remove('is-pulling','is-ready');g.card.style.transform='';
  };
  document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);

  // Which slot is under the pointer (optionally only free ones), with a little slack.
  function slotAt(x,y,freeOnly){
    for(const el of app.querySelectorAll('.fc-slot[data-slot]')){
      if(freeOnly&&el.classList.contains('is-kept'))continue;
      const r=el.getBoundingClientRect();if(x>=r.left-8&&x<=r.right+8&&y>=r.top-8&&y<=r.bottom+8)return el;
    }
    return null;
  }
  // Rearranging: drag a kept place onto another slot to move it there (or swap).
  let chip=null,chipMoved=false;
  document.addEventListener('pointerdown',e=>{
    const el=e.target.closest?.('.fc-slot.is-kept');if(!el||e.button>0||(live()&&pd.busy))return;
    chip={el,id:el.dataset.a,from:+el.dataset.slot,sx:e.clientX,sy:e.clientY,pid:e.pointerId,ghost:null};
  });
  document.addEventListener('pointermove',e=>{
    if(!chip||chip.pid!==e.pointerId)return;
    if(!chip.ghost){
      if(Math.hypot(e.clientX-chip.sx,e.clientY-chip.sy)<6)return;
      const r=chip.el.getBoundingClientRect();chip.dx=chip.sx-r.left;chip.dy=chip.sy-r.top;
      chip.ghost=chip.el.cloneNode(true);chip.ghost.classList.add('fc-chip-ghost');chip.ghost.removeAttribute('data-slot');
      Object.assign(chip.ghost.style,{position:'fixed',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',margin:'0',zIndex:'1000',pointerEvents:'none'});
      document.body.append(chip.ghost);chip.el.classList.add('is-lifted');
    }
    chip.ghost.style.transform='translate('+(e.clientX-chip.sx)+'px,'+(e.clientY-chip.sy)+'px) scale(1.06) rotate(-2deg)';
    const over=slotAt(e.clientX,e.clientY,false);
    app.querySelectorAll('.fc-slot.is-target').forEach(el=>{if(el!==over)el.classList.remove('is-target');});
    if(over&&over!==chip.el)over.classList.add('is-target');
  });
  const chipEnd=e=>{
    if(!chip||chip.pid!==e.pointerId)return;
    const c=chip;chip=null;app.querySelectorAll('.fc-slot.is-target').forEach(el=>el.classList.remove('is-target'));
    if(!c.ghost)return;
    chipMoved=true;c.ghost.remove();c.el.classList.remove('is-lifted');
    const over=e.type==='pointerup'?slotAt(e.clientX,e.clientY,false):null;
    if(!over||over===c.el)return;
    const to=+over.dataset.slot,store=slotStore();slotModel();
    const other=store[to]||null;store[to]=c.id;store[c.from]=other;
    if(live())pd.fcArranged=true;
    freshId=c.id;render();
  };
  document.addEventListener('pointerup',chipEnd);document.addEventListener('pointercancel',chipEnd);
  // A drag is not a click: it must not put the place back.
  document.addEventListener('click',e=>{if(chipMoved&&e.target.closest?.('.fc-slot')){chipMoved=false;e.stopPropagation();e.preventDefault();}else chipMoved=false;},true);
  let lastDragMoved=false;document.addEventListener('pointerup',e=>{lastDragMoved=!!drag?.moved;},true);
  document.addEventListener('click',e=>{if(e.target.closest?.('.fc-stage')&&lastDragMoved){lastDragMoved=false;e.stopPropagation();e.preventDefault();}},true);
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
    // The header's Done action is repeated as the tray's main button.
    const doneMatch=view.bar?.match(/<button class="btn-text" (data-act="[^"]+"(?: data-a="[^"]+")?)/);doneAttrs=doneMatch?doneMatch[1]:'';
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
