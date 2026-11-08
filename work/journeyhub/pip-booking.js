/* Pip as the booking agent (desktop). Once "Create my trip" has saved the trip, Pip opens,
   says what can be booked and the total, and offers Pay now or Later. Paying uses the existing
   demo wallet (virtual credits): one server request books everything, while the card ticks the
   items off one by one. The Calendar then shows each reservation's real saved status. */
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const calm=window.matchMedia?.('(prefers-reduced-motion:reduce)');
  const STEP_MS=700;
  const pay={}; // historyId -> {phase:'paying'|'done', step, error}
  const laterKey=id=>'jh-book-later:'+(jhUser?.id||'guest')+':'+id;
  const isLater=id=>{try{return localStorage.getItem(laterKey(id))==='1';}catch{return false;}};
  const setLater=(id,on)=>{try{on?localStorage.setItem(laterKey(id),'1'):localStorage.removeItem(laterKey(id));}catch{}};

  // The trip on this page, once it has been created from the plan.
  function trip(){
    if(!wide?.matches||typeof pd==='undefined'||!pd.mode||pd.sample||!pd.plan||!pd.historyId||state.route!=='place-plan')return null;
    if(typeof tcFor!=='function'||!tcFor('history',pd.historyId))return null;
    if(typeof dw==='undefined'||!dw.owner||pd.owner!==dw.owner)return null;
    return {sourceType:'history',sourceId:pd.historyId};
  }
  const recordOf=src=>dw.quotes[dwKey(src.sourceType,src.sourceId)];
  const chargeable=item=>!item.bookingId&&!['free','unavailable'].includes(item.kind)&&Number(item.totalMinor)>0;
  const isBooked=q=>q&&(q.status==='booked'||(q.items.some(i=>i.bookingId)&&!q.items.some(chargeable)));
  function ensureLoaded(src){
    // The page may skip a redraw when only Pip's card changed, so refresh Pip directly.
    const refresh=()=>window.jhPipSync?.();
    if(!dw.loaded&&!dw.loading)dwLoad().then(refresh,refresh);
    if(!recordOf(src))dwQuote(src).then(refresh,refresh);
  }

  function rowHTML(item,src,i,p,booked){
    const name=dwItemName(item,src),when=[item.date&&(typeof agDate==='function'?agDate(item.date):item.date),item.start].filter(Boolean).join(' · ');
    let cls='',mark='',amount=chargeable(item)?dwMoney(item.totalMinor):item.bookingId?'Reserved':item.kind==='free'?'Free':'Check venue';
    if(booked){cls='is-done';mark=chargeable(item)||item.bookingId?'✓':'–';}
    else if(p?.phase==='paying'){cls=i<p.step?'is-done':i===p.step?'is-now':'is-wait';mark=i<p.step?(chargeable(item)?'✓':'–'):i===p.step?'<i class="pb-spin"></i>':'';}
    return '<li class="pb-row '+cls+'" data-charge="'+(chargeable(item)||item.bookingId?1:0)+'"><span class="pb-mark">'+mark+'</span><span class="pb-what"><strong>'+esc(name)+'</strong><small>'+esc([dwKinds[item.kind]?.replace(/^Demo /,'')||'Visit',when].filter(Boolean).join(' · '))+'</small></span><b>'+esc(amount)+'</b></li>';
  }
  function cardHTML(){
    const src=trip();if(!src)return '';
    ensureLoaded(src);
    const record=recordOf(src),quote=record?.quote,p=pay[src.sourceId];
    if(!record||record.loading)return '<div class="pip-card pb-card"><div class="pip-card-body"><strong>🎟️ Preparing your bookings…</strong><div class="pip-bar is-indet"><i></i></div><small>Checking tickets, tables and the total for your group.</small></div></div>';
    if(record.error&&p?.phase!=='paying')return '<div class="pip-card pb-card"><div class="pip-card-body"><strong>Bookings couldn’t load</strong><small>'+esc(record.error)+'</small><div class="pb-actions"><button type="button" class="pb-pay" data-act="pbRetry">Try again</button></div></div></div>';
    if(!quote)return '';
    const booked=isBooked(quote)||p?.phase==='done',items=quote.items,payable=items.filter(chargeable),total=booked&&p?.paid!=null?p.paid:quote.totalMinor;
    const balance=dw.wallet?.balanceMinor,short=balance==null?0:Math.max(0,quote.totalMinor-balance);
    if(!booked&&!payable.length)return '<div class="pip-card pb-card"><div class="pip-card-body"><strong>Nothing to pay in advance</strong><small>These places are free or booked at the venue. Your trip is in the Calendar.</small></div></div>';
    if(!booked&&isLater(src.sourceId)&&p?.phase!=='paying')
      return '<div class="pip-card pb-card is-later"><div class="pip-card-body"><strong>🕘 Booking saved for later</strong><small>'+payable.length+' item'+(payable.length===1?'':'s')+' · '+dwMoney(quote.totalMinor)+'. Pay whenever you’re ready.</small><div class="pb-actions"><button type="button" class="pb-pay" data-act="pbPay">💳 Pay '+dwMoney(quote.totalMinor)+' now</button></div></div></div>';
    const progress=p?.phase==='paying'?Math.round(Math.min(p.step,items.length)/items.length*100):booked?100:0;
    const head=booked?'<strong class="pb-title is-ok">✅ All booked</strong><small>'+dwMoney(total)+' paid with demo credits · saved to your Calendar</small>'
      :p?.phase==='paying'?'<strong class="pb-title">💳 Paying…</strong><small class="pb-sub">Booking '+Math.min(p.step+1,items.length)+' of '+items.length+'</small>'
      :'<strong class="pb-title">🎟️ Ready to book</strong><small>'+payable.length+' to pay in advance for your group</small>';
    let foot='';
    if(booked)foot='<div class="pb-actions"><button type="button" class="pb-pay" data-act="pbCalendar">📅 See it in Calendar</button></div>';
    else if(p?.phase!=='paying'){
      foot='<div class="pb-total"><span>Total</span><b>'+dwMoney(quote.totalMinor)+'</b></div><div class="pb-wallet"><span>Demo wallet</span><span>'+(balance==null?'—':dwMoney(balance))+'</span></div>'+
        (short>0?'<p class="pb-note">'+dwMoney(topupFor(short)||short)+' in demo credits will be added first.</p>':'')+
        (p?.error?'<p class="pb-error" role="alert">'+esc(p.error)+'</p>':'')+
        '<div class="pb-actions"><button type="button" class="pb-pay" data-act="pbPay"'+(balance==null?' disabled':'')+'>💳 Pay '+dwMoney(quote.totalMinor)+' now</button><button type="button" class="pb-later" data-act="pbLater">Later</button></div>';
    }
    return '<div class="pip-card pb-card'+(booked?' is-booked':'')+(p?.phase==='paying'?' is-paying':'')+'"><div class="pip-card-body">'+head+
      '<div class="pip-bar pb-bar"><i style="width:'+progress+'%"></i></div><ol class="pb-list">'+items.map((item,i)=>rowHTML(item,src,i,p,booked)).join('')+'</ol>'+foot+
      '<p class="pb-demo">Demo only · virtual credits, no real payment or tickets.</p></div></div>';
  }
  // Each payment step updates the card in place: redrawing it would jump the list back to the
  // top and replay every finished tick, which looks like the card keeps refreshing.
  function paint(p,count){
    const card=document.querySelector('.pb-card.is-paying');if(!card){window.jhPipSync?.();return;}
    card.querySelectorAll('.pb-row').forEach((row,i)=>{
      const next=i<p.step?'is-done':i===p.step?'is-now':'is-wait';if(row.classList.contains(next))return;
      row.classList.remove('is-done','is-now','is-wait');row.classList.add(next);if(next==='is-done')row.classList.add('is-just');
      row.querySelector('.pb-mark').innerHTML=next==='is-done'?(row.dataset.charge==='1'?'✓':'–'):next==='is-now'?'<i class="pb-spin"></i>':'';
    });
    const bar=card.querySelector('.pb-bar i');if(bar)bar.style.width=Math.round(Math.min(p.step,count)/count*100)+'%';
    const sub=card.querySelector('.pb-sub');if(sub)sub.textContent='Booking '+Math.min(p.step+1,count)+' of '+count;
    follow();
  }
  // Keep the item being paid in view inside the card's list.
  function follow(){const row=document.querySelector('.pb-list .pb-row.is-now'),list=row?.parentElement;if(!row||!list)return;
    const top=row.offsetTop-list.offsetTop,bottom=top+row.offsetHeight;
    if(top<list.scrollTop||bottom>list.scrollTop+list.clientHeight)list.scrollTo({top:Math.max(0,top-list.clientHeight/2+row.offsetHeight/2),behavior:calm?.matches?'auto':'smooth'});}
  const topupFor=short=>[10000,50000,100000].find(a=>a>=short)||null;

  window.jhPipBookingCard=()=>{
    const html=cardHTML(),src=trip();
    if(src){
      // Right after the trip is created: open Pip and tell the traveler what can be booked.
      const quote=recordOf(src)?.quote;
      if(quote&&!isBooked(quote)&&quote.items.some(chargeable)&&!isLater(src.sourceId)){
        const n=quote.items.filter(chargeable).length;
        // Called while Pip is drawing, so speak on the next tick.
        setTimeout(()=>{if(window.jhPipOnce?.('booking:'+src.sourceId,'Your trip is created 🎒 I can book **'+n+' item'+(n===1?'':'s')+'** for you — **'+dwMoney(quote.totalMinor)+'** in total. Pay now, or later from here or the Calendar.'))window.jhPipOpen?.();},0);
      }
    }
    return html;
  };
  window.jhPipBookingChips=()=>{
    const src=trip();if(!src)return null;
    // The booking card carries Pay / Later / Calendar itself, so only the timetable stays here.
    return '<button type="button" class="pip-chip" data-act="tuTab" data-a="itinerary">🗓️ Open the timetable</button>';
  };

  A.pbRetry=()=>{const src=trip();if(src)dwQuote(src,true).then(()=>window.jhPipSync?.());};
  A.pbLater=()=>{const src=trip();if(!src)return;setLater(src.sourceId,true);
    window.jhPipSay?.('No problem 👍 Your trip is saved. When you’re ready, pay from here or from the trip in your **Calendar**.',{kind:'react'});render();window.jhPipSync?.();};
  A.pbCalendar=()=>{const src=trip(),q=src&&recordOf(src)?.quote,date=q?.items?.find(i=>i.date)?.date||pd.plan?.date||pd.input?.date;go('orders');if(date&&typeof calSelect==='function')calSelect(date);};
  A.pbPay=async()=>{
    const src=trip();if(!src||dw.busy)return;
    const id=src.sourceId,record=recordOf(src),quote=record?.quote;if(!quote||isBooked(quote))return;
    if(pay[id]?.phase==='paying')return;
    setLater(id,false);
    const short=Math.max(0,quote.totalMinor-(dw.wallet?.balanceMinor??0));
    pay[id]={phase:'paying',step:0,error:''};window.jhPipSync?.();
    const fail=message=>{pay[id]={phase:null,step:0,error:message};render();window.jhPipSync?.();};
    if(short>0){
      const amount=topupFor(short);if(!amount)return fail('This trip costs more than one demo top-up. Put a few places back, or book from the Calendar.');
      await A.dwTopup(amount);if(dw.error)return fail(dw.error);
    }
    // One request books everything; the card ticks items off at a readable pace meanwhile.
    const items=quote.items.length,request=A.dwBook('history',id);
    const ticker=new Promise(resolve=>{
      if(calm?.matches){pay[id].step=items;resolve();return;}
      const tick=()=>{const p=pay[id];if(!p||p.phase!=='paying')return resolve();
        if(p.step<items-1){p.step++;paint(p,items);setTimeout(tick,STEP_MS);}else resolve();};
      setTimeout(tick,STEP_MS);
    });
    await Promise.all([request,ticker]);
    if(record.error||recordOf(src)?.quote?.status!=='booked')return fail(record.error||'The booking didn’t complete. Check the Calendar before trying again.');
    pay[id].step=items;paint(pay[id],items);
    await new Promise(r=>setTimeout(r,calm?.matches?0:450));
    pay[id]={phase:'done',step:items,paid:quote.totalMinor};
    const reserved=(recordOf(src).receipts||[]).filter(dwPaid).length;
    window.jhPipOnce?.('paid:'+id,'Paid ✅ **'+dwMoney(quote.totalMinor)+'** in demo credits — '+reserved+' reservation'+(reserved===1?'':'s')+' confirmed. Your Calendar now shows each one with its booking status.');
    render();window.jhPipSync?.();
  };

  // With Pip as the booking agent, the page's own booking-agent invite would say the same thing twice.
  const pbPlan=V['place-plan'];
  V['place-plan']=function(){
    const view=pbPlan.apply(this,arguments);
    if(trip()&&typeof window.jhPipShowing==='function'&&window.jhPipShowing()&&view?.body?.includes('dw-agent-invite')){
      const t=document.createElement('template');t.innerHTML=view.body;t.content.querySelectorAll('.dw-agent-invite').forEach(el=>el.remove());view.body=t.innerHTML;
    }
    return view;
  };
})();
