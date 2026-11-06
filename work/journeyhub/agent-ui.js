/* Authenticated agent runs are authoritative on Supabase. Preview drafts stay separate. */
const agPreviewViews={start:V.ai,plan:V['ai-plan'],tasks:V['ai-tasks'],email:V['ai-email']};
const agPreviewActions={build:A.ixBuild,remove:A.ixRemove,edit:A.ixEdit,resume:A.ixResume,reminder:A.ixReminder,save:A.ixSave};
const agDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):'Date to be confirmed';
const agTime=(value,tz)=>value?new Intl.DateTimeFormat('en-GB',{timeZone:tz||'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'';
const agPrefsDefault=()=>({city:jhCity,date:dayISO(1),guests:2,prompt:'',days:1,dayStart:'09:00',dayEnd:'21:00',transport:'drive',preferredExperienceIds:[],excludedExperienceIds:[]});
const agFresh=owner=>({owner,health:null,healthLoading:false,healthError:'',runs:[],loaded:false,loading:false,busy:false,error:'',activeId:null,preview:false,prefs:agPrefsDefault(),confirmChecked:false,emailReminders:false,loadVersion:0,selectionVersion:0});
let ag=agFresh(undefined);
Object.assign(TAB_OF,{'ai-review':'journey','ai-history':'journey'});
const agOwner=()=>jhUser?.id||null;
const agStill=ctx=>ag===ctx&&ctx.owner===agOwner();
const agRun=()=>ag.preview?null:ag.runs.find(r=>r.id===ag.activeId)||null;
const agRunKey=owner=>'journeyhub-agent-run-'+owner;
const agPendingKey=owner=>'journeyhub-agent-pending-'+owner;
const agStatus=status=>({planning:'Planning',awaiting_confirmation:'Needs your review',queued:'Reservations queued',booked:'Reserved',failed:'Needs attention'}[status]||'Checking status');
const agBadge=(label,kind='')=>'<span class="ag-badge '+kind+'">'+esc(label)+'</span>';
const agServerBadge=()=>agBadge('Saved on Supabase');
const agMoney=n=>fmt(Number(n)||0);
const agPlan=r=>r?.plan&&Array.isArray(r.plan.stops)?r.plan:null;
const agVerifiedEmail=()=>!!(jhUser?.email&&jhUser?.email_confirmed_at);
const agCanEmail=()=>ag.health?.email?.ready===true&&agVerifiedEmail();
const agExpired=r=>!!(r?.expiresAt&&new Date(r.expiresAt).getTime()<=Date.now()&&r.status==='awaiting_confirmation');
const agConflictDate=value=>String(value?.message||value||'').match(/(?:PLAN_DATE_CONFLICT\s*:\s*|already have a plan for\s+)(\d{4}-\d{2}-\d{2})/i)?.[1]||'';
const agConflictLink=value=>{const date=agConflictDate(value);return date?'<button class="btn-text" data-act="agOpenCalendar" data-a="'+date+'">Open Calendar</button>':'';};
A.agOpenCalendar=date=>{go('orders');if(typeof calSelect==='function')calSelect(date);};
const agErrorText=e=>{
  const code=String(e?.code||'').toUpperCase(),message=String(e?.message||'We could not reach the agent. Please try again.');
  const conflict=agConflictDate(message);if(conflict)return 'You already have a plan for '+conflict+'. Open Calendar, or delete the existing plan before creating another.';
  if(code.includes('AI')&&code.includes('CONFIG'))return 'The DeepSeek API key is not configured yet. Your existing plans are unchanged.';
  if(code==='UNAUTHORIZED'||code==='AUTH_REQUIRED')return 'Please sign in again to continue.';
  if(code.includes('RATE')||code==='429')return 'Too many requests right now. Wait a moment and try again.';
  return message.slice(0,600);
};
const agErrorHTML=()=>ag.error?'<div class="ag-error" role="alert"><strong>Something needs attention</strong><span>'+esc(ag.error)+'</span>'+agConflictLink(ag.error)+'<button data-act="agDismissError">Dismiss</button></div>':'';
function agCheckRun(run){if(!run||typeof run.id!=='string'||typeof run.status!=='string')throw Error('The agent returned an incomplete run. Refresh to try again.');return run;}
function agNewerRun(existing,incoming){
  if(!existing)return incoming;const oldAt=Date.parse(existing.updatedAt||''),nextAt=Date.parse(incoming.updatedAt||'');
  if(Number.isFinite(oldAt)&&Number.isFinite(nextAt)){if(oldAt>nextAt)return existing;const rank={planning:0,awaiting_confirmation:1,queued:2,booked:3,failed:3};if(oldAt===nextAt&&existing.version===incoming.version&&(rank[existing.status]??0)>(rank[incoming.status]??0))return existing;}
  return incoming;
}
function agHydrate(run){
  const p=agPlan(run);if(!p||ag.preview)return;
  ixDraft={version:2,preview:false,source:'server_agent',agentRunId:run.id,agentRunVersion:run.version,agentPlanHash:run.planHash,date:p.date,city:p.city,day:offsetOf(p.date),days:p.days||1,endDate:p.endDate||p.date,guests:p.guests,stops:p.stops.map(s=>s.sessionId),planSnapshot:clone(p),prompt:run.input?.prompt||p.summary||'',reminders:ag.emailReminders};
}
function agStore(run,activate=false){
  agCheckRun(run);const before=ag.runs.find(r=>r.id===run.id);run=agNewerRun(before,run);if(before&&(before.version!==run.version||before.planHash!==run.planHash))ag.confirmChecked=false;ag.runs=[run,...ag.runs.filter(r=>r.id!==run.id)].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,20);
  if(activate){ag.activeId=run.id;ag.preview=false;ag.confirmChecked=false;ag.emailReminders=false;try{sessionStorage.setItem(agRunKey(ag.owner),run.id);}catch{}}
  if(ag.activeId===run.id)agHydrate(run);
  if(['awaiting_confirmation','queued','booked'].includes(run.status)&&agPlan(run)?.stops.length&&(!agPlan(before)?.stops.length||before.version!==run.version||before.planHash!==run.planHash)&&typeof calWeatherPrefetch==='function')void calWeatherPrefetch({city:run.plan.city||run.input?.city,date:run.plan.date||run.input?.date,days:run.plan.days||run.input?.days||1});
  if(run.status==='booked'&&before?.status!=='booked')jhRefresh().catch(()=>{});
}
async function agRPC(name,args){const owner=agOwner(),mutation=!['journeyhub_agent_list','journeyhub_agent_get','journeyhub_calendar_state'].includes(name);if(mutation&&typeof jhInvalidateSnapshot==='function')jhInvalidateSnapshot();const {data,error}=await sb.rpc(name,args);if(mutation&&owner===agOwner()&&typeof jhInvalidateSnapshot==='function')jhInvalidateSnapshot();if(error)throw error;return data;}
let agHealthPending=null,agHealthCache=null;
function agFetchHealth(force=false){
  if(agHealthPending)return agHealthPending;
  if(!force&&agHealthCache?.expires>Date.now())return Promise.resolve(agHealthCache.body);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  const pending=(async()=>{
    const response=await fetch(jhConfig.url+'/functions/v1/journeyhub-agent?action=health',{headers:{apikey:jhConfig.publishableKey},cache:'no-store',signal:controller.signal});
    const body=await response.json().catch(()=>null);if(!response.ok)throw Error(body?.error?.message||'Agent availability could not be checked.');
    if(!body?.ai||typeof body.ai.ready!=='boolean')throw Error('Agent availability is not available yet.');
    agHealthCache={body,expires:Date.now()+60000};return body;
  })().catch(error=>{if(error?.name==='AbortError')throw Error('Agent availability check timed out. You can retry.');throw error;}).finally(()=>{clearTimeout(timer);if(agHealthPending===pending)agHealthPending=null;});
  agHealthPending=pending;return pending;
}
function agHealth(force=false){
  const ctx=ag;if(ctx.healthPromise)return ctx.healthPromise;if(!force&&ctx.health)return Promise.resolve(ctx.health);
  ctx.healthLoading=true;ctx.healthError='';
  ctx.healthPromise=agFetchHealth(force).then(body=>{if(agStill(ctx))ctx.health=body;return body;}).catch(e=>{if(agStill(ctx))ctx.healthError=agErrorText(e);}).finally(()=>{ctx.healthPromise=null;if(agStill(ctx)){ctx.healthLoading=false;if(['journey','ai','ai-review','ai-tasks'].includes(state.route))render();}});
  return ctx.healthPromise;
}
async function agLoadRuns(force=false){
  const ctx=ag;if(!ctx.owner||ctx.loading||(!force&&ctx.loaded))return;ctx.loading=true;const version=++ctx.loadVersion;
  try{
    const data=await agRPC('journeyhub_agent_list',{p_limit:20});if(!agStill(ctx)||version!==ctx.loadVersion)return;
    if(!Array.isArray(data))throw Error('Saved agent runs could not be loaded.');const merged=new Map(ctx.runs.map(r=>[r.id,r]));data.map(agCheckRun).forEach(r=>merged.set(r.id,agNewerRun(merged.get(r.id),r)));ctx.runs=[...merged.values()].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,20);ctx.loaded=true;
    let stored;try{stored=sessionStorage.getItem(agRunKey(ctx.owner));}catch{}
    const requested=ctx.activeId||stored||state.plan.aiDraft?.agentRunId;
    ctx.activeId=(ctx.runs.find(r=>r.id===requested)||ctx.runs[0])?.id||null;
    if(!ctx.preview&&ctx.activeId)agHydrate(ctx.runs.find(r=>r.id===ctx.activeId));
  }catch(e){if(agStill(ctx))ctx.error=agErrorText(e);}
  finally{if(agStill(ctx)){ctx.loading=false;if(['journey','home','orders','reserved-trips','ai','ai-plan','ai-tasks','ai-review','ai-history'].includes(state.route))render();}}
}
async function agLoadRun(id,{activate=false,quiet=false}={}){
  const ctx=ag;if(!ctx.owner||!id)return null;const selection=activate?++ctx.selectionVersion:ctx.selectionVersion;
  try{const run=agCheckRun(await agRPC('journeyhub_agent_get',{p_run_id:id}));if(!agStill(ctx)||(activate&&selection!==ctx.selectionVersion))return null;agStore(run,activate);if(!quiet)render();return ctx.runs.find(r=>r.id===run.id)||run;}
  catch(e){if(agStill(ctx)){ctx.error=agErrorText(e);if(!quiet)render();}return null;}
}
async function agGenerate(prompt){
  if(ag.busy)return;if(!jhUser){openLogin('traveler',{route:'ai'});return;}
  const ctx=ag;if(prompt)ctx.prefs.prompt=String(prompt).slice(0,1200);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(ctx.prefs.date)){ctx.error='Choose a travel date.';render();return;}
  const extra=typeof jpPayload==='function'?jpPayload(ctx.prefs):{};if(!extra)return;
  const payload={action:'plan',prompt:ctx.prefs.prompt.trim()||(ctx.prefs.preferredExperienceIds?.length?'Build a trip around the places I want to visit.':jpDefaultPrompt),city:ctx.prefs.city,date:ctx.prefs.date,guests:ctx.prefs.guests,...extra};
  const fingerprint=JSON.stringify(payload);let pending;try{pending=JSON.parse(sessionStorage.getItem(agPendingKey(ctx.owner))||'null');}catch{}
  const knownFailure=ctx.runs.some(r=>r.requestId===pending?.requestId&&r.status==='failed');
  payload.requestId=pending?.fingerprint===fingerprint&&!knownFailure?pending.requestId:crypto.randomUUID();
  try{sessionStorage.setItem(agPendingKey(ctx.owner),JSON.stringify({fingerprint,requestId:payload.requestId}));}catch{}
  ctx.busy=true;ctx.error='';ctx.planningRequestId=payload.requestId;ctx.progressRunId=null;render();let stopProgress=()=>{};
  try{
    const {data,error}=await sb.auth.getSession();if(error)throw error;
    if(!data.session||data.session.user.id!==ctx.owner)throw Error('Please sign in again to generate a plan.');
    if(typeof jpWatchPlanning==='function')stopProgress=jpWatchPlanning(ctx,payload.requestId);
    const response=await fetch(jhConfig.url+'/functions/v1/journeyhub-agent',{method:'POST',headers:{'Content-Type':'application/json',apikey:jhConfig.publishableKey,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(payload)});
    const body=await response.json().catch(()=>null);if(!response.ok){const error=new Error(body?.error?.message||'The agent could not create a plan. Please try again.');error.code=body?.error?.code||String(response.status);throw error;}
    const run=agCheckRun(body?.run);if(!agStill(ctx))return;
    try{sessionStorage.removeItem(agPendingKey(ctx.owner));}catch{}agStore(run,true);ctx.loaded=true;go('ai-plan');
  }catch(e){if(agStill(ctx)){
    ctx.error=agErrorText(e);stopProgress();
    if(e?.code==='PLAN_DATE_CONFLICT'||agConflictDate(e))try{sessionStorage.removeItem(agPendingKey(ctx.owner));}catch{}
    try{
      const runs=await agRPC('journeyhub_agent_list',{p_limit:20});if(!agStill(ctx))return;
      const latest=Array.isArray(runs)?runs.find(r=>r.requestId===payload.requestId):null;
      if(latest){agStore(agCheckRun(latest));if(latest.status==='failed'){
        try{const pending=JSON.parse(sessionStorage.getItem(agPendingKey(ctx.owner))||'null');if(pending?.requestId===payload.requestId)sessionStorage.removeItem(agPendingKey(ctx.owner));}catch{}
      }}
    }catch{}
  }}
  finally{stopProgress();if(agStill(ctx)){ctx.busy=false;ctx.planningRequestId=null;render();}}
}
function agHistoryHTML(limit=3,filter=null){
  const eligible=filter?ag.runs.filter(filter):ag.runs;const runs=eligible.slice(0,limit);if(!ag.owner)return '';
  return '<section class="ag-history"><div class="ix-section-top"><h2>Your agent plans</h2><button data-act="agRefreshRuns">'+(ag.loading?'Loading…':'Refresh')+'</button></div>'+(runs.length?runs.map(r=>{const p=agPlan(r),city=p?.city||r.input?.city||'Your trip',date=p?.date||r.input?.date;return '<button class="ag-run" data-act="agOpen" data-a="'+esc(r.id)+'"><img src="'+esc(ixCities[city]?.image||IMG.wat)+'" alt=""><span><strong>'+esc(city)+'</strong><small>'+agDate(date)+'</small></span>'+agBadge(agStatus(r.status),r.status==='awaiting_confirmation'?'wait':r.status==='failed'?'off':'')+'</button>';}).join(''):'<p class="ag-muted">'+(ag.loading?'Loading saved plans…':'Your saved agent plans will appear here.')+'</p>')+(eligible.length>limit?'<button class="ag-preview-link" data-act="go" data-a="ai-history">View all plans '+ic('right',12)+'</button>':'')+'</section>';
}
const agHealthCopy=()=>ag.health?.ai?.ready?'DeepSeek configured · Review before any reservation':ag.health?.ai?.ready===false?'DeepSeek API key is not configured yet':ag.healthLoading?'Checking AI availability…':ag.healthError?'Availability check failed · Retry to check again':'Checking AI availability…';
const agIsServerDraft=()=>!ag.preview&&!!(agRun()||ixCurrent()?.agentRunId);
function agServerCover(r){const p=agPlan(r),city=p?.city||r.input?.city||'Bangkok',c=ixCities[city]||ixCities.Bangkok;return '<div class="ix-plan-cover"><img src="'+esc(c.image)+'" alt="'+esc(c.alt)+'">'+agBadge('AI plan')+'<div><span class="ix-eyebrow">YOUR NEXT LITTLE ADVENTURE</span><h1>'+((p?.days||r.input?.days||1)>1?((p?.days||r.input?.days)+' days in '):'A day in ')+esc(city)+'</h1><p class="ix-plan-meta">'+agDate(p?.date||r.input?.date)+' <span>·</span> '+esc(p?.guests||r.input?.guests||1)+' guests <span>·</span> '+(p?.stops.length||0)+' stops</p></div></div>';}
function agRunNotice(r){
  const status=agStatus(r.status),copy={planning:'The agent is finding sessions for your day. You can leave and return to this saved run.',awaiting_confirmation:'Review the exact sessions and total before the agent reserves anything.',queued:'Your approved sessions are in the booking queue. This status is saved on Supabase.',booked:'Your internal sample reservations are saved. No payment has been taken.',failed:'This run needs attention. Check the task details or create a new plan.'}[r.status]||'Checking your saved run.';
  return '<div class="ag-run-status '+(['awaiting_confirmation','failed'].includes(r.status)?'wait':'')+'">'+ic(r.status==='booked'?'check':'sparkle',18)+'<div><strong>'+esc(status)+'</strong><p>'+esc(agExpired(r)?'This draft has expired. Create a new plan to check current sessions.':copy)+'</p></div></div>';
}
function agPlanBody(r){
  const p=agPlan(r);if(!p)return agServerCover(r)+agRunNotice(r)+'<div class="content"><div class="ag-panel"><p class="'+(r.status==='planning'?'ag-progress':'')+'">'+(r.status==='planning'?'Planning your day…':'No executable itinerary is available for this run.')+'</p><button class="btn btn-outline" data-act="agRefreshRun">Refresh status</button><button class="btn-text" data-act="agEdit">Create a new plan</button></div></div>';
  return agServerCover(r)+ixSegments('plan')+agRunNotice(r)+(p.summary?'<p class="ag-plan-summary">'+esc(p.summary)+'</p>':'')+'<div class="ix-timeline">'+p.stops.map((s,i)=>{const e=EXPS[s.experienceId];return '<div class="ix-stop"><div class="ix-stop-track"><span class="ix-stop-number">'+(i+1)+'</span></div><div class="ix-stop-content"><p class="ix-stop-time">'+agTime(s.startsAt,s.timeZone)+'–'+agTime(s.endsAt,s.timeZone)+' · '+esc(s.timeZone)+'</p><div class="ix-stop-card"><div class="ix-stop-card-top"><img src="'+esc(e?ixPhoto(e):ixCities[p.city]?.image||IMG.wat)+'" alt=""><div><h3>'+esc(s.title)+'</h3><p>'+esc(s.venue)+'</p><p>'+agMoney(s.unitPriceThb)+' / guest</p></div></div>'+(s.reason?'<p class="ag-stop-reason">'+esc(s.reason)+'</p>':'')+'<div class="ix-stop-actions"><button data-act="agSession" data-a="'+esc(s.sessionId)+'">View session '+ic('right',12)+'</button><button class="ix-remove" data-act="agRemove" data-a="'+esc(s.sessionId)+'" aria-label="Create a new plan without '+esc(s.title)+'">'+ic('x',13)+'</button></div></div></div></div>';}).join('')+'</div>'+agJournalEntry()+'<div class="ix-plan-actions"><button data-act="agEdit">'+ic('sliders',14)+' New preferences</button><button data-act="go" data-a="ai-tasks">'+ic('ticket',14)+' Trip tasks</button></div><p class="ix-note" style="margin:0 20px 20px">Internal sample catalog · No charge</p>';
}
function agJournalEntry(){return typeof JM!=='undefined'?'<button class="jm-plan-entry" data-act="jmStartFromPlan">'+ic('journey',23)+'<span><strong>Start this journey</strong><small>Turn your itinerary into a travel journal</small></span>'+ic('right',18)+'</button>':'';}
function agPlanFoot(r){const p=agPlan(r);if(!p)return '';const canReview=r.status==='awaiting_confirmation'&&!agExpired(r);return '<div class="foot"><div class="ix-price-foot"><span><small>Sample subtotal · '+p.guests+' guests</small><strong>'+agMoney(p.totalThb)+'</strong></span><button class="btn btn-primary" data-act="'+(canReview?'agReview':r.status==='booked'||r.status==='queued'?'go':'agEdit')+'"'+(r.status==='booked'||r.status==='queued'?' data-a="ai-tasks"':'')+'>'+(canReview?'Review & confirm':r.status==='booked'||r.status==='queued'?'View tasks':'New plan')+'</button></div><button class="ag-preview-link" data-act="ixSave">Save to Journey</button></div>';}

