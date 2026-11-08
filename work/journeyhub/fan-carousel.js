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
  // Maybe: places the traveler is unsure about. Not must-visits and not skipped, so the planner
  // may still use them to fill free time. Kept per saved search in this browser.
  const maybeKey=()=>'jh-maybe:'+(pd.historyId||pd.token||'draft');
  function maybeList(){
    if(!live())return [];
    if(!Array.isArray(pd.maybe)){try{pd.maybe=JSON.parse(localStorage.getItem(maybeKey())||'[]');}catch{pd.maybe=[];}}
    pd.maybe=pd.maybe.filter(id=>pd.places.some(p=>p.id===id)&&!pd.wanted.includes(id)&&!pd.skipped.includes(id));
    return pd.maybe;
  }
  function saveMaybe(){try{localStorage.setItem(maybeKey(),JSON.stringify(pd.maybe||[]));}catch{}}
  window.jhFanMaybe=()=>maybeList().slice();
  function deck(){
    if(live()){const maybe=maybeList();return pd.places.filter(p=>!pd.wanted.includes(p.id)&&!pd.skipped.includes(p.id)&&!maybe.includes(p.id)).map(p=>({id:p.id,place:p}));}
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
      return '<article'+attrs+'>'+pdPhotoHTML(p)+'<div class="fc-shade"></div>'+(typeof jhBuddy==='function'?'<span class="fc-buddy">'+jhBuddy(p,on?50:40,on?'smile':'smile')+'</span>':'')+
        (on?'':'<button type="button" class="fc-peek" data-act="fcFocus" data-a="'+esc(p.id)+'" tabindex="-1" aria-label="Show '+esc(p.name)+'"></button>')+
        (on?'<span class="fc-pull" aria-hidden="true">'+fcUpIc+'Drag to a pile</span>':'')+
      '<div class="fc-copy"><span class="fc-tag">'+esc(pd.sample?'Sample place':'Place')+'</span><h2>'+esc(p.name)+'</h2>'+(on&&typeof pdReviewHTML==='function'?pdReviewHTML(p):'')+'</div></article>';
    }
    const e=item.exp;
    return '<article'+attrs+'><img class="fc-photo" src="'+esc(ixPhoto(e))+'" alt="'+esc(ixAlt(e))+'" draggable="false" loading="lazy"><div class="fc-shade"></div>'+
      (on?'':'<button type="button" class="fc-peek" data-act="fcFocus" data-a="'+esc(e.id)+'" tabindex="-1" aria-label="Show '+esc(e.name)+'"></button>')+
      (on?'<span class="fc-pull" aria-hidden="true">'+fcUpIc+'Drag to a pile</span>':'')+
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
    return '<div class="fc-tray fc-pile" data-pile="want" aria-label="Must go"><div class="fc-tray-head"><strong><span class="fc-pile-ic" aria-hidden="true">🧳</span>Must go <b>'+kept.length+'</b> / '+cap+'</strong><span>'+esc(jhPickLimitText(cap))+(perDay.length>1?' About '+Math.round(cap/perDay.length)+' a day.':'')+'</span></div>'+
      '<div class="fc-days">'+groups+(extra?'<div class="fc-day"><small>Over the limit</small><div class="fc-slots">'+extra+'</div></div>':'')+'</div>'+done+'</div>';
  }
  // Maybe and Not this time piles, next to Must go.
  function chipHTML(p,kind){
    return '<button type="button" class="fc-chip" data-pile-chip="'+kind+'" data-a="'+esc(p.id)+'" title="'+esc(p.name)+'">'+(typeof jhBuddyHead==='function'?jhBuddyHead(p,30,kind==='skip'?'sad':'smile'):'')+'<span>'+esc(p.name)+'</span></button>';
  }
  function sidePilesHTML(){
    if(!live())return '';
    const maybe=maybeList().map(id=>pd.places.find(p=>p.id===id)).filter(Boolean),skipped=pd.skipped.map(id=>pd.places.find(p=>p.id===id)).filter(Boolean).reverse();
    return '<div class="fc-pile fc-pile-maybe" data-pile="maybe" aria-label="Maybe"><div class="fc-pile-head"><strong><span class="fc-pile-ic" aria-hidden="true">🤔</span>Maybe <b>'+maybe.length+'</b></strong><span>Drag one to a day, or click to look again.</span></div><div class="fc-chips">'+(maybe.length?maybe.map(p=>chipHTML(p,'maybe')).join(''):'<p class="fc-pile-empty">Unsure about a place? Drop it here.</p>')+'</div></div>'+
      '<div class="fc-pile fc-pile-skip" data-pile="skip" aria-label="Not this time"><div class="fc-pile-head"><strong><span class="fc-pile-ic" aria-hidden="true">🙅</span>Not this time <b>'+skipped.length+'</b></strong><span>Click one to bring it back.</span></div><div class="fc-chips">'+(skipped.length?skipped.slice(0,6).map(p=>chipHTML(p,'skip')).join('')+(skipped.length>6?'<span class="fc-more">+'+(skipped.length-6)+'</span>':''):'<p class="fc-pile-empty">Places you pass on land here.</p>')+'</div></div>';
  }
  function fanHTML(items){
    const f=currentIndex(items),item=items[f];
    const wantLabel=live()?(pd.sample?'Like':'Must visit'):'Want to go';
    const busy=live()&&pd.busy,full=jhPickKept().length>=jhPickCap();
    const undo=live()?(pd.undo.length&&!busy?'pdUndo':''):(jpUndo.length?'jpUndo':'');
    const piles=live()?'<div class="fc-piles">'+trayHTML()+sidePilesHTML()+'</div>':trayHTML();
    return '<section class="fc'+(live()?' has-piles':'')+'" aria-label="Choose places" aria-roledescription="carousel">'+(live()?'':piles)+
      '<div class="fc-stage" tabindex="0" aria-label="'+esc((item.place||item.exp).name)+', '+(f+1)+' of '+items.length+'. Left and right arrows to browse.">'+
      '<div class="fc-fan">'+items.map((x,i)=>cardHTML(x,i,f)).join('')+'</div>'+
      '<button type="button" class="fc-nav prev" data-act="fcStep" data-a="-1" aria-label="Previous place"'+(f===0?' disabled':'')+'>'+ic('left',22)+'</button>'+
      '<button type="button" class="fc-nav next" data-act="fcStep" data-a="1" aria-label="Next place"'+(f>=items.length-1?' disabled':'')+'>'+ic('right',22)+'</button></div>'+
      '<div class="fc-actions"><button type="button" class="fc-choice skip" data-act="fcVote" data-a="skip"'+(busy?' disabled':'')+' aria-keyshortcuts="1">'+(live()?'<span aria-hidden="true">🙅</span><span>Not this time</span><kbd>1</kbd>':ic('x',22)+'<span>Skip</span>')+'</button>'+
      (live()?'<button type="button" class="fc-choice maybe" data-act="fcVote" data-a="maybe"'+(busy?' disabled':'')+' aria-keyshortcuts="2"><span aria-hidden="true">🤔</span><span>Maybe</span><kbd>2</kbd></button>':'<span class="fc-count"><b>'+(f+1)+'</b> / '+items.length+'</span>')+
      '<button type="button" class="fc-choice want" data-act="fcVote" data-a="want"'+(busy||full?' disabled':'')+' aria-keyshortcuts="3">'+(live()?'<span aria-hidden="true">🧳</span>':ic('heart',22))+'<span>'+(full?'Picks full':live()?'Must go':wantLabel)+'</span>'+(live()?'<kbd>3</kbd>':'')+'</button></div>'+
      (live()?piles:'')+infoHTML(item)+
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
  const fcUndoBase=A.pdUndo;
  A.pdUndo=function(){
    const id=pd.undo?.at(-1);
    if(live()&&!pd.busy&&id&&maybeList().includes(id)){pd.undo.pop();pd.maybe=pd.maybe.filter(x=>x!==id);saveMaybe();snapshot();focusId=id;render();return;}
    return fcUndoBase.apply(this,arguments);
  };
  // Move a place between piles (or back to the cards).
  function movePlace(id,to,slot){
    if(!live()||pd.busy)return;
    const from=pd.wanted.includes(id)?'want':pd.skipped.includes(id)?'skip':maybeList().includes(id)?'maybe':'deck';
    if(from===to)return;
    if(to==='want'&&jhPickKept().length>=jhPickCap()){toast(jhPickLimitText()+' Put one back to keep this.');return;}
    pd.maybe=maybeList().filter(x=>x!==id);
    if(from==='want'){pd.wanted=pd.wanted.filter(x=>x!==id);}
    if(from==='skip'){pd.skipped=pd.skipped.filter(x=>x!==id);}
    pd.undo=pd.undo.filter(x=>x!==id);
    if(to==='want'){if(slot!=null){const store=slotStore();slotModel();if(!store[slot]){store[slot]=id;pd.fcArranged=true;}}pd.wanted.push(id);pd.undo.push(id);freshId=id;}
    else if(to==='skip'){pd.skipped.push(id);pd.undo.push(id);}
    else if(to==='maybe'){pd.maybe.push(id);pd.undo.push(id);}
    else{focusId=id;}
    saveMaybe();pd.plan=null;pd.error='';
    if(typeof thQueueChoices==='function')thQueueChoices(pd);
    document.dispatchEvent(new CustomEvent('jh:pile',{detail:{id,pile:to,from}}));
    render();
  }
  window.jhFanMove=movePlace;
  document.addEventListener('click',e=>{
    const chip=e.target.closest?.('.fc-chip[data-pile-chip]');if(!chip||chipMoved())return;
    e.preventDefault();snapshot();movePlace(chip.dataset.a,'deck');
  });
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
      const slot=vote==='want'?(pendingSlot!=null&&app.querySelector('.fc-slot[data-slot="'+pendingSlot+'"]:not(.is-kept)'))||app.querySelector('.fc-slot:not(.is-kept)'):app.querySelector('.fc-pile[data-pile="'+vote+'"] .fc-chips'),target=slot?.getBoundingClientRect();
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
    if(vote==='maybe'){
      if(!live()||pd.busy)return;
      maybeList();pd.maybe.push(item.id);saveMaybe();pd.undo.push(item.id);pd.plan=null;pd.error='';
      document.dispatchEvent(new CustomEvent('jh:pile',{detail:{id:item.id,pile:'maybe'}}));render();return;
    }
    A.jpPick(item.id,vote);
    if(live())document.dispatchEvent(new CustomEvent('jh:pile',{detail:{id:item.id,pile:vote}}));
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
  // 1 · 2 · 3 deal the centre card anywhere on the card screen, unless the traveler is typing.
  document.addEventListener('keydown',e=>{
    if(!live()||!['1','2','3'].includes(e.key)||e.altKey||e.metaKey||e.ctrlKey||e.isComposing)return;
    if(!app.querySelector('.fc.has-piles')||e.target.closest?.('input,textarea,select,[contenteditable]'))return;
    e.preventDefault();A.fcVote({1:'skip',2:'maybe',3:'want'}[e.key]);
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
      else if(drag.card&&Math.abs(ty)>12&&Math.abs(ty)>Math.abs(tx)){drag.axis='y';drag.card.classList.add('is-pulling');try{drag.card.setPointerCapture?.(e.pointerId);}catch{}}
    }
    if(drag.axis==='x'){const dx=e.clientX-drag.x;if(Math.abs(dx)>=90){drag.x=e.clientX;drag.moved=true;A.fcStep(dx<0?1:-1);}}
    else if(drag.axis==='y'){
      // The centred card follows the pointer up, out of the fan.
      drag.moved=true;drag.pull=Math.max(-220,Math.min(0,ty));
      drag.card.style.transform='translate('+tx+'px,'+(-18+Math.max(-260,Math.min(140,ty)))+'px) scale('+(1.05+Math.min(.05,-drag.pull/2000))+')';
      drag.card.classList.toggle('is-ready',drag.pull<=KEEP_AT);
      const over=slotAt(e.clientX,e.clientY,true),pile=over?null:pileAt(e.clientX,e.clientY);
      app.querySelectorAll('.fc-slot.is-target,.fc-pile.is-target').forEach(el=>{if(el!==over&&el!==pile)el.classList.remove('is-target');});
      (over||pile)?.classList.add('is-target');drag.slot=over?+over.dataset.slot:null;drag.pile=pile?pile.dataset.pile:null;
    }
  });
  const endDrag=e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const g=drag;drag=null;if(g.moved)e.preventDefault?.();
    if(g.axis!=='y')return;
    app.querySelectorAll('.fc-slot.is-target,.fc-pile.is-target').forEach(el=>el.classList.remove('is-target'));
    if(e.type==='pointerup'&&g.pile&&g.slot==null&&g.card.isConnected){A.fcVote(g.pile);if(g.card.isConnected){g.card.classList.remove('is-pulling','is-ready');g.card.style.transform='';}return;}
    if(e.type==='pointerup'&&(g.pull<=KEEP_AT||g.slot!=null)&&g.card.isConnected){pendingSlot=g.slot;A.fcVote('want');if(g.card.isConnected){g.card.classList.remove('is-pulling','is-ready');g.card.style.transform='';}return;}
    g.card.classList.remove('is-pulling','is-ready');g.card.style.transform='';
  };
  document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);

  function pileAt(x,y){
    for(const el of app.querySelectorAll('.fc-pile[data-pile]')){const r=el.getBoundingClientRect();if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)return el;}
    return null;
  }
  // Which slot is under the pointer (optionally only free ones), with a little slack.
  function slotAt(x,y,freeOnly){
    for(const el of app.querySelectorAll('.fc-slot[data-slot]')){
      if(freeOnly&&el.classList.contains('is-kept'))continue;
      const r=el.getBoundingClientRect();if(x>=r.left-8&&x<=r.right+8&&y>=r.top-8&&y<=r.bottom+8)return el;
    }
    return null;
  }
  // Rearranging: drag a kept place onto another slot to move it there (or swap).
  let chip=null,chipMovedAt=0;
  const chipMoved=()=>performance.now()-chipMovedAt<400;
  document.addEventListener('pointerdown',e=>{
    const el=e.target.closest?.('.fc-slot.is-kept,.fc-chip[data-pile-chip]');chipMovedAt=0;if(!el||e.button>0||(live()&&pd.busy))return;
    chip={el,id:el.dataset.a,from:el.dataset.slot!=null?+el.dataset.slot:null,pile:el.dataset.pileChip||'want',sx:e.clientX,sy:e.clientY,pid:e.pointerId,ghost:null};
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
    const over=slotAt(e.clientX,e.clientY,false),pile=over?null:pileAt(e.clientX,e.clientY);
    app.querySelectorAll('.fc-slot.is-target,.fc-pile.is-target').forEach(el=>{if(el!==over&&el!==pile)el.classList.remove('is-target');});
    if(over&&over!==chip.el)over.classList.add('is-target');else if(pile&&pile.dataset.pile!==chip.pile)pile.classList.add('is-target');
  });
  const chipEnd=e=>{
    if(!chip||chip.pid!==e.pointerId)return;
    const c=chip;chip=null;app.querySelectorAll('.fc-slot.is-target,.fc-pile.is-target').forEach(el=>el.classList.remove('is-target'));
    if(!c.ghost)return;
    chipMovedAt=performance.now();c.ghost.remove();c.el.classList.remove('is-lifted');
    const over=e.type==='pointerup'?slotAt(e.clientX,e.clientY,false):null,pile=e.type==='pointerup'&&!over?pileAt(e.clientX,e.clientY):null;
    // Between piles: Maybe → a day slot, a kept place → Maybe or Not this time, and so on.
    if(c.pile!=='want'){if(over&&!over.classList.contains('is-kept'))movePlace(c.id,'want',+over.dataset.slot);else if(pile&&pile.dataset.pile!==c.pile)movePlace(c.id,pile.dataset.pile);return;}
    if(!over&&pile&&pile.dataset.pile!=='want'){movePlace(c.id,pile.dataset.pile);return;}
    if(!over||over===c.el)return;
    const to=+over.dataset.slot,store=slotStore();slotModel();
    const other=store[to]||null;store[to]=c.id;store[c.from]=other;
    if(live())pd.fcArranged=true;
    freshId=c.id;render();
  };
  document.addEventListener('pointerup',chipEnd);document.addEventListener('pointercancel',chipEnd);
  // A drag is not a click: it must not put the place back.
  document.addEventListener('click',e=>{if(chipMoved()&&e.target.closest?.('.fc-slot,.fc-chip')){chipMovedAt=0;e.stopPropagation();e.preventDefault();}},true);
  let lastDragMoved=false;document.addEventListener('pointerup',e=>{lastDragMoved=!!drag?.moved;},true);
  document.addEventListener('click',e=>{if(e.target.closest?.('.fc-stage')&&lastDragMoved){lastDragMoved=false;e.stopPropagation();e.preventDefault();}},true);
  document.addEventListener('wheel',e=>{
    if(!e.target.closest?.('.fc-stage')||Math.abs(e.deltaX)<=Math.abs(e.deltaY))return;
    e.preventDefault();const now=Date.now();if(now-wheelAt>260)wheelSum=0;
    wheelSum+=e.deltaX;
    if(Math.abs(wheelSum)>60){wheelAt=now;A.fcStep(wheelSum>0?1:-1);wheelSum=0;}
  },{passive:false});

  // A redraw in the middle of a drag would replace the card or chip being dragged: hold it
  // until the pointer is released.
  let fcHeld=false;
  const fcRender=render;
  render=function(){if((drag&&drag.axis)||chip?.ghost){fcHeld=true;return;}return fcRender.apply(this,arguments);};
  const fcFlush=()=>{if(fcHeld&&!drag&&!chip){fcHeld=false;render();}};
  document.addEventListener('pointerup',()=>setTimeout(fcFlush,0));document.addEventListener('pointercancel',()=>setTimeout(fcFlush,0));
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
