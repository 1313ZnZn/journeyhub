/* Itinerary page on wide screens.
   - Itinerary tab: a timeline with one column per day and time running down. Visits can be
     dragged to another time slot or day, or removed. Times, the map and the estimate update at
     once from a local reflow that mirrors the server (same visit lengths and transfer estimate).
   - Confirm changes sends the edit once to the existing revision preview and apply actions,
     which re-check real routes and save it. Overview keeps the saved plan until then.
   - A checkout bar at the bottom carries the estimate and the main action: Save trip,
     Confirm changes, or Create trip (start trip support). The demo booking agent panel is removed.
   Phones keep the existing page. */
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const PX=1.1; // pixels per minute
  let tl={original:null,draft:null,order:null,historyId:null};

  const mins=t=>/^\d{2}:\d{2}$/.test(t||'')?Number(t.slice(0,2))*60+Number(t.slice(3)):NaN;
  const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  const window_=()=>({start:mins(pd.input?.dayStart)||540,end:mins(pd.input?.dayEnd)||1260});
  // Same approximation as the server's estimateTravel, so the preview matches what it will check.
  function travelMinutes(a,b,mode){
    if(![a?.lat,a?.lng,b?.lat,b?.lng].every(Number.isFinite))return 30;
    const rad=n=>n*Math.PI/180,dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng);
    const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
    const km=6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)))*1.3;
    return Math.max(15,Math.ceil((km/(mode==='walk'?4.5:25)*60+10)/5)*5);
  }
  const editable=()=>!!(pd.plan&&pd.historyId&&!pd.sample&&pd.owner===(jhUser?.id||null));
  function reset(){tl={original:null,draft:null,order:null,historyId:null};}
  const dirty=()=>!!(tl.draft&&pd.plan===tl.draft);

  // Rebuild the draft plan from an ordered list of {id,dayIndex}.
  function reflow(order,base=tl.original){
    const w=window_(),mode=base.transport||pd.input?.transport||'drive',byId=new Map(base.stops.map(s=>[s.id,s]));
    const stops=[],overflow=new Set();
    for(let day=1;day<=base.days;day++){
      let prev=null,cursor=w.start;
      for(const row of order.filter(r=>r.dayIndex===day)){
        const s=byId.get(row.id),length=Math.min(240,Math.max(30,mins(s.end)-mins(s.start)||60));
        const gap=prev?travelMinutes(prev,s,mode):0,start=prev?cursor+gap:w.start,end=start+length;
        if(end>w.end)overflow.add(day);
        stops.push({...s,dayIndex:day,start:clock(start),end:clock(Math.min(end,1439)),travel:prev?{durationMinutes:gap,mode,estimated:true,source:'Estimate'}:null,travelConflict:false});
        prev=s;cursor=end;
      }
    }
    // Saved road shapes stay only for days whose order is unchanged.
    const sameDay=day=>JSON.stringify(base.stops.filter(s=>s.dayIndex===day).map(s=>s.id))===JSON.stringify(stops.filter(s=>s.dayIndex===day).map(s=>s.id));
    const roadRoutes=Array.from({length:base.days},(_,i)=>i+1).map(day=>sameDay(day)?(base.roadRoutes||[]).find(r=>r.day===day)||{day,status:'pending',legs:[]}:{day,status:'pending',legs:[]});
    let estimate=base.estimate;
    if(estimate?.items){
      const items=estimate.items.filter(i=>stops.some(s=>s.id===i.stopId)),known=items.filter(i=>Number.isFinite(i.totalMinor));
      const totalMinor=known.reduce((n,i)=>n+i.totalMinor,0),incomplete=items.some(i=>i.kind==='unavailable');
      estimate={...estimate,items,totalMinor,incomplete,budgetExceeded:Number.isFinite(estimate.budgetCnyMinor)?totalMinor>estimate.budgetCnyMinor:estimate.budgetExceeded};
    }
    return {plan:{...base,stops,roadRoutes,estimate,tlDraft:true},overflow};
  }
  function apply(order){
    if(!tl.original){tl.original=pd.plan;tl.historyId=pd.historyId;}
    const same=JSON.stringify(order)===JSON.stringify(tl.original.stops.map(s=>({id:s.id,dayIndex:s.dayIndex})));
    if(same){pd.plan=tl.original;reset();render();return;}
    const {plan,overflow}=reflow(order);tl.order=order;tl.draft=plan;tl.overflow=overflow;pd.plan=plan;pd.mapStop=null;
    if(typeof pe!=='undefined'&&pe&&!pe.busy)pe=null;
    render();
  }
  const currentOrder=()=>pd.plan.stops.map(s=>({id:s.id,dayIndex:s.dayIndex}));

  A.tlRemove=id=>{
    if(!editable())return;const order=currentOrder(),row=order.find(r=>r.id===id);if(!row)return;
    if(order.filter(r=>r.dayIndex===row.dayIndex).length<=1){toast('Keep at least one place on every day. Move another place here first.');return;}
    apply(order.filter(r=>r.id!==id));
  };
  function move(id,day,index){
    if(!editable())return;const order=currentOrder(),row=order.find(r=>r.id===id);if(!row)return;
    if(row.dayIndex!==day&&order.filter(r=>r.dayIndex===row.dayIndex).length<=1){toast('Keep at least one place on every day.');render();return;}
    const rest=order.filter(r=>r.id!==id),target=rest.filter(r=>r.dayIndex===day);
    const before=target[Math.min(index,target.length)]?.id;
    const next={id,dayIndex:day};
    if(before){rest.splice(rest.findIndex(r=>r.id===before),0,next);}
    else{const lastOfDay=rest.map(r=>r.dayIndex).lastIndexOf(day);rest.splice(lastOfDay<0?rest.filter(r=>r.dayIndex<day).length:lastOfDay+1,0,next);}
    // Keep the order grouped by day so the server receives a clean sequence.
    rest.sort((a,b)=>a.dayIndex-b.dayIndex);
    apply(rest);
  }
  A.tlDiscard=()=>{if(!tl.original)return;if(typeof pe!=='undefined'&&pe?.busy)return;pd.plan=tl.original;reset();if(typeof pe!=='undefined')pe=null;render();};
  A.tlConfirm=async()=>{
    if(!dirty()||tl.overflow?.size||typeof pe==='undefined'||pe?.busy)return;
    pe={discovery:pd,historyId:pd.historyId,basePlan:pd.plan,input:peInput(jpNormalize({...pd.input,...tl.original,prompt:pd.input?.prompt||''})),stops:tl.order.map(r=>({...r})),preferencesOpen:false,preview:null,revisionToken:null,busy:false,error:'',requestId:null,applyRequestId:null};
    await A.pePreview();
    if(pe?.preview&&pe.revisionToken)await A.peApply();
  };

  // Press and drag a visit. The lifted visit follows the pointer every frame; the other
  // visits slide to where they would be in the new order; on release it settles into
  // its slot and the order is applied.
  let drag=null;
  const SNAP_MS=200;
  const slotTop=s=>(mins(s.start)-window_().start)*PX;
  const slotHeight=s=>Math.max(30,(mins(s.end)-mins(s.start))*PX);
  function proposal(g,x,centreY){
    const base=g.order.filter(r=>r.id!==g.id);
    let col=g.cols.find(c=>{const r=c.el.getBoundingClientRect();return x>=r.left-6&&x<=r.right+6;})||g.cols.find(c=>c.day===g.day);
    // The last visit of a day cannot leave it; every day keeps at least one place.
    if(col.day!==g.day&&!base.some(r=>r.dayIndex===g.day))col=g.cols.find(c=>c.day===g.day);
    // Thresholds come from the order without the dragged visit, so they do not move as others make room.
    const without=reflow(base,g.base).plan.stops.filter(st=>st.dayIndex===col.day);
    const y=centreY-col.el.getBoundingClientRect().top;
    const index=without.filter(st=>slotTop(st)+slotHeight(st)/2<y).length;
    const target=base.filter(r=>r.dayIndex===col.day),before=target[index]?.id,order=base.slice(),row={id:g.id,dayIndex:col.day};
    if(before)order.splice(order.findIndex(r=>r.id===before),0,row);
    else{const last=order.map(r=>r.dayIndex).lastIndexOf(col.day);order.splice(last<0?order.filter(r=>r.dayIndex<col.day).length:last+1,0,row);}
    order.sort((a,b)=>a.dayIndex-b.dayIndex);
    return {order,col,layout:reflow(order,g.base).plan};
  }
  function paint(){
    const g=drag;if(!g)return;g.frame=0;
    const sc=g.scroller,scroll=(sc?.scrollTop||0)-g.scroll0;
    const dx=g.px-g.x,dy=g.py-g.y+scroll;
    g.block.style.transform='translate3d('+dx+'px,'+dy+'px,0) scale(1.04)';
    const centre=g.rect.top+dy+g.rect.height/2;
    const next=proposal(g,g.px,centre),key=JSON.stringify(next.order);
    if(key===g.key)return;
    g.key=key;g.next=next;
    // Every other visit slides to its place in the proposed order.
    for(const st of next.layout.stops){if(st.id===g.id)continue;const el=g.blocks.get(st.id);if(!el)continue;const home=el.closest('.tl-col').dataset.day;
      if(String(st.dayIndex)===home){el.style.top=slotTop(st)+'px';el.style.height=slotHeight(st)+'px';const t=el.querySelector('.tl-text small');if(t)t.textContent=st.start+'–'+st.end;}}
    g.cols.forEach(c=>c.el.classList.toggle('is-target',c===next.col));
  }
  document.addEventListener('pointerdown',e=>{
    const block=e.target.closest?.('.tl-block');if(!block||e.button>0||e.target.closest('button')||!editable()||(typeof pe!=='undefined'&&pe?.busy)||drag)return;
    const scroller=app.querySelector(':scope>.screen'),day=Number(block.closest('.tl-col').dataset.day);
    drag={id:block.dataset.id,block,day,x:e.clientX,y:e.clientY,px:e.clientX,py:e.clientY,pointer:e.pointerId,started:false,scroller,scroll0:scroller?.scrollTop||0,
      base:tl.original||pd.plan,order:currentOrder(),rect:block.getBoundingClientRect(),
      cols:[...document.querySelectorAll('.tl-col')].map(c=>({el:c.querySelector('.tl-col-body'),day:Number(c.dataset.day)})),
      blocks:new Map([...document.querySelectorAll('.tl-block')].map(b=>[b.dataset.id,b]))};
  });
  document.addEventListener('pointermove',e=>{
    const g=drag;if(!g||g.pointer!==e.pointerId)return;
    g.px=e.clientX;g.py=e.clientY;
    if(!g.started){
      if(Math.hypot(e.clientX-g.x,e.clientY-g.y)<4)return;
      g.started=true;g.block.classList.add('is-lifted');document.querySelector('.tl')?.classList.add('is-sorting');
      try{g.block.setPointerCapture(e.pointerId);}catch{}
    }
    e.preventDefault();
    // Near the top or bottom edge the page scrolls, so a visit can travel the whole day.
    const sc=g.scroller;if(sc){const r=sc.getBoundingClientRect();if(e.clientY>r.bottom-70)sc.scrollTop+=14;else if(e.clientY<r.top+70)sc.scrollTop-=14;}
    if(!g.frame)g.frame=requestAnimationFrame(paint);
  });
  function finish(g,commit){
    cancelAnimationFrame(g.frame);g.frame=0;
    g.cols.forEach(c=>c.el.classList.remove('is-target'));
    const next=commit&&g.next&&JSON.stringify(g.next.order)!==JSON.stringify(g.order)?g.next:null;
    // Settle into the slot: the new one, or back where it was.
    const slot=next?next.layout.stops.find(st=>st.id===g.id):pd.plan.stops.find(st=>st.id===g.id);
    const body=(next?next.col.el:g.cols.find(c=>c.day===g.day).el).getBoundingClientRect(),scroll=(g.scroller?.scrollTop||0)-g.scroll0;
    g.block.classList.add('is-settling');
    g.block.style.transform='translate3d('+(body.left+4-g.rect.left)+'px,'+(body.top+slotTop(slot)-g.rect.top+scroll)+'px,0) scale(1)';
    g.block.style.height=slotHeight(slot)+'px';
    const done=()=>{if(drag!==g)return;drag=null;document.querySelector('.tl')?.classList.remove('is-sorting');
      if(next)apply(next.order);else{g.block.classList.remove('is-lifted','is-settling');g.block.style.transform='';render();}};
    setTimeout(done,SNAP_MS);
  }
  const endDrag=e=>{
    const g=drag;if(!g||g.pointer!==e.pointerId||g.ending)return;
    if(!g.started){drag=null;return;}
    g.ending=true;if(g.frame){cancelAnimationFrame(g.frame);paint();}
    finish(g,e.type==='pointerup');
  };
  document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);
  // Background refreshes wait until the visit is dropped, so a drag is never cut short.
  const tlRender=render;
  render=function(){if(drag?.started){drag.pendingRender=true;return;}return tlRender.apply(this,arguments);};
  // Keyboard: arrows move a focused visit, Delete removes it.
  document.addEventListener('keydown',e=>{
    const block=e.target.closest?.('.tl-block');if(!block||e.target!==block||!editable())return;
    const id=block.dataset.id,order=currentOrder(),row=order.find(r=>r.id===id);if(!row)return;
    const sameDay=order.filter(r=>r.dayIndex===row.dayIndex),i=sameDay.findIndex(r=>r.id===id);
    if(e.key==='ArrowUp'&&i>0){e.preventDefault();move(id,row.dayIndex,i-1);}
    else if(e.key==='ArrowDown'&&i<sameDay.length-1){e.preventDefault();move(id,row.dayIndex,i+1);}
    else if((e.key==='ArrowLeft'||e.key==='ArrowRight')){const d=row.dayIndex+(e.key==='ArrowRight'?1:-1);if(d>=1&&d<=pd.plan.days){e.preventDefault();move(id,d,99);}}
    else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();A.tlRemove(id);}
    else return;
    requestAnimationFrame(()=>document.querySelector('.tl-block[data-id="'+CSS.escape(id)+'"]')?.focus({preventScroll:true}));
  });

  function timelineHTML(plan){
    const w=window_(),days=Array.from({length:plan.days},(_,i)=>i+1),height=(w.end-w.start)*PX,can=editable();
    const hours=[];for(let m=Math.ceil(w.start/60)*60;m<=w.end;m+=60)hours.push(m);
    const axis='<div class="tl-axis" style="height:'+height+'px">'+hours.map(m=>'<span style="top:'+((m-w.start)*PX)+'px">'+clock(m)+'</span>').join('')+'</div>';
    const cols=days.map(day=>{
      const date=new Date(Date.parse(plan.date+'T12:00:00Z')+(day-1)*86400000).toISOString().slice(0,10),stops=plan.stops.filter(s=>s.dayIndex===day),late=tl.overflow?.has(day)&&dirty();
      return '<div class="tl-col'+(late?' is-late':'')+'" data-day="'+day+'" style="--day:'+pmColors[day-1]+'"><div class="tl-col-head"><strong>Day '+day+'</strong><small>'+esc(agDate(date))+'</small></div><div class="tl-col-body" style="height:'+height+'px">'+
        hours.map(m=>'<i style="top:'+((m-w.start)*PX)+'px"></i>').join('')+
        stops.map((s,i)=>{const top=(mins(s.start)-w.start)*PX,h=Math.max(30,(mins(s.end)-mins(s.start))*PX);
          const prevEnd=i?(mins(stops[i-1].end)-w.start)*PX:null;
          return (prevEnd!==null&&top>prevEnd?'<span class="tl-gap" style="top:'+prevEnd+'px;height:'+(top-prevEnd)+'px" aria-hidden="true"><em>'+(s.travel?.durationMinutes?s.travel.durationMinutes+' min':'')+'</em></span>':'')+
          '<div class="tl-block" data-id="'+esc(s.id)+'" tabindex="'+(can?0:-1)+'" role="group" aria-label="Day '+day+', '+esc(s.start)+' to '+esc(s.end)+', '+esc(s.name)+(can?'. Drag, or use arrow keys to move. Delete to remove.':'')+'" style="top:'+top+'px;height:'+h+'px">'+
          '<span class="tl-num">'+(i+1)+'</span><span class="tl-text"><b>'+esc(s.name)+'</b><small>'+esc(s.start)+'–'+esc(s.end)+'</small></span>'+
          (can?'<button type="button" class="tl-del" data-act="tlRemove" data-a="'+esc(s.id)+'" aria-label="Remove '+esc(s.name)+'">'+ic('x',12)+'</button>':'')+'</div>';}).join('')+
        (late?'<span class="tl-late" style="top:'+height+'px">Runs past '+esc(pd.input?.dayEnd||'21:00')+'</span>':'')+'</div></div>';
    }).join('');
    const note=!can?'Save this trip to edit it.':dirty()?'Unsaved changes. Times are estimates until you confirm.':'Drag a visit to change the order or move it to another day. Use × to remove it.';
    return '<section class="tl" aria-label="Itinerary timeline"><p class="tl-note">'+ic('sliders',15)+'<span>'+esc(note)+'</span>'+(dirty()?'<button type="button" class="btn-text" data-act="tlDiscard">Discard changes</button>':'')+'</p><div class="tl-grid" style="--days:'+plan.days+'">'+axis+cols+'</div></section>';
  }
  function careActive(){return typeof tc!=='undefined'&&tc.trips?.some(t=>t.sourceType==='history'&&t.sourceId===pd.historyId&&['active','paused'].includes(t.status));}
  function barHTML(){
    const plan=pd.plan,e=plan?.estimate,money=n=>typeof peMoney==='function'?peMoney(n):'CNY '+(n/100).toFixed(2);
    const was=dirty()&&Number.isFinite(tl.original?.estimate?.totalMinor)&&tl.original.estimate.totalMinor!==e?.totalMinor?'<s>'+money(tl.original.estimate.totalMinor)+'</s>':'';
    const amount=e?.currency==='CNY'&&Number.isFinite(e.totalMinor)?'<strong>'+money(e.totalMinor)+'</strong>'+was:'<strong>—</strong>';
    const budget=Number.isFinite(e?.budgetCnyMinor)?'<small class="'+(e.budgetExceeded?'is-over':'')+'">Group budget '+money(e.budgetCnyMinor)+(e.budgetExceeded?' · Over budget':'')+'</small>':'';
    const busy=typeof pe!=='undefined'&&pe?.busy,late=dirty()&&tl.overflow?.size;
    let action;
    if(!pd.historyId)action='<button class="dx-checkout-go" data-act="thSave">Save trip</button>';
    else if(busy)action='<button class="dx-checkout-go" disabled>'+(pe.phase==='apply'?'Saving changes…':'Checking routes…')+'</button>';
    else if(dirty())action='<button class="dx-checkout-go" data-act="tlConfirm"'+(late?' disabled':'')+'>'+ic('check',18)+'Confirm changes</button>';
    else if(careActive())action='<button class="dx-checkout-go is-done" disabled>'+ic('check',18)+'Trip created</button>';
    else if(typeof tc!=='undefined'&&tc.busy)action='<button class="dx-checkout-go" disabled>Creating trip…</button>';
    else action='<button class="dx-checkout-go" data-act="tcConfirm"'+(pd.busy||pd.sample?' disabled':'')+'>'+ic('sparkle',18)+'Create trip</button>';
    const status=late?'<span class="dx-checkout-warn">Day '+[...tl.overflow].join(', ')+' runs past '+esc(pd.input?.dayEnd||'21:00')+'. Remove or move a visit.</span>':(typeof pe!=='undefined'&&pe?.error)?'<span class="dx-checkout-warn" role="alert">'+esc(pe.error)+'</span>':dirty()?'<span>Unsaved changes · <button class="btn-text" data-act="tlDiscard">Discard</button></span>':'';
    const care=typeof tcError==='function'?tcError():'';
    return '<div class="dx-checkout" role="region" aria-label="Trip total"><div class="dx-checkout-sum"><span>Activities & dining estimate</span>'+amount+'<small>Entire group · demo prices · excludes transport and lodging'+(e?.incomplete?' · some prices unavailable':'')+'</small>'+budget+'</div><div class="dx-checkout-status">'+status+care+'</div>'+action+'</div>';
  }

  const tlPlanView=V['place-plan'];
  V['place-plan']=function(){
    if(!wide?.matches||!pd.plan)return tlPlanView.apply(this,arguments);
    // A replaced plan (saved revision, reload or another trip) ends the local edit.
    if(tl.draft&&(pd.plan!==tl.draft||pd.historyId!==tl.historyId))reset();
    const draft=dirty()?pd.plan:null;
    // Overview shows the saved plan until changes are confirmed.
    if(draft)pd.plan=tl.original;
    let view;try{view=tlPlanView.apply(this,arguments);}finally{if(draft)pd.plan=draft;}
    if(!view?.body)return view;
    const t=document.createElement('template');t.innerHTML=view.body;const root=t.content.querySelector('.tu-trip');if(!root)return view;
    t.content.querySelectorAll('.dw-agent-invite,.tc-confirm,.pe-estimate').forEach(el=>el.remove());
    t.content.querySelector('.tu-sheet-scroll')?.insertAdjacentHTML('afterbegin',timelineHTML(pd.plan));
    root.insertAdjacentHTML('beforeend',barHTML());
    if(draft)root.classList.add('tl-editing');
    view.body=t.innerHTML;
    const after=view.after;
    view.after=function(){after?.apply(this,arguments);if(draft&&typeof pmMount==='function')pmMount(draft);};
    return view;
  };
  wide?.addEventListener?.('change',()=>{if(dirty()){pd.plan=tl.original;reset();}});
})();