A.agDismissError=()=>{ag.error='';render();};
A.agHealth=()=>agHealth(true);
A.agRefreshRuns=()=>agLoadRuns(true);
A.agRefreshRun=()=>agRun()?agLoadRun(agRun().id):agLoadRuns(true);
A.agPrompt=p=>{ag.prefs.prompt=String(p).slice(0,1200);ag.confirmChecked=false;render();};
INPUTS.agPrompt=value=>{ag.prefs.prompt=String(value).slice(0,1200);ag.confirmChecked=false;};
CHANGES.agCity=el=>{if(jhCities[el.value])ag.prefs.city=el.value;ag.confirmChecked=false;};
CHANGES.agDate=el=>{ag.prefs.date=el.value;ag.confirmChecked=false;};
CHANGES.agGuests=el=>{ag.prefs.guests=Math.max(1,Math.min(6,Number(el.value)||1));ag.confirmChecked=false;};
A.agGenerate=()=>agGenerate();
A.ixBuild=prompt=>agGenerate(prompt);
A.agPreview=()=>{ag.preview=true;ag.error='';ixPrefs={city:ag.prefs.city,day:offsetOf(ag.prefs.date),guests:ag.prefs.guests,prompt:ag.prefs.prompt||'A day of discovery'};agPreviewActions.build();};
A.agOpen=async id=>{if(ag.busy)return;ag.error='';const r=await agLoadRun(id,{activate:true,quiet:true});if(r)go('ai-plan');else render();};
A.agEdit=()=>{const r=agRun(),p=agPlan(r);if(p)ag.prefs={city:p.city,date:p.date,guests:p.guests,prompt:r.input?.prompt||p.summary||''};ag.confirmChecked=false;ag.error='';go('ai');};
A.ixEdit=()=>{if(agIsServerDraft())A.agEdit();else{const d=ixCurrent();if(d)ag.prefs={city:d.city,date:d.date||dayISO(d.day),guests:d.guests,prompt:d.prompt||''};go('ai');}};
A.ixStart=()=>{ag.prefs.city=jhCity;ag.confirmChecked=false;ag.error='';go('ai');agHealth(true);};
A.ixResume=()=>{const id=state.plan.aiDraft?.agentRunId;if(id){ag.preview=false;A.agOpen(id);}else{ag.preview=true;agPreviewActions.resume();}};
A.agRemove=id=>{const r=agRun(),p=agPlan(r),s=p?.stops.find(x=>x.sessionId===id);if(!s)return;ag.prefs={city:p.city,date:p.date,guests:p.guests,prompt:((r.input?.prompt||p.summary||'Plan a day')+'\nCreate a new itinerary without '+s.title+' (session '+s.sessionId+').').slice(0,1200)};ag.confirmChecked=false;ag.error='';go('ai');toast('Preferences updated · generate a new plan to apply');render();};
A.ixRemove=id=>agIsServerDraft()?A.agRemove(id):agPreviewActions.remove(id);
A.agSession=id=>{if(DBC.sessions[id])A.ixSession(id);else{toast('This session is not in the current catalog. Refresh the plan.');render();}};
A.ixReminder=()=>agIsServerDraft()?A.agReview():agPreviewActions.reminder();
A.agReview=async()=>{const r=agRun();if(!r)return;if(ag.busy)return;ag.error='';const latest=await agLoadRun(r.id,{quiet:true});if(!latest){render();return;}ag.confirmChecked=false;ag.emailReminders=false;go('ai-review');agHealth(true);};
CHANGES.agConsent=el=>{ag.confirmChecked=!!el.checked;render();};
CHANGES.agEmail=el=>{ag.emailReminders=!!el.checked&&agCanEmail();ag.confirmChecked=false;render();};
A.agConfirm=async()=>{
  const r=agRun(),p=agPlan(r);if(!r||!p||ag.busy||r.status!=='awaiting_confirmation'||agExpired(r)||!ag.confirmChecked)return;
  if(ag.health?.worker?.ready===false){ag.error='The reservation worker is not connected yet. Please try again after setup.';render();return;}
  if(ag.emailReminders&&!agCanEmail()){ag.error='Email reminders require a verified account email and a connected email service.';ag.confirmChecked=false;render();return;}
  const ctx=ag;ctx.busy=true;ctx.error='';render();
  try{const run=agCheckRun(await agRPC('journeyhub_agent_confirm',{p_run_id:r.id,p_version:r.version,p_hash:r.planHash,p_email_reminders:ctx.emailReminders}));if(!agStill(ctx))return;agStore(run);ctx.confirmChecked=false;go('ai-tasks');}
  catch(e){if(agStill(ctx)){ctx.error=agErrorText(e);ctx.confirmChecked=false;}}
  finally{if(agStill(ctx)){ctx.busy=false;render();}}
};
const agOldSave=A.ixSave;
A.ixSave=()=>{const r=agRun();if(r)agHydrate(r);agOldSave();};
V.ai=()=>({bar:bar({title:'AI travel agent',right:agBadge(ag.health?.ai?.ready?'AI configured':ag.health?.ai?.ready===false?'Setup needed':'Checking',ag.health?.ai?.ready?'':'off')}),tabs:true,
  body:'<div class="ix-chat-head"><span class="ix-orb">'+ic('sparkle',32)+'</span><h1>Your day, thoughtfully<br>put together.</h1><p>Tell the agent what you would enjoy.</p></div>'+agErrorHTML()+'<div class="ag-form"><div class="ag-form-row"><label>Destination<select data-ch="agCity" aria-label="AI destination">'+Object.keys(jhCities).map(c=>'<option'+(ag.prefs.city===c?' selected':'')+'>'+c+'</option>').join('')+'</select></label><label>Travel date<input type="date" data-ch="agDate" aria-label="Travel date" value="'+esc(ag.prefs.date)+'"></label><label>Guests<select data-ch="agGuests" aria-label="Number of guests">'+[1,2,3,4,5,6].map(n=>'<option value="'+n+'"'+(ag.prefs.guests===n?' selected':'')+'>'+n+' guest'+(n===1?'':'s')+'</option>').join('')+'</select></label></div><textarea id="ag-prompt" data-in="agPrompt" maxlength="1200" placeholder="Local food, a little culture, and a relaxed afternoon…" aria-label="Describe your trip">'+esc(ag.prefs.prompt)+'</textarea><div class="ag-prompts">'+['Local flavors','Slow & scenic','Culture first','A family day'].map(p=>'<button data-act="agPrompt" data-a="'+p+'">'+p+'</button>').join('')+'</div><button class="btn btn-primary btn-block" data-act="agGenerate"'+(ag.busy||(ag.owner&&ag.health?.ai?.ready===false)?' disabled':'')+'>'+ic('sparkle',17)+(ag.busy?' Creating your plan…':ag.owner?'Create my plan':'Sign in to create a plan')+'</button><p class="ag-health '+(ag.health?.ai?.ready?'ready':'')+'"><i></i>'+esc(agHealthCopy())+'</p>'+(ag.healthError||ag.health?.ai?.ready===false?'<button class="ag-preview-link" data-act="agHealth">Check connection again</button>':'')+'<button class="ag-preview-link" data-act="agPreview">Explore a sample itinerary '+ic('right',12)+'</button></div>'+agHistoryHTML(3)
});
V['ai-history']=()=>({bar:bar({title:'Your agent plans',right:agServerBadge()}),tabs:true,body:agErrorHTML()+agHistoryHTML(20)});
V['ai-plan']=()=>{
  if(!agIsServerDraft())return agPreviewViews.plan();const r=agRun();
  if(!r)return {bar:bar({title:'Your itinerary'}),tabs:true,body:agErrorHTML()+'<div class="content"><div class="ag-panel"><p class="ag-progress">Loading your saved plan…</p><button class="btn btn-outline" data-act="agRefreshRuns">Try again</button></div></div>'};
  return {bar:bar({title:'Your itinerary',right:'<button class="icon-btn" data-act="agEdit" aria-label="Create a new plan with different preferences">'+ic('sliders',20)+'</button>'}),tabs:true,body:agErrorHTML()+agPlanBody(r),foot:agPlanFoot(r)};
};
V['ai-review']=()=>{
  const r=agRun(),p=agPlan(r);if(!r||!p)return {bar:bar({title:'Review your plan'}),tabs:true,body:'<div class="content"><div class="ag-panel"><p>Open a saved agent plan to review its sessions.</p><button class="btn btn-primary" data-act="go" data-a="ai">Open AI agent</button></div></div>'};
  const ready=r.status==='awaiting_confirmation'&&!agExpired(r),workerReady=ag.health?.worker?.ready!==false,emailReady=agCanEmail();
  return {bar:bar({title:'Review & confirm',right:agServerBadge()}),tabs:true,body:agErrorHTML()+agRunNotice(r)+'<div class="content"><section class="ag-panel"><h2>'+esc(p.city)+' · '+agDate(p.date)+'</h2><p>'+p.guests+' guests · '+p.stops.length+' sessions</p><div class="ag-confirm-list">'+p.stops.map(s=>'<div class="ag-confirm-item"><strong>'+esc(s.title)+'</strong><small>'+agDate(jhISO(s.startsAt,s.timeZone))+' · '+agTime(s.startsAt,s.timeZone)+'–'+agTime(s.endsAt,s.timeZone)+'<br>'+esc(s.venue)+' · '+esc(s.timeZone)+'</small><div class="ag-status-row"><span>'+s.guests+' × '+agMoney(s.unitPriceThb)+'</span><b>'+agMoney(s.totalThb)+'</b></div></div>').join('')+'</div><div class="ag-confirm-total"><span>Sample total</span><strong>'+agMoney(p.totalThb)+'</strong></div><p class="ag-base-total">Reservation total · <b>'+jhBaseMoney(p.totalThb)+'</b></p><p>JourneyHub internal sample catalog. No charge. These are sample reservations, not paid tickets from an external operator.</p></section><section class="ag-panel"><label class="ag-check"><input type="checkbox" data-ch="agEmail"'+(ag.emailReminders?' checked':'')+(!emailReady||!ready?' disabled':'')+'><span><strong>Email my trip updates</strong><small>'+(emailReady?'Send confirmation and reminders to '+esc(jhUser.email)+'.':!agVerifiedEmail()?'Verify your account email to enable reminders.':'Email service is not connected yet.')+'</small></span></label></section>'+(!workerReady?'<div class="ag-error" style="margin:0"><span>The reservation worker is not connected yet. This plan can be saved, but reservations cannot be queued.</span></div>':'')+'<label class="ag-check"><input type="checkbox" data-ch="agConsent"'+(ag.confirmChecked?' checked':'')+(!ready?' disabled':'')+'><span>I approve these exact sessions, guest counts and sample total. '+(ag.emailReminders?'I also want the selected emails.':'Email reminders are off.')+'</span></label><p class="ag-muted">Changing preferences creates a new draft that needs a new review.</p></div>',foot:'<div class="foot ag-approval-foot"><button class="btn btn-primary btn-block" data-act="agConfirm"'+(!ready||!workerReady||!ag.confirmChecked||ag.busy?' disabled':'')+'>'+(ag.busy?'Confirming…':'Confirm sample reservations')+'</button><p>Your approval is saved with this exact plan.</p></div>'};
};
function agTaskState(job){return ({pending:'Queued',processing:'Reserving',leased:'Processing',succeeded:'Reserved',accepted:'Accepted by email provider',failed:'Failed'}[job.status]||'Checking');}
function agTaskCard(job,r){
  const booking=job.kind==='booking',name=booking?'Reserve your sessions':job.kind==='booking_confirmation'?'Booking confirmation email':'Trip reminder email';
  const detail=booking?(job.status==='succeeded'?'All sample reservations were saved. No payment was taken.':job.status==='failed'?'Reservations were not completed. Review this run before trying a new plan.':'The worker uses your approved sessions and guest count.'):(job.status==='accepted'?'The email provider accepted this message. Delivery has not been confirmed.':job.status==='failed'?'The email could not be accepted by the provider. Your reservation status is separate.':'A server worker handles this email. You can close the app.');
  return '<article class="ix-task"><div class="ix-task-main"><span class="ix-task-icon">'+ic(booking?'ticket':'bell',18)+'</span><div><h3>'+name+'</h3><p>'+esc(detail)+'</p></div></div><div class="ag-task-status">'+agBadge(agTaskState(job),job.status==='failed'?'wait':job.status==='pending'?'off':'')+(job.runAt?'<time>'+agDate(jhISO(job.runAt,agPlan(r)?.stops[0]?.timeZone||'Asia/Bangkok'))+' · '+agTime(job.runAt,agPlan(r)?.stops[0]?.timeZone||'Asia/Bangkok')+'</time>':'')+'</div>'+(job.lastError?'<p class="ag-task-error">'+esc(String(job.lastError).slice(0,350))+'</p>':'')+'</article>';
}
V['ai-tasks']=()=>{
  if(!agIsServerDraft())return agPreviewViews.tasks();const r=agRun();if(!r)return {bar:bar({title:'Trip tasks'}),tabs:true,body:agErrorHTML()+'<div class="content"><p class="ag-progress">Loading saved tasks…</p><button class="btn btn-outline" data-act="agRefreshRuns">Refresh</button></div>'};
  const p=agPlan(r),jobs=r.jobs||[],bookings=r.bookings||[];
  return {bar:bar({title:'Trip tasks',right:'<button class="icon-btn" data-act="agRefreshRun" aria-label="Refresh agent status">'+ic('refresh',19)+'</button>'}),tabs:true,body:ixSegments('tasks')+agErrorHTML()+agRunNotice(r)+'<div class="content">'+(r.status==='awaiting_confirmation'?'<div class="ag-panel"><h2>Your approval comes first</h2><p>No reservations or emails are queued yet.</p><button class="btn btn-primary" data-act="agReview">Review exact sessions</button></div>':'')+(jobs.length?'<section class="ix-task-section"><h2>Agent activity</h2>'+jobs.map(j=>agTaskCard(j,r)).join('')+'</section>':'')+(bookings.length?'<section class="ix-task-section"><h2>Sample reservations · '+bookings.length+'</h2>'+bookings.map(b=>{const s=p?.stops.find(s=>s.sessionId===b.sessionId);return '<article class="ix-task"><div class="ix-task-main"><span class="ix-task-icon">'+ic('ticket',18)+'</span><div><h3>'+esc(s?.title||'Reserved session')+'</h3><p>'+esc(b.guests)+' guests · '+esc(b.checkinCode||b.id)+'</p></div></div>'+(DBC.bookings[b.id]?'<button class="ix-task-button" data-act="ticket" data-a="'+esc(b.id)+'">View sample ticket '+ic('right',15)+'</button>':'<p class="ag-task-detail">Reservation saved on Supabase.</p>')+'</article>';}).join('')+'</section>':'')+(r.status==='failed'?'<div class="ag-panel"><h2>This run needs attention</h2><p>'+esc(r.errorCode||'The agent could not complete this run.')+'</p><button class="btn btn-outline" data-act="agEdit">Create a new plan</button></div>':'')+(!jobs.some(j=>j.kind!=='booking')&&['queued','booked'].includes(r.status)?'<p class="ag-muted">Email reminders are off for this run.</p>':'')+'<p class="ag-muted">Activity is saved on Supabase and resumes when you reopen the app.</p></div>'};
};
V['ai-email']=()=>agIsServerDraft()?V['ai-tasks']():agPreviewViews.email();
const agPreviousJourney=V.journey;
V.journey=()=>{
  const v=agPreviousJourney(),r=agRun();
  v.body=v.body.replace('AI CONCIERGE · PREVIEW',ag.health?.ai?.ready?'AI TRAVEL AGENT':'AI TRAVEL AGENT · SETUP');
  if(r){const p=agPlan(r),summary='<button class="ag-journey-resume" data-act="agOpen" data-a="'+esc(r.id)+'">'+ic('journey',22)+'<span><strong>'+esc(p?.city||r.input?.city||'Your trip')+' · '+esc(agStatus(r.status))+'</strong><small>'+agDate(p?.date||r.input?.date)+' · Saved on Supabase</small></span>'+ic('right',16)+'</button>';v.body=v.body.replace(/<button class="ix-resume"[\s\S]*?<\/button>/,summary);if(!v.body.includes('ag-journey-resume'))v.body=v.body.replace('<button class="ix-journey-tasks"',summary+'<button class="ix-journey-tasks"');}
  return v;
};
const agPreviousJournalStart=A.jmStartFromPlan;
if(agPreviousJournalStart)A.jmStartFromPlan=()=>{const r=agRun();if(r)agHydrate(r);return agPreviousJournalStart();};
const agPreviousRender=render;
render=function(){
  const owner=agOwner(),changed=owner!==ag.owner;if(changed){ag=agFresh(owner);if(typeof jpLoadPrefs==='function')jpLoadPrefs(ag);}
  const r=agRun();if(r)agHydrate(r);
  agPreviousRender();
  if(changed){const ctx=ag;Promise.resolve().then(()=>{if(!agStill(ctx))return;agHealth();if(ctx.owner)agLoadRuns();});}
};
setInterval(()=>{if(document.visibilityState!=='visible'||ag.busy||ag.loading||!ag.owner||!['journey','home','orders','reserved-trips','ai','ai-plan','ai-tasks','ai-review','ai-history'].includes(state.route))return;const r=agRun();if(r&&(r.status==='planning'||r.status==='queued'||(r.jobs||[]).some(j=>['pending','leased','processing'].includes(j.status))))agLoadRun(r.id,{quiet:true}).then(run=>{if(run)render();});},6000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&ag.owner&&['journey','home','orders','reserved-trips','ai','ai-plan','ai-tasks','ai-review'].includes(state.route)){const r=agRun();if(r)agLoadRun(r.id,{quiet:true}).then(run=>{if(run)render();});}});
