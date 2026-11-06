/* The landing page uses the same AI form, handlers and confirmation workflow. */
let jhHomeOptionsOpen=false,jhHomeOwner=null;
const jhReservedRun=r=>r.status==='booked'||r.status==='queued'||!!r.confirmedAt||r.bookings?.length>0;
const jhVibes=[['food','Local food'],['globe','Culture & art'],['sun','Nature & outdoors']];
A.jhHomeCity=city=>{if(jhCities[city]&&city!==ag.prefs.city)CHANGES.agCity({value:city});};
A.jhHomeVibe=value=>{if(!jhVibes.some(([,v])=>v===value))return;const lines=ag.prefs.prompt.split('\n'),has=lines.includes(value);ag.prefs.prompt=(has?lines.filter(x=>x!==value):[...lines.filter(Boolean),value]).join('\n').slice(0,1200);jpSavePrefs();render();};
A.jhTomorrow=()=>{const local=jhISO(new Date().toISOString(),jhCities[ag.prefs.city].tz),date=new Date(local+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);CHANGES.agDate({value:date.toISOString().slice(0,10)});render();};
const jhHomeOptionsLabel=()=> 'More preferences · '+ag.prefs.guests+' guest'+(ag.prefs.guests===1?'':'s')+' · '+ag.prefs.days+' day'+(ag.prefs.days===1?'':'s');
document.addEventListener('toggle',event=>{if(event.target.matches?.('.jh-home-options'))jhHomeOptionsOpen=event.target.open;},true);
document.addEventListener('change',event=>{if(['agGuests','jpDays'].includes(event.target.dataset?.ch)){const summary=document.querySelector('.jh-home-options summary');if(summary)summary.textContent=jhHomeOptionsLabel();}});
V.journey=()=>{
  if(jhHomeOwner!==ag.owner){jhHomeOwner=ag.owner;jhHomeOptionsOpen=false;}
  const ai=V.ai();
  const barHTML='<header class="bar top"><h1 class="h1">AI Journey</h1></header>';
  if(ag.busy&&ag.planningRequestId){return {...ai,bar:barHTML,body:ai.body.replace('<button class="btn btn-soft btn-block" data-act="go" data-a="journey">Keep exploring</button>','')};}
  // Reuse the real planner controls so preferences, retries and auth stay identical.
  const fragment=document.createElement('template');fragment.innerHTML=ai.body;
  const form=fragment.content.querySelector('.ag-form');
  form.querySelector('[data-ch="agCity"]').closest('label').classList.add('jh-city-select');
  form.querySelector('[data-ch="agCity"]').tabIndex=-1;
  const cities=document.createElement('div');cities.className='jh-destination-cards';cities.setAttribute('role','group');cities.setAttribute('aria-label','Choose destination');
  cities.innerHTML=Object.keys(jhCities).map(city=>'<button type="button" data-act="jhHomeCity" data-a="'+city+'" aria-pressed="'+(ag.prefs.city===city)+'"><img src="'+esc(ixCities[city].image)+'" alt=""><span>'+city+'</span><i>'+ic('check',12)+'</i></button>').join('');form.prepend(cities);
  const dateRow=form.querySelector('.ag-form-row');dateRow.insertAdjacentHTML('beforeend','<button class="jh-date-shortcut" data-act="jhTomorrow">Tomorrow '+ic('right',12)+'</button>');
  const options=document.createElement('details');options.className='jh-home-options';options.open=jhHomeOptionsOpen;
  const summary=document.createElement('summary');summary.textContent=jhHomeOptionsLabel();options.append(summary);
  const inner=document.createElement('div');inner.className='jh-home-options-body';options.append(inner);
  const guests=form.querySelector('[data-ch="agGuests"]')?.closest('label');if(guests)inner.append(guests);
  for(const selector of ['.jp-trip-options','.jp-picks-entry','.ag-prompts','.ag-preview-link'])for(const node of [...form.querySelectorAll(selector)])inner.append(node);
  // Guests can only see value through the sample, so keep it beside the main action.
  const sample=inner.querySelector('[data-act="agPreview"]');
  const prompt=form.querySelector('#ag-prompt');prompt.setAttribute('placeholder','Food, culture, hidden gems… What would you love to do?');
  const label=document.createElement('label');label.setAttribute('for','ag-prompt');label.textContent='Your trip, your way';prompt.before(label);
  const vibes=document.createElement('div');vibes.className='jh-vibe-chips';vibes.setAttribute('role','group');vibes.setAttribute('aria-label','Trip interests');vibes.innerHTML=jhVibes.map(([icon,value])=>'<button data-act="jhHomeVibe" data-a="'+value+'" aria-pressed="'+ag.prefs.prompt.split('\n').includes(value)+'">'+ic(icon,13)+value+'</button>').join('');prompt.after(vibes);vibes.after(options);
  inner.querySelector('.jp-picks-entry')?.remove();
  const health=form.querySelector('.ag-health');if(health)health.textContent=ag.health?.ai?.ready?'Review your itinerary before any reservation.':ag.health?.ai?.ready===false?'AI is unavailable. Try again shortly.':ag.healthError&&!ag.healthLoading?'Availability check failed · Retry to check again':'Checking AI availability…';
  // Keep a connection retry visible when needed, even with preferences collapsed.
  const retry=inner.querySelector('[data-act="agHealth"]');if(retry)form.append(retry);
  if(sample){sample.classList.add('jh-home-sample');form.append(sample);}
  const history=agHistoryHTML(2,r=>!jhReservedRun(r)).replace('Your agent plans','Draft trips').replace('data-a="ai-history"','data-a="journey-drafts"');
  const localDraft=state.plan.aiDraft&&!state.plan.aiDraft.agentRunId?'<button class="jh-home-link" data-act="ixResume">'+ic('journey',18)+' Continue sample itinerary '+ic('right',15)+'</button>':'';
  return {bar:barHTML,tabs:true,body:'<div class="jh-home-intro"><span>'+ic('sparkle',15)+' AI TRIP PLANNER</span><h2>Where to next?</h2></div>'+agErrorHTML()+'<div class="jh-home-planner">'+form.outerHTML+'</div>'+history+'<div class="jh-home-below">'+localDraft+'<button class="jh-home-link" data-act="go" data-a="memories">'+ic('globe',20)+'<span>Travel memories</span>'+ic('right',16)+'</button></div>'};
};
Object.assign(TAB_OF,{'reserved-trips':'orders','journey-drafts':'journey'});
V['journey-drafts']=()=>({bar:bar({title:'Draft trips',back:true}),tabs:true,body:agErrorHTML()+agHistoryHTML(20,r=>!jhReservedRun(r))});
V['reserved-trips']=()=>{const hasLegacy=state.plan.savedStops?.length||myBookings().length||myOrders().some(isOpen);return {bar:bar({title:'Your reservations',back:true}),tabs:true,body:'<p class="ix-note" style="padding:12px 20px">Sample reservations · No payment taken</p>'+agErrorHTML()+agHistoryHTML(20,jhReservedRun).replace('Your agent plans','Reserved itineraries').replace('Your saved agent plans will appear here.','Confirmed agent trips will appear here.')+(hasLegacy?ixOriginalJourney().body:'<div class="content"><p class="ag-muted">No individual reservations yet.</p><button class="btn btn-primary" data-act="tab" data-a="journey">Plan a trip</button></div>')};};
const jhExploreBeforeReservations=V.home;
V.home=()=>{const view=jhExploreBeforeReservations(),count=myBookings().length;const entry='<button class="jh-explore-reservations" data-act="go" data-a="reserved-trips"><span class="jh-reservation-icon">'+ic('ticket',22)+'</span><span><strong>Your reservations</strong><small>'+(count?count+' reserved session'+(count===1?'':'s'):'Itineraries, tickets & booking status')+'</small></span>'+ic('right',18)+'</button>';view.body=view.body.replace('<div class="ix-quick">',entry+'<div class="ix-quick">');return view;};
const jhHomePreviousRender=render;
// The standalone planner screen is retired: login returns, edits and swipe "Done" all land on Journey.
render=function(){if(state.route==='ai')state.route='journey';const reserved=!ag.preview&&agRun()&&jhReservedRun(agRun());TAB_OF['ai-plan']=reserved?'orders':'journey';TAB_OF['ai-tasks']=reserved?'orders':'journey';jhHomePreviousRender();};
