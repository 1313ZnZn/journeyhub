/* When a trip cannot be planned from the chosen places, the card screen explains why and
   offers the fixes that apply: raise the budget, give the days more time, or put a few
   places back. Choosing a budget or time change plans the trip again straight away.
   Desktop only; phones keep the existing message and "Edit trip preferences" button. */
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const money=(minor,currency='CNY')=>currency+' '+(Math.round(minor)/100).toLocaleString('en-US',{maximumFractionDigits:0});
  const hhmm=t=>{const [h,m]=String(t||'').split(':').map(Number);return h*60+(m||0);};

  // Planning requests carry the chosen fix and, once arranged, the tray's day placement.
  const pfRequest=pdRequest;
  pdRequest=function(payload,discovery,timeoutMs){
    if(payload?.action==='discover_plan'&&discovery===pd){
      const dayPlan=typeof window.jhFanDayPlan==='function'?window.jhFanDayPlan():null;
      payload={...payload,...(pd.planAdjust?{adjust:pd.planAdjust}:{}),...(dayPlan?{dayPlan}:{})};
    }
    return pfRequest.call(this,payload,discovery,timeoutMs);
  };

  // What went wrong, from the planner's structured reason or, for older replies, its message.
  function issue(){
    const task=pd.plannerTask||(typeof ptu!=='undefined'?ptu.task:null),error=task?.error||{},d=error.details||{};
    const text=String(pd.error||error.message||'');
    let reason=d.reason;
    if(!reason){
      if(/exceed the group budget/i.test(text))reason='over_budget';
      else if(/prices could not be estimated/i.test(text))reason='price_unknown';
      else if(/is closed at the planned time/i.test(text))reason='closed';
      else if(/missing location details/i.test(text))reason='details';
      else if(/Not enough time|could not be fitted|longer daily hours|fewer must-visit/i.test(text))reason='time';
      else reason='other';
    }
    const input={...(pd.input||{}),...d};
    let ids=Array.isArray(d.placeIds)?d.placeIds.filter(id=>pd.wanted.includes(id)):[];
    if(!ids.length&&reason==='closed'){const name=(text.match(/^(.+?) is closed at the planned time/)||[])[1];const p=name&&pd.places.find(x=>x.name===name);if(p)ids=[p.id];}
    return {reason,text,input,ids,budget:d.budgetCnyMinor??input.budgetCnyMinor??null,subtotal:d.subtotalCnyMinor??null};
  }
  const nameOf=id=>pd.places.find(p=>p.id===id)?.name||'This place';

  function option(act,a,icon,title,desc,primary){
    return '<button type="button" class="pf-option'+(primary?' is-primary':'')+'" data-act="'+act+'"'+(a!=null?' data-a="'+esc(String(a))+'"':'')+'><span class="pf-option-ic">'+ic(icon,18)+'</span><span><strong>'+esc(title)+'</strong><small>'+esc(desc)+'</small></span>'+ic('right',16)+'</button>';
  }
  function dialogHTML(inline=false){
    const x=issue(),days=Number(x.input.days)||1,end=x.input.dayEnd||'21:00',opts=[];let title,lead,facts='';
    const removeOpt=primary=>option('pfRemove',null,'minus','Put a few places back','Choose which places to drop in your picks, then press Done.',primary);
    if(x.reason==='over_budget'){
      title='Your picks go over your budget';
      lead='The estimated cost of your must-visit places is more than the budget you set.';
      if(x.subtotal!=null&&x.budget!=null)facts='<div class="pf-facts"><span><small>Estimated</small><b>'+money(x.subtotal)+'</b></span><span><small>Your budget</small><b>'+money(x.budget)+'</b></span></div>';
      const suggest=x.subtotal!=null?Math.ceil(x.subtotal*1.1/1000)*10:x.budget!=null?Math.ceil(x.budget*1.5/1000)*10:null;
      opts.push('<form class="pf-budget" data-pf-budget><label for="pf-budget-amount"><strong>Raise the budget</strong><small>Group total for the whole trip</small></label><div class="pf-budget-row"><span>CNY</span><input id="pf-budget-amount" type="number" min="1" max="1000000" step="1" inputmode="numeric" value="'+(suggest||'')+'" required><button type="submit" class="pf-go">'+ic('check',16)+'Plan with this budget</button></div><button type="button" class="pf-link" data-act="pfNoBudget">Plan without a budget limit</button></form>');
      opts.push(removeOpt(false));
    }else if(x.reason==='price_unknown'){
      title='Some prices can’t be estimated';
      lead='A budget check needs a price for every must-visit place, and some don’t list one.';
      opts.push(option('pfNoBudget',null,'wallet','Plan without a budget limit','Keep every place; prices are shown where known.',true));
      for(const id of x.ids.slice(0,2))opts.push(option('pfRemoveOne',id,'minus','Put back '+nameOf(id),'Plan the rest within your budget.'));
      opts.push(removeOpt(false));
    }else if(x.reason==='time'){
      title='Not enough time for all your picks';
      lead='Your must-visit places and the travel between them don’t fit in '+(days>1?'these '+days+' days':'one day')+' ('+(x.input.dayStart||'09:00')+'–'+end+').';
      if(hhmm(end)<hhmm('22:00'))opts.push(option('pfLater','22:00','clock','Finish each day at 22:00','Keeps every place and adds evening time.',true));
      if(days<4)opts.push(option('pfAddDay',days+1,'calendar','Add a day','Spread your places over '+(days+1)+' days.',!opts.length));
      for(const id of x.ids.slice(0,2))opts.push(option('pfRemoveOne',id,'minus','Put back '+nameOf(id),'It is the hardest to fit.'));
      opts.push(removeOpt(!opts.length));
    }else if(x.reason==='closed'){
      const id=x.ids[0];
      title=(id?nameOf(id):'A place')+' is closed that day';
      lead='It isn’t open at a time that fits your trip date.';
      if(id)opts.push(option('pfRemoveOne',id,'minus','Put back '+nameOf(id),'Plan the rest of your picks.',true));
      opts.push(option('pfEdit',null,'calendar','Choose another date','Change your trip dates and search again.',!id));
    }else if(x.reason==='details'){
      title='Some places are missing locations';
      lead='The planner can’t place these on a route.';
      for(const id of x.ids.slice(0,3))opts.push(option('pfRemoveOne',id,'minus','Put back '+nameOf(id),'Plan without it.',opts.length===0));
      opts.push(removeOpt(!opts.length));
    }else{
      title='Your trip couldn’t be planned';
      lead=x.text||'Something stopped the planner.';
      opts.push(option('pfRetry',null,'refresh','Try again','Plan the same places once more.',true));
      opts.push(removeOpt(false));
      opts.push(option('pfEdit',null,'sliders','Edit trip preferences','Change dates, hours or budget.'));
    }
    const inner='<span class="pf-kicker">'+ic('alert',14)+'Needs a small change</span><h2 id="pf-title">'+esc(title)+'</h2><p class="pf-lead">'+esc(lead)+'</p>'+facts+
      '<div class="pf-options">'+opts.join('')+'</div><p class="pf-note">Your picks are saved. Nothing is booked until you confirm.</p>';
    if(inline)return '<section class="pf-card is-inline" aria-labelledby="pf-title">'+inner+'</section>';
    return '<div class="pf" role="dialog" aria-modal="true" aria-labelledby="pf-title"><div class="pf-scrim" data-act="pfClose"></div><section class="pf-card"><button type="button" class="pf-close" data-act="pfClose" aria-label="Close">'+ic('x',18)+'</button>'+inner+'</section></div>';
  }
  // The companion shows the same fixes as a card in its conversation instead of a pop-up.
  window.jhPlanFixCard=()=>wide?.matches&&pd.mode&&!pd.busy&&pd.error&&!pd.sample?dialogHTML(true):'';
  const showing=()=>wide?.matches&&pd.mode&&!pd.busy&&!!pd.error&&pd.fixShownFor!==pd.error&&!pd.sample;

  const previous=V['ai-picks'];
  V['ai-picks']=function(){
    const view=previous.apply(this,arguments);
    if(!wide?.matches||!pd.mode)return view;
    if(pd.fixRemove)view.body=view.body.replace('class="fc"','class="fc is-fixing"').replace('<div class="fc-days">','<p class="pf-hint">'+ic('info',15)+'Click a place to put it back, then press Done.</p><div class="fc-days">');
    if(showing()&&!(typeof window.jhPipShowing==='function'&&window.jhPipShowing()))view.body+=dialogHTML();
    return view;
  };

  const close=()=>{pd.fixShownFor=pd.error;};
  const replan=adjust=>{
    if(pd.busy)return;
    pd.planAdjust={...(pd.planAdjust||{}),...adjust};
    pd.input={...(pd.input||{}),...adjust,...(Object.hasOwn(adjust,'budgetAmount')?{budgetCnyMinor:adjust.budgetAmount==null?null:Math.round(adjust.budgetAmount*100)}:{})};
    pd.error='';pd.fixShownFor=null;pd.fixRemove=false;
    return A.pdFinish();
  };
  A.pfClose=()=>{close();render();};
  A.pfRemove=()=>{close();pd.fixRemove=true;render();};
  A.pfRemoveOne=id=>{close();A.jhPickRelease(id);pd.fixRemove=true;render();};
  A.pfNoBudget=()=>replan({budgetAmount:null,budgetCurrency:'CNY',budgetScope:'group'});
  A.pfLater=t=>replan({dayEnd:/^([01]\d|2[0-3]):[0-5]\d$/.test(t)?t:'22:00'});
  A.pfAddDay=n=>replan({days:Math.min(4,Math.max(1,Number(n)||1))});
  A.pfRetry=()=>{pd.error='';pd.fixShownFor=null;return A.pdFinish();};
  A.pfEdit=()=>{close();if(typeof A.ptuEdit==='function')A.ptuEdit();else go('place-search');};
  document.addEventListener('submit',e=>{
    if(!e.target.matches?.('[data-pf-budget]'))return;e.preventDefault();
    const n=Number(e.target.querySelector('input').value);if(!Number.isFinite(n)||n<1||n>1000000){e.target.querySelector('input').focus();return;}
    replan({budgetAmount:Math.round(n),budgetCurrency:'CNY',budgetScope:'group'});
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.pf')){e.preventDefault();A.pfClose();}});
  // Done after putting places back leaves the "fixing" state.
  const pfFinish=A.pdFinish;
  A.pdFinish=function(){pd.fixRemove=false;pd.fixShownFor=null;return pfFinish.apply(this,arguments);};
  // A new search starts clean.
  const pfNew=A.pdNewSearch;if(pfNew)A.pdNewSearch=function(){pd.planAdjust=null;pd.fcSlots=null;pd.fcArranged=false;return pfNew.apply(this,arguments);};
})();
