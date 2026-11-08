/* Traveler preferences, a visual itinerary and server-recorded workflow activity. */
Object.assign(TAB_OF,{'ai-picks':'journey'});
const jpPrefKey=owner=>'journeyhub-trip-preferences-v1-'+(owner||'guest');
const jpBudgetCurrencies=Object.freeze(['THB','USD','CNY','SGD']);
const jpDefaultPrompt='A balanced trip with local food, culture and relaxed walks.';
function jpBudgetFields(value){return {budgetCurrency:jpBudgetCurrencies.includes(value.budgetCurrency)?value.budgetCurrency:'CNY',budgetAmount:value.budgetAmount==null||value.budgetAmount===''?null:Number(value.budgetAmount),budgetScope:value.budgetScope==='person'?'person':'group'};}
let jpView={owner:undefined,runId:null,day:'all',stop:null,scrollToStop:false},jpUndo=[],jpGesture=null;
function jpNormalize(value={}){
  const d=agPrefsDefault(),ids=key=>Array.isArray(value[key])?[...new Set(value[key].filter(x=>typeof x==='string'&&x.length<=100))].slice(0,20):[];
  const no=ids('excludedExperienceIds');
  return {...d,...jpBudgetFields(value),city:jhCities[value.city]?value.city:d.city,date:/^\d{4}-\d{2}-\d{2}$/.test(value.date||'')?value.date:d.date,guests:Math.max(1,Math.min(6,Math.round(Number(value.guests)||2))),prompt:String(value.prompt||'').slice(0,1200),days:Math.max(1,Math.min(4,Math.round(Number(value.days)||1))),dayStart:/^\d\d:\d\d$/.test(value.dayStart||'')?value.dayStart:d.dayStart,dayEnd:/^\d\d:\d\d$/.test(value.dayEnd||'')?value.dayEnd:d.dayEnd,transport:value.transport==='walk'?'walk':'drive',preferredExperienceIds:ids('preferredExperienceIds').filter(id=>!no.includes(id)),excludedExperienceIds:no};
}
function jpLoadPrefs(ctx){try{ctx.prefs=jpNormalize(JSON.parse(sessionStorage.getItem(jpPrefKey(ctx.owner))||'{}'));}catch{ctx.prefs=jpNormalize();}jhSetCity(ctx.prefs.city,{syncPreferences:false});jpUndo=[];}
function jpSavePrefs(){jhSetCity(ag.prefs.city,{syncPreferences:false});try{sessionStorage.setItem(jpPrefKey(ag.owner),JSON.stringify(ag.prefs));}catch{}ag.confirmChecked=false;}
function jpValidIDs(ids,city){return (ids||[]).filter(id=>EXPS[id]?.city===city);}
function jpPayload(p){
  const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if(!Number.isInteger(p.days)||p.days<1||p.days>4||!time.test(p.dayStart)||!time.test(p.dayEnd)||p.dayStart>=p.dayEnd){ag.error='Choose 1–4 days and an activity end time after the start time.';render();return null;}
  const budget=jpBudgetFields(p);if(budget.budgetAmount!==null&&(!Number.isFinite(budget.budgetAmount)||budget.budgetAmount<=0||budget.budgetAmount>1000000)){ag.error='Enter a budget above 0, or leave it blank.';render();return null;}
  return {days:p.days,dayStart:p.dayStart,dayEnd:p.dayEnd,transport:p.transport,...budget,preferredExperienceIds:jpValidIDs(p.preferredExperienceIds,p.city).sort(),excludedExperienceIds:jpValidIDs(p.excludedExperienceIds,p.city).sort()};
}
const jpOldPrompt=INPUTS.agPrompt;
INPUTS.agPrompt=(v,e)=>{jpOldPrompt(v,e);jpSavePrefs();};
const jpOldPromptAction=A.agPrompt;
A.agPrompt=p=>{jpOldPromptAction(p);jpSavePrefs();};
for(const name of ['agDate','agGuests']){const previous=CHANGES[name];CHANGES[name]=el=>{previous(el);jpSavePrefs();};}
CHANGES.agCity=el=>{if(!jhCities[el.value])return;ag.prefs.city=el.value;ag.prefs.preferredExperienceIds=[];ag.prefs.excludedExperienceIds=[];jpUndo=[];jpSavePrefs();render();};
CHANGES.jpDays=el=>{ag.prefs.days=Math.max(1,Math.min(4,Number(el.value)||1));jpSavePrefs();};
CHANGES.jpStart=el=>{ag.prefs.dayStart=el.value;jpSavePrefs();};
CHANGES.jpEnd=el=>{ag.prefs.dayEnd=el.value;jpSavePrefs();};
CHANGES.jpTransport=el=>{ag.prefs.transport=el.value==='walk'?'walk':'drive';jpSavePrefs();};
INPUTS.jpBudget=value=>{ag.prefs.budgetAmount=value===''?null:Number(value);jpSavePrefs();};
CHANGES.jpBudgetCurrency=el=>{if(!jpBudgetCurrencies.includes(el.value))return;ag.prefs.budgetCurrency=el.value;jpSavePrefs();};
CHANGES.jpBudgetScope=el=>{ag.prefs.budgetScope=el.value==='person'?'person':'group';jpSavePrefs();};
function jpPrefsFromRun(r){const p=agPlan(r);return jpNormalize({...r?.input,...p,prompt:r?.input?.prompt||p?.summary||'',preferredExperienceIds:r?.input?.preferredExperienceIds||[],excludedExperienceIds:r?.input?.excludedExperienceIds||[]});}
A.agEdit=()=>{const r=agRun();if(r)ag.prefs=jpPrefsFromRun(r);jpUndo=[];jpSavePrefs();ag.error='';go('ai');};
const jpOldIxEdit=A.ixEdit;
A.ixEdit=()=>{if(agIsServerDraft())A.agEdit();else{jpOldIxEdit();ag.prefs=jpNormalize(ag.prefs);jpSavePrefs();}};
A.ixStart=()=>{if(ag.prefs.city!==jhCity){ag.prefs.city=jhCity;ag.prefs.preferredExperienceIds=[];ag.prefs.excludedExperienceIds=[];jpUndo=[];}jpSavePrefs();ag.error='';go('ai');agHealth(true);};
A.agRemove=id=>{const r=agRun(),s=agPlan(r)?.stops.find(s=>s.sessionId===id);if(!s)return;ag.prefs=jpPrefsFromRun(r);ag.prefs.preferredExperienceIds=ag.prefs.preferredExperienceIds.filter(x=>x!==s.experienceId);ag.prefs.excludedExperienceIds=[...new Set([...ag.prefs.excludedExperienceIds,s.experienceId])];jpSavePrefs();ag.error='';go('ai');toast('Place skipped · create a new plan to apply');render();};
const jpCandidates=()=>Object.values(EXPS).filter(e=>e.city===ag.prefs.city&&!e.details?.browseOnly);
const jpRemaining=()=>jpCandidates().filter(e=>!ag.prefs.preferredExperienceIds.includes(e.id)&&!ag.prefs.excludedExperienceIds.includes(e.id));
// Only render cards that remain in this deck; the final card has no phantom back.
function jpDeckBacks(remaining){return '<div class="jp-deck" data-remaining="'+remaining+'">'+Array.from({length:Math.min(2,Math.max(0,remaining-1))},(_,i)=>'<div class="jp-deck-back jp-deck-back-'+(i+1)+'" aria-hidden="true"><span>'+ic('journey',28)+'</span></div>').reverse().join('');}
function jpChoiceMotion(id,vote){
  const card=[...document.querySelectorAll('.jp-swipe-card')].find(el=>el.dataset.pickId===id);
  if(!card||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const box=card.getBoundingClientRect();if(!box.width||!box.height)return;
  document.querySelectorAll('.jp-choice-flight').forEach(el=>el.remove());
  // A dragged card's bounding box includes its rotation. Reconstruct its
  // untransformed box so the exit starts exactly under the user's finger.
  const dx=Number(card.style.transform.match(/translateX\((-?[\d.]+)px\)/)?.[1])||0;
  const angle=Number(card.style.transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1])||0;
  const width=card.offsetWidth||box.width,height=card.offsetHeight||box.height;
  const start='translateX('+dx+'px) rotate('+angle+'deg)';
  const ghost=card.cloneNode(true);
  ghost.classList.add('jp-choice-flight');ghost.classList.remove('jp-dragging');ghost.dataset.direction=vote;ghost.removeAttribute('tabindex');ghost.setAttribute('aria-hidden','true');
  Object.assign(ghost.style,{position:'fixed',top:(box.top+(box.height-height)/2)+'px',left:(box.left+(box.width-width)/2-dx)+'px',width:width+'px',height:height+'px',maxHeight:'none',margin:'0',pointerEvents:'none',zIndex:'1000',transform:start});
  document.body.append(ghost);
  const distance=(vote==='want'?1:-1)*Math.max(420,box.width*1.3);
  const motion=ghost.animate?.([{transform:start,opacity:1},{transform:'translateX('+distance+'px) rotate('+(vote==='want'?20:-20)+'deg)',opacity:0}],{duration:240,easing:'cubic-bezier(.22,.7,.38,1)',fill:'forwards'});
  if(motion)motion.finished.then(()=>ghost.remove(),()=>ghost.remove());else ghost.remove();
  setTimeout(()=>ghost.remove(),300);
}
A.jpPicks=()=>{ag.prefs=jpNormalize(ag.prefs);go('ai-picks');};
A.jpPick=(id,vote)=>{
  if(ag.busy||!['want','skip'].includes(vote)||EXPS[id]?.city!==ag.prefs.city||!jpRemaining().some(e=>e.id===id))return;
  jpChoiceMotion(id,vote);
  jpUndo.push({id,owner:ag.owner,city:ag.prefs.city});
  ag.prefs[vote==='want'?'preferredExperienceIds':'excludedExperienceIds'].push(id);jpSavePrefs();render();
};
A.jpUndo=()=>{const last=jpUndo.pop();if(!last||last.owner!==ag.owner||last.city!==ag.prefs.city)return;for(const key of ['preferredExperienceIds','excludedExperienceIds'])ag.prefs[key]=ag.prefs[key].filter(id=>id!==last.id);jpSavePrefs();render();};
A.jpReset=()=>{ag.prefs.preferredExperienceIds=[];ag.prefs.excludedExperienceIds=[];jpUndo=[];jpSavePrefs();render();};
function jpBudgetHTML(p){
 const budget=jpBudgetFields(p);
 return '<div class="jp-budget-options"><label>Trip budget (optional)<input type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" data-in="jpBudget" aria-label="Whole-trip budget" placeholder="No limit" value="'+esc(budget.budgetAmount??'')+'"></label><label>Budget currency<select data-ch="jpBudgetCurrency" aria-label="Budget currency">'+jpBudgetCurrencies.map(code=>'<option value="'+code+'"'+(budget.budgetCurrency===code?' selected':'')+'>'+code+'</option>').join('')+'</select></label><label class="jp-budget-scope">Budget covers<select data-ch="jpBudgetScope" aria-label="Budget scope"><option value="group"'+(budget.budgetScope==='group'?' selected':'')+'>Whole trip · entire group</option><option value="person"'+(budget.budgetScope==='person'?' selected':'')+'>Whole trip · per person</option></select></label><small>Covers scheduled activities and dining. Transport and lodging are excluded. Fixed demo rates: CNY 1 · THB 0.20 · USD 7 · SGD 5 in virtual CNY. No real payment.</small></div>';
}
function jpPreferencesBaseHTML(){
  const p=ag.prefs,n=jpValidIDs(p.preferredExperienceIds,p.city).length;
  return '<div class="jp-trip-options"><label>Length<select data-ch="jpDays" aria-label="Trip length">'+[1,2,3,4].map(n=>'<option value="'+n+'"'+(p.days===n?' selected':'')+'>'+n+' day'+(n===1?'':'s')+'</option>').join('')+'</select></label><label>Getting around<select data-ch="jpTransport" aria-label="Getting around"><option value="drive"'+(p.transport==='drive'?' selected':'')+'>Car / taxi</option><option value="walk"'+(p.transport==='walk'?' selected':'')+'>Walking</option></select></label><label>Start each day<input type="time" data-ch="jpStart" aria-label="Daily start time" value="'+esc(p.dayStart)+'"></label><label>Finish by<input type="time" data-ch="jpEnd" aria-label="Daily finish time" value="'+esc(p.dayEnd)+'"></label></div><button class="jp-picks-entry" data-act="jpPicks"><span class="jp-picks-icon">'+ic('heart',21)+'</span><span><strong>Pick your kind of places</strong><small>'+(n?n+' wanted · '+p.excludedExperienceIds.length+' skipped':'Swipe a few ideas. We’ll plan around you.')+'</small></span>'+ic('right',18)+'</button>';
}
function jpPreferencesHTML(){return jpPreferencesBaseHTML().replace('</div><button class="jp-picks-entry"',jpBudgetHTML(ag.prefs)+'</div><button class="jp-picks-entry"');}
V['ai-picks']=()=>{
  const all=jpCandidates(),remaining=jpRemaining(),e=remaining[0],chosen=jpValidIDs(ag.prefs.preferredExperienceIds,ag.prefs.city),done=all.length-remaining.length;
  return {bar:bar({title:'Find your kind of trip',right:'<button class="btn-text" data-act="go" data-a="ai">Done</button>'}),tabs:true,
    body:'<div class="jp-swipe-page"><div class="jp-swipe-heading"><span>'+esc(ag.prefs.city)+' · '+done+'/'+all.length+' explored</span><button data-act="jpUndo"'+(!jpUndo.length?' disabled':'')+'>'+ic('refresh',12)+' Undo</button></div>'+(e?jpDeckBacks(remaining.length)+'<article class="jp-swipe-card" data-pick-id="'+esc(e.id)+'" tabindex="0" aria-label="'+esc(e.name)+'. Right arrow to want, left arrow to skip."><img src="'+esc(ixPhoto(e))+'" alt="'+esc(ixAlt(e))+'" draggable="false"><div class="jp-card-shade"></div><span class="jp-card-tag">'+esc(e.kind)+'</span><span class="jp-vote-label want">WANT TO GO</span><span class="jp-vote-label skip">SKIP</span><div class="jp-card-copy"><span>'+esc(e.dur)+' · '+esc(e.city)+'</span><h1>'+esc(e.name)+'</h1><p>'+esc(e.details?.summary||e.details?.en||e.does?.[0]||e.venue)+'</p><div><b>'+fmt(e.price)+'</b><small> / guest · sample</small></div></div></article></div><div class="jp-swipe-actions"><button class="jp-choice skip" data-act="jpPick" data-a="'+esc(e.id)+'" data-b="skip">'+ic('x',22)+'<span>Skip</span></button><p>Swipe left to skip<br>right to want</p><button class="jp-choice want" data-act="jpPick" data-a="'+esc(e.id)+'" data-b="want">'+ic('heart',22)+'<span>Want to go</span></button></div>':'<div class="jp-picks-complete"><span>'+ic('check',32)+'</span><h1>'+(all.length?'Your shortlist is ready.':'New places are on their way.')+'</h1><p>'+(chosen.length?chosen.length+' places you’d love to explore.':all.length?'No favorites yet. You can choose again or describe your trip.':'Try another destination to explore the catalog.')+'</p><div class="jp-picked-photos">'+chosen.map(id=>'<img src="'+esc(ixPhoto(EXPS[id]))+'" alt="'+esc(EXPS[id].name)+'">').join('')+'</div><button class="btn btn-primary btn-block" data-act="go" data-a="ai">Continue to my plan '+ic('right',16)+'</button><button class="btn-text" data-act="jpReset">Choose again</button></div>')+'<div class="jp-shortlist"><strong>'+chosen.length+' wanted</strong><span>'+ag.prefs.excludedExperienceIds.length+' skipped</span></div><p class="jp-small-note">Favorites guide your plan. Available sessions and your time window decide what fits.</p></div>'};
};
function jpReleaseGesture(g){
  if(!g)return;g.card.classList.remove('jp-dragging');g.card.style.transform='';delete g.card.dataset.direction;
  g.card.closest('.jp-deck')?.style.removeProperty('--jp-pull');
  try{if(g.card.hasPointerCapture?.(g.pointer))g.card.releasePointerCapture(g.pointer);}catch{}
}
document.addEventListener('pointerdown',e=>{
  const card=e.target.closest?.('.jp-swipe-card');if(!card||card.classList.contains('jp-choice-flight')||e.button>0||e.isPrimary===false||ag.busy||(typeof pd!=='undefined'&&pd.busy))return;
  if(jpGesture){if(jpGesture.card.isConnected)return;jpReleaseGesture(jpGesture);}
  jpGesture={card,id:card.dataset.pickId,x:e.clientX,y:e.clientY,context:ag,owner:ag.owner,city:ag.prefs.city,discovery:typeof pd==='undefined'?null:pd,pointer:e.pointerId,dx:0,dy:0,axis:null};
},true);
document.addEventListener('pointermove',e=>{
  const g=jpGesture;if(!g||g.pointer!==e.pointerId)return;
  if(!g.card.isConnected){jpGesture=null;jpReleaseGesture(g);return;}
  g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;
  if(!g.axis){if(Math.abs(g.dy)>12&&Math.abs(g.dy)>Math.abs(g.dx)){jpGesture=null;jpReleaseGesture(g);return;}if(Math.abs(g.dx)>12&&Math.abs(g.dx)>Math.abs(g.dy)*1.25){g.axis='x';g.card.dataset.touched='true';g.card.classList.add('jp-dragging');try{g.card.setPointerCapture?.(g.pointer);}catch{}}}
  if(g.axis!=='x')return;
  if(e.cancelable)e.preventDefault();const drag=Math.max(-240,Math.min(240,g.dx));
  g.card.style.transform='translateX('+drag+'px) rotate('+drag/22+'deg)';
  if(Math.abs(g.dx)>18)g.card.dataset.direction=g.dx>0?'want':'skip';else delete g.card.dataset.direction;
  g.card.closest('.jp-deck')?.style.setProperty('--jp-pull',String(Math.min(1,Math.abs(drag)/100)));
},{capture:true,passive:false});
function jpEndGesture(e,cancel=false){
  const g=jpGesture;if(!g||g.pointer!==e.pointerId)return;jpGesture=null;
  const threshold=Math.min(95,Math.max(65,(g.card.getBoundingClientRect().width||300)*.22));
  const valid=!cancel&&g.axis==='x'&&g.context===ag&&g.owner===ag.owner&&g.city===ag.prefs.city&&g.discovery===(typeof pd==='undefined'?null:pd)&&g.card.isConnected&&Math.abs(g.dx)>=threshold;
  if(valid)A.jpPick(g.id,g.dx>0?'want':'skip');jpReleaseGesture(g);
}
document.addEventListener('pointerup',e=>jpEndGesture(e),true);document.addEventListener('pointercancel',e=>jpEndGesture(e,true),true);document.addEventListener('lostpointercapture',e=>jpEndGesture(e,true),true);
window.addEventListener('blur',()=>{const g=jpGesture;jpGesture=null;jpReleaseGesture(g);});
document.addEventListener('keydown',e=>{const card=e.target.closest?.('.jp-swipe-card');if(!card||e.isComposing||e.repeat||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const id=card.dataset.pickId;A.jpPick(id,e.key==='ArrowRight'?'want':'skip');if(!card.isConnected)document.querySelector('.jp-swipe-card')?.focus({preventScroll:true});},true);

function jpWatchPlanning(ctx,requestId){
  let stopped=false,running=false;
  const poll=async()=>{if(stopped||running||!agStill(ctx)||ctx.planningRequestId!==requestId)return;running=true;try{const runs=await agRPC('journeyhub_agent_list',{p_limit:20});if(stopped||!agStill(ctx)||ctx.planningRequestId!==requestId)return;const r=Array.isArray(runs)?runs.find(r=>r.requestId===requestId):null;if(r){agStore(agCheckRun(r));ctx.progressRunId=r.id;ctx.progressError='';if(['journey','ai','ai-tasks'].includes(state.route))render();}}catch{if(!stopped&&agStill(ctx))ctx.progressError='Status connection interrupted. The request is still running.';}finally{running=false;}};
  poll();const timer=setInterval(poll,1800);return()=>{stopped=true;clearInterval(timer);};
}
const jpStages=[['receiving','Preferences received'],['checking_catalog','Checking available sessions'],['planning','Building your route'],['validating','Checking times & travel'],['approval','Your review & approval'],['booking','Reserving your sessions']];
function jpProgressHTML(r,{expanded=false}={}){
  const history=Array.isArray(r?.progress)?r.progress:[],seen=new Set(history.map(e=>e.stage));
  const status=r?.status,bookingJob=r?.jobs?.find(j=>j.kind==='booking'),queued=Boolean(r?.confirmedAt||bookingJob||['queued','booked'].includes(status)),ready=queued||status==='awaiting_confirmation';
  let active=-1;for(let i=0;i<4;i++)if(seen.has(jpStages[i][0]))active=i;
  if(ready)active=4;if(queued)active=5;
  const inner='<ol class="jp-progress-steps">'+jpStages.map(([key,label],i)=>{const complete=i<4?(ready||i<active):i===4?queued:status==='booked';const current=!complete&&i===active;const failed=current&&status==='failed';return '<li class="'+(complete?'done':failed?'failed':current?'current':'pending')+'"><span class="jp-step-symbol">'+(complete?ic('check',13):failed?ic('x',13):i+1)+'</span><span><b>'+label+'</b>'+(current?'<small>'+(status==='failed'?'This step could not be completed.':i===4?'Nothing is reserved until you confirm.':i===5?(bookingJob?.status==='processing'?'Reservation worker is processing.':'Waiting for the reservation worker.'):['Received by the server.','Reading your destination catalog.','Matching your preferences to real sessions.','Checking your daily window and travel buffers.'][i])+'</small>':'')+'</span></li>';}).join('')+'</ol>';
  if(!r)return '<div class="jp-connecting"><span class="ag-progress">Connecting to your agent…</span><p>Your request has been sent. Waiting for saved server activity.</p></div>';
  return expanded?inner:'<details class="jp-progress-details"'+(['planning','failed'].includes(status)?' open':'')+'><summary>'+ic('sparkle',14)+' Agent activity <span>'+esc(agStatus(status))+'</span></summary>'+inner+'</details>';
}
const jpOriginalAI=V.ai;
V.ai=()=>{
  if(ag.busy&&ag.planningRequestId){const r=ag.runs.find(r=>r.id===ag.progressRunId);return {bar:bar({title:'Making room for discovery'}),tabs:true,body:'<div class="jp-working"><span class="ix-orb">'+ic('sparkle',32)+'</span><h1>Your trip is taking shape.</h1><p>'+esc(ag.prefs.city)+' · '+ag.prefs.days+' day'+(ag.prefs.days===1?'':'s')+'</p>'+jpProgressHTML(r,{expanded:true})+(ag.progressError?'<p class="ag-muted">'+esc(ag.progressError)+'</p>':'')+'<button class="btn btn-soft btn-block" data-act="go" data-a="journey">Keep exploring</button><small>You’ll review every session before anything is reserved.</small></div>'};}
  const v=jpOriginalAI();v.body=v.body.replace('Your day, thoughtfully<br>put together.','A trip that feels<br>like you.').replace('Tell the agent what you would enjoy.','Pick your places. Set your pace.').replace('<textarea id="ag-prompt"',jpPreferencesHTML()+'<textarea id="ag-prompt"').replace('Explore a sample itinerary ','Explore a one-day sample ');return v;
};
function jpCurrentView(p,r){if(jpView.owner!==ag.owner||jpView.runId!==r.id)jpView={owner:ag.owner,runId:r.id,day:'all',stop:null,scrollToStop:false};if(jpView.day!=='all'&&jpView.day>(p.days||1))jpView.day='all';return jpView;}
A.jrDay=value=>{const r=agRun(),p=agPlan(r);if(!p)return;const view=jpCurrentView(p,r),n=Number(value);view.day=value==='all'?'all':Number.isInteger(n)&&n>=1&&n<=(p.days||1)?n:'all';view.stop=null;render();};
A.jrStop=id=>{const r=agRun(),p=agPlan(r),s=p?.stops.find(s=>s.sessionId===id);if(!s)return;const view=jpCurrentView(p,r);view.stop=id;view.day=jmRouteStopDay(p,s);view.scrollToStop=true;render();};
function jpTimelineHTML(p,view){
  const count=p.days||1,days=view.day==='all'?Array.from({length:count},(_,i)=>i+1):[view.day];
  return '<div class="jp-daily-timeline">'+days.map(day=>{const rows=p.stops.filter(s=>jmRouteStopDay(p,s)===day),date=new Date(Date.parse(p.date+'T12:00:00Z')+(day-1)*86400000).toISOString().slice(0,10);return '<section class="jp-day-section"><div class="jp-day-heading"><span class="jp-day-dot" style="background:'+jrColors[day-1]+'"></span><h2>Day '+day+'</h2><small>'+agDate(date)+'</small></div>'+(rows.length?rows.map(s=>{const e=EXPS[s.experienceId],leg=p.legs?.find(l=>l.toSessionId===s.sessionId),index=p.stops.findIndex(x=>x.sessionId===s.sessionId)+1;return (leg?jmRouteLegHTML(p,leg):'')+'<article class="jp-timeline-stop'+(view.stop===s.sessionId?' selected':'')+'" data-route-stop="'+esc(s.sessionId)+'"><div class="jp-stop-time"><span>'+index+'</span><b>'+agTime(s.startsAt,s.timeZone)+'–'+agTime(s.endsAt,s.timeZone)+'</b></div><div class="jp-stop-main"><button class="jp-stop-photo" data-act="jrStop" data-a="'+esc(s.sessionId)+'" aria-label="Show '+esc(s.title)+' on map"><img src="'+esc(e?ixPhoto(e):ixCities[p.city]?.image||IMG.wat)+'" alt="" loading="lazy"></button><div><button class="jp-stop-title" data-act="jrStop" data-a="'+esc(s.sessionId)+'">'+esc(s.title)+'</button><p>'+esc(s.venue)+'</p><strong>'+agMoney(s.totalThb)+'</strong></div></div>'+(s.reason?'<p class="jp-stop-reason">'+esc(s.reason)+'</p>':'')+'<div class="jp-stop-actions"><button data-act="agSession" data-a="'+esc(s.sessionId)+'">View session '+ic('right',12)+'</button><button data-act="agRemove" data-a="'+esc(s.sessionId)+'" aria-label="Create a new plan without '+esc(s.title)+'">'+ic('x',13)+' Skip in new plan</button></div></article>';}).join(''):'<p class="jp-empty-day">No catalog sessions scheduled for this day. Keep it open to explore.</p>')+'</section>';}).join('')+'</div>';
}
const jpOriginalPlan=V['ai-plan'];
V['ai-plan']=()=>{
  const r=agRun(),p=agPlan(r);if(!r||!p){const v=jpOriginalPlan();if(r)v.body+=jpProgressHTML(r,{expanded:true});return v;}
  const view=jpCurrentView(p,r),options={runId:r.id,owner:ag.owner,selectedDay:view.day,selectedStop:view.stop};
  const cover=agServerCover(r).replace('A day in ',(p.days||1)>1?(p.days+' days in '):'A day in ');
  return {bar:bar({title:'Your itinerary',right:'<button class="icon-btn" data-act="agEdit" aria-label="Create a new plan with different preferences">'+ic('sliders',20)+'</button>'}),tabs:true,body:agErrorHTML()+cover+ixSegments('plan')+agRunNotice(r)+jmRouteMapHTML(p,options)+'<div class="jp-itinerary-meta"><span>'+esc(p.dayStart||'09:00')+'–'+esc(p.dayEnd||'21:00')+' daily</span><span>'+((p.transport||'drive')==='walk'?'Walking':'Car / taxi')+' · estimated travel</span></div>'+jpTimelineHTML(p,view)+jpProgressHTML(r)+agJournalEntry()+'<div class="ix-plan-actions"><button data-act="agEdit">'+ic('sliders',14)+' New preferences</button><button data-act="go" data-a="ai-tasks">'+ic('ticket',14)+' Trip tasks</button></div>',foot:agPlanFoot(r),after:()=>{jmRouteMapMount(p,options);if(view.scrollToStop){view.scrollToStop=false;const card=[...app.querySelectorAll('[data-route-stop]')].find(el=>el.dataset.routeStop===view.stop);card?.scrollIntoView?.({block:'nearest',behavior:'auto'});}}};
};
const jpOriginalTasks=V['ai-tasks'];
V['ai-tasks']=()=>{const v=jpOriginalTasks(),r=agRun();if(r)v.body=v.body.replace('<div class="content">','<div class="content">'+jpProgressHTML(r,{expanded:true}));return v;};
const jpOriginalJournal=A.jmStartFromPlan;
if(jpOriginalJournal)A.jmStartFromPlan=()=>{
  const r=agRun(),p=agPlan(r)||ixCurrent()?.planSnapshot;if(!p)return jpOriginalJournal();
  return jmRun(async(owner,active)=>{jmDemo=false;const stops=p.stops.map(s=>({id:s.sessionId,title:s.title,time:'Day '+jmRouteStopDay(p,s)+' · '+agDate(s.date||jhISO(s.startsAt,s.timeZone))+' · '+agTime(s.startsAt,s.timeZone),visited:false,note:''}));const existing=jmCache.trips.find(t=>t.source==='AI itinerary'&&t.city===p.city&&t.date===p.date&&t.stops.map(s=>s.id).join('|')===stops.map(s=>s.id).join('|'));const trip=existing||await JM.saveTrip(owner,{title:(p.days>1?p.days+' days in ':'A day in ')+p.city,city:p.city,...jmPlaces[p.city],date:p.date,source:'AI itinerary',stops});if(!active())return;jmTripTab='timeline';return {route:'memory-trip',params:{id:trip.id}};});
};

