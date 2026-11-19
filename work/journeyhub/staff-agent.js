/* Staff assistant uses persisted tasks and canonical approval/publication, never model math. */
const saFresh=owner=>({owner,tasks:[],open:new Set(),moreOpen:false,counts:null,totalCount:0,returnedCount:0,loaded:false,loading:false,error:'',checkedAt:null,last:0,pending:null,busy:null,monitoring:''});
let sa=saFresh(null);
const saOwner=()=>jhUser?.id&&me()?jhUser.id+':'+me().id:null;
const saCurrent=ctx=>sa===ctx&&ctx.owner===saOwner();
function saScope(){const owner=saOwner();if(sa.owner!==owner)sa=saFresh(owner);return sa;}
const saExpired=t=>{const p=DBC.sessionPlans?.[t.planId],o=t.evidence?.outcome||t.proposal||{};if(p&&typeof swExpired==='function')return swExpired(p);if(!['suggested','draft','approval','attention'].includes(t.status)||!o.date)return false;const zone=EXPS[o.exp||'craft']?.timeZone||'Asia/Bangkok';const today=sfDateAtZone(zone),hm=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());return o.date<today||(o.date===today&&String(o.startTime||'00:00').slice(0,5)<=hm);};
const saRows=()=>sa.tasks.filter(t=>(!t.acknowledgedUntil||Date.parse(t.acknowledgedUntil)<=Date.now())&&!saExpired(t));
const saNeeds=t=>['suggested','draft','approval','attention'].includes(t.status);
const saLabel=t=>({suggested:'Opportunity',draft:'Draft ready',approval:'Draft ready',tracking:'Published · tracking',completed:'Outcome ready',attention:'Needs attention',resolved:'Resolved'}[t.status]||'Review');
const saMoney=value=>'THB '+Number(value||0).toLocaleString('en-GB',{maximumFractionDigits:0});
async function saLoad(force=false){
 saScope();const ctx=sa;if(!ctx.owner)return;if(ctx.pending)return ctx.pending;if(!force&&ctx.last&&Date.now()-ctx.last<30000)return;
 ctx.loading=true;ctx.error='';const request=(async()=>{
  try{const {data,error}=await sb.rpc('journeyhub_staff_agent',{p_action:force?'refresh':'list',p_id:null});if(error)throw error;if(!saCurrent(ctx))return;
   if(!data||!Array.isArray(data.tasks))throw Error('Staff assistant returned an incomplete response.');
   ctx.tasks=data.tasks;ctx.counts=data.counts?{...data.counts,opportunities:Math.max(0,Number(data.counts.opportunities||0)-data.tasks.filter(t=>t.kind==='opportunity'&&saExpired(t)&&(!t.acknowledgedUntil||Date.parse(t.acknowledgedUntil)<=Date.now())).length)}:null;ctx.totalCount=Number(data.totalCount??data.tasks.length);ctx.returnedCount=Number(data.returnedCount??data.tasks.length);ctx.checkedAt=data.checkedAt;ctx.monitoring=data.monitoring||'';ctx.loaded=true;ctx.last=Date.now();
  }catch(error){if(saCurrent(ctx)){ctx.error=jhError(error);ctx.last=Date.now();}}
  finally{if(saCurrent(ctx)){ctx.loading=false;ctx.pending=null;const editing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'');if(!editing&&state.role==='staff'&&['s-today','s-insights','s-assistant','s-session'].includes(state.route))render();}}
 })();ctx.pending=request;return request;
}
function saCompact(){
 saScope();if(!sa.owner)return '';const rows=saRows(),opportunities=Number(sa.counts?.opportunities??rows.filter(t=>t.kind==='opportunity'&&saNeeds(t)).length),checks=Number(sa.counts?.sessionChecks??rows.filter(t=>t.kind==='session_attention').length),tracking=Number(sa.counts?.tracking??rows.filter(t=>t.status==='tracking').length),count=opportunities+checks;
 const summary=[opportunities?opportunities+' opportunit'+(opportunities===1?'y':'ies'):'',checks?checks+' session check'+(checks===1?'':'s'):''].filter(Boolean).join(' · ');
 return '<section class="sa-compact" aria-label="Staff assistant"><div class="sa-compact-copy"><span class="sa-kicker">'+ic('sparkle',16)+' Staff assistant</span><strong>'+(sa.loaded?(summary|| (tracking?'Watching '+tracking+' published session'+(tracking===1?'':'s'):'Operations checked')):sa.error?'Assistant needs a retry':'Checking operations…')+'</strong></div><button class="btn btn-soft btn-sm" data-act="go" data-a="s-assistant">'+(count?'Review':'Open')+' '+ic('right',15)+'</button></section>';
}
function saStageHTML(t){const labels=['Analyze','Prepare','Publish','Track'],index={suggested:0,draft:1,approval:2,tracking:3,completed:3,attention:2}[t.status]??0;
 return '<ol class="sa-stages" aria-label="Session workflow">'+labels.map((text,i)=>'<li class="'+(i<index?'is-done':i===index?'is-current':'')+'">'+(i<index?ic('check',12):'<span>'+(i+1)+'</span>')+text+'</li>').join('')+'</ol>';
}
function saEvidence(t){
 const e=t.evidence||{},p=t.proposal||{},o=e.outcome,historical=e.historical||[],live=e.live||{};
 if(t.kind!=='opportunity')return '<div class="sa-facts"><span><small>Confirmed</small><b>'+Number(e.confirmed||0)+' / '+Number(e.cap||0)+'</b></span><span><small>Other-channel holds</small><b>'+Number(e.held||0)+'</b></span><span><small>Cancelled</small><b>'+Number(e.cancelled||0)+'</b></span></div>';
 let html=saStageHTML(t);
 if(o){const f=o.forecast||{};html+='<div class="sa-facts"><span><small>LIVE · confirmed</small><b>'+Number(o.confirmed||0)+' / '+Number(o.cap||0)+'</b></span><span><small>LIVE · cancelled</small><b>'+Number(o.cancelled||0)+'</b></span><span><small>LIVE · checked in</small><b>'+Number(o.checkedIn||0)+'</b></span></div><div class="sa-outcome"><span>Reservation value <b>'+saMoney(o.bookedValueThb)+'</b></span><span>Forecast contribution <b>'+saMoney(f.con)+'</b></span></div><p class="cap">Booking value is not realized profit. Forecast uses the unchanged September assumptions.</p>';}
 else html+='<div class="sa-facts"><span><small>LIVE · next 14 days</small><b>'+Number(live.confirmed||0)+' / '+Number(live.capacity||0)+' seats</b></span><span><small>PROPOSED · date</small><b>'+esc(p.date||'—')+'</b></span><span><small>PROPOSED · start</small><b>'+esc(p.startTime||'—')+'</b></span></div>';
 html+='<details class="sa-evidence"><summary>Evidence & forecast</summary><p class="sa-kicker">Historical sample · September 2026</p><div class="sa-comparison">'+historical.map(h=>'<article><strong>'+esc(h.name||h.experience_id)+'</strong><span>'+Number(h.seats_filled_pct||0).toFixed(1)+'% fill</span><span>'+Number(h.contribution_margin_pct||0).toFixed(1)+'% margin</span></article>').join('')+'</div><p class="sa-kicker">Forecast scenarios · Thai Craft Lab</p><div class="sa-comparison">'+(p.scenarios||[]).map(s=>'<article><strong>'+Number(s.cap)+' seats · '+saMoney(s.price)+'</strong><span>Promo '+saMoney(s.promo)+'</span><span>'+saMoney(s.forecast?.con)+' contribution</span></article>').join('')+'</div><p class="cap">91.7% booked · 9.1% cancellations · 92% attendance. Forecasts are scenarios, not confirmed demand. Edit capacity, price and promotion in the saved draft.</p></details>';
 if(o?.bookings?.length)html+='<details class="sa-evidence"><summary>Reservation records</summary><div class="sa-records">'+o.bookings.map(b=>'<button class="btn-text" data-act="ticket" data-a="'+esc(b.id)+'"><span>'+esc(b.id)+'</span><small>'+Number(b.guests)+' guests · '+esc(b.status)+'</small></button>').join('')+'</div></details>';
 return html;
}
const saSummary=t=>(['draft','submitted','withdrawn'].includes(DBC.sessionPlans?.[t.planId]?.status)||['draft','approval'].includes(t.status))?'Review the date and Forecast, then publish the session.':t.summary;
function saTaskHTML(t){
 const busy=!!sa.busy,p=t.proposal||{},o=t.evidence?.outcome||{};
 let actions=t.kind==='opportunity'?(t.planId?'<button class="btn btn-primary btn-sm" data-act="saPlan" data-a="'+esc(t.id)+'">'+(t.status==='approval'?'Review draft':t.status==='draft'?'Review draft':'View plan & forecast')+'</button>':'<button class="btn btn-primary btn-sm" data-act="saPrepare" data-a="'+esc(t.id)+'"'+(busy?' disabled':'')+'>'+(sa.busy===t.id?'Preparing…':'Prepare editable draft')+'</button>'):'<button class="btn btn-primary btn-sm" data-act="go" data-a="s-session" data-b="'+esc(t.sessionId)+'">Review session</button>';
 if(t.sessionId&&t.kind==='opportunity')actions+='<button class="btn btn-outline btn-sm" data-act="go" data-a="s-session" data-b="'+esc(t.sessionId)+'">Live bookings</button>';
 if(!['approval','tracking','completed'].includes(t.status))actions+='<button class="btn-text" data-act="saAcknowledge" data-a="'+esc(t.id)+'"'+(busy?' disabled':'')+'>Later</button>';
 return '<article class="card sa-task"><div class="row-between"><h2 class="h3">'+esc(t.title)+'</h2>'+badge(saLabel(t),t.status==='tracking'?'b-ok':t.status==='attention'?'b-warn':'b-info')+'</div><p class="meta">'+esc(saSummary(t))+'</p>'+saEvidence(t)+'<div class="sa-actions">'+actions+'</div>'+(t.events?.length?'<details class="sa-evidence"><summary>Activity log</summary><ol class="log">'+t.events.map(e=>'<li><b>'+esc(String(e.created_at||'').slice(0,16).replace('T',' '))+' UTC</b><span>'+esc(e.detail)+'</span></li>').join('')+'</ol></details>':'')+'</article>';
}
function saTaskPreview(t){
 const e=t.evidence||{},reason={capacity_conflict:'Capacity conflict',closed_with_bookings:'Closed with reservations',low_fill:'Low fill',full:'Fully booked'}[e.reason]||saLabel(t),stats=t.kind==='session_attention'?Number(e.confirmed||0)+' / '+Number(e.cap||0)+' confirmed':saLabel(t);
 const zone=typeof EXPS!=='undefined'?EXPS[e.experienceId]?.timeZone||'UTC':'UTC',when=e.startsAt&&Number.isFinite(Date.parse(e.startsAt))?new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(e.startsAt)):'';
 return '<details class="sa-task-preview" data-sa-task="'+esc(t.id)+'"'+(sa.open.has(t.id)?' open':'')+'><summary><span><strong>'+esc(t.title)+'</strong><small>'+esc(reason)+(stats!==reason?' · '+esc(stats):'')+(when?' · '+esc(when):'')+'</small></span>'+ic('down',16)+'</summary><div class="sa-preview-body">'+saTaskHTML(t)+'</div></details>';
}
V['s-assistant']=()=>{
 saScope();if(!sa.owner)return {bar:staffBar('Staff assistant','Staff sign in required',{back:true}),body:'<div class="content"><button class="btn btn-primary" data-act="staffEntry">Staff sign in</button></div>',tabs:true};
 const rows=saRows(),hidden=Number(sa.counts?.acknowledged??sa.tasks.length-rows.length),top=rows.slice(0,5),rest=rows.slice(5),truncated=sa.totalCount>sa.returnedCount;
 return {bar:staffBar('Staff assistant','Plan, publish and track',{back:true,right:'<button class="btn-text" data-act="saRefresh"'+(sa.loading?' disabled':'')+'>Refresh</button><button class="icon-btn sn-account" data-act="staffMenu" aria-label="Staff account">'+ic('user',18)+'</button>'}),tabs:true,
 body:'<div class="content sa-page"><p class="sa-monitor">'+ic('refresh',15)+' Checks every 5 minutes'+(sa.checkedAt?' · last checked '+esc(new Date(sa.checkedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})):'')+'</p>'+(sa.error?'<section class="notice" role="status">'+esc(sa.error)+'<button class="btn-text" data-act="saRefresh">Retry</button></section>':'')+(!sa.loaded&&!sa.error?'<p role="status" class="meta">Checking saved bookings and session plans…</p>':'')+top.map(saTaskPreview).join('')+(rest.length?'<details class="sa-other-checks" data-sa-more'+(sa.moreOpen?' open':'')+'><summary>Other '+(rest.every(t=>t.kind==='session_attention')?'session ':'')+'checks ('+rest.length+')</summary><div>'+rest.map(saTaskPreview).join('')+'</div></details>':'')+(truncated?'<p class="cap">Showing '+sa.returnedCount+' of '+sa.totalCount+' saved checks, prioritized by urgency. Open Sessions to review the full schedule.</p><button class="btn-text" data-act="go" data-a="s-sessions">All sessions '+ic('right',14)+'</button>':'')+(sa.loaded&&!rows.length?'<section class="card"><h2 class="h3">Nothing needs your attention</h2><p class="meta">New booking changes and published sessions are checked automatically.</p></section>':'')+(hidden?'<p class="cap">'+hidden+' item'+(hidden===1?' is':'s are')+' acknowledged for 24 hours.</p>':'')+'<p class="cap">Drafts stay editable. Any Staff member can review the Forecast and publish. The assistant does not change existing reservations or process real payments.</p></div>',after(){void saLoad();}};
};
TAB_OF['s-assistant']='s-today';if(typeof snRoutes!=='undefined')snRoutes.add('s-assistant');
A.saRefresh=()=>saLoad(true);
async function saAction(action,id){
 saScope();const ctx=sa;if(!ctx.owner||ctx.busy)return;const task=ctx.tasks.find(t=>t.id===id);if(!task)return;
 if(typeof sfBeforeLeave==='function'&&!await sfBeforeLeave())return;
 ctx.busy=id;ctx.error='';render();
 try{if(typeof jhInvalidateSnapshot==='function')jhInvalidateSnapshot();const {data,error}=await sb.rpc('journeyhub_staff_agent',{p_action:action,p_id:id});if(error)throw error;if(!saCurrent(ctx))return;
  if(typeof jhInvalidateSnapshot==='function')jhInvalidateSnapshot();ctx.tasks=data.tasks||[];ctx.counts=data.counts||null;ctx.totalCount=Number(data.totalCount??ctx.tasks.length);ctx.returnedCount=Number(data.returnedCount??ctx.tasks.length);ctx.checkedAt=data.checkedAt;ctx.loaded=true;ctx.last=Date.now();
  if(action==='prepare'){if(!data.planId)throw Error('The draft was not returned. Refresh before trying again.');await jhRefresh();if(!saCurrent(ctx))return;sfSelect(data.planId);go('s-plan',{id:data.planId});toast('Editable draft prepared. Review the Forecast and publish.');}
  else toast('Acknowledged for 24 hours.');
 }catch(error){if(saCurrent(ctx)){ctx.error=jhError(error);toast(ctx.error);}}
 finally{if(saCurrent(ctx)){ctx.busy=null;render();}}
}
A.saPrepare=id=>saAction('prepare',id);A.saAcknowledge=id=>saAction('acknowledge',id);
A.saPlan=async id=>{saScope();const task=sa.tasks.find(t=>t.id===id);if(!task?.planId)return;if(typeof sfBeforeLeave==='function'&&!await sfBeforeLeave())return;sfSelect(task.planId);go('s-plan',{id:task.planId});};
for(const route of ['s-today','s-insights','s-session']){const previous=V[route];if(previous)V[route]=function(){const v=previous.apply(this,arguments);if(route!=='s-session'||me()?.role==='host')v.body=v.body.replace(/(<div class="content[^"]*">)/,'$1'+saCompact());const after=v.after;v.after=function(){if(after)after.apply(this,arguments);void saLoad();};return v;};}
const saPlanView=V['s-plan'];V['s-plan']=function(){const v=saPlanView.apply(this,arguments);saScope();const task=sa.tasks.find(t=>t.planId===sfPlan()?.id);if(task)v.body=v.body.replace(/(<div class="content[^"]*">)/,'$1<div class="sa-linked"><span>'+ic('sparkle',15)+' Assistant is following this session</span><button class="btn-text" data-act="go" data-a="s-assistant">View progress</button></div>');const after=v.after;v.after=function(){if(after)after.apply(this,arguments);void saLoad();};return v;};
// Reconcile immediately after a meaningful plan action, not just after the next timer tick.
for(const name of ['splanSubmit','splanApprove','splanWithdraw']){const prior=A[name];if(prior)A[name]=async function(){await prior.apply(this,arguments);if(saOwner())await saLoad(true);};}
const saPriorApply=jhApply;jhApply=function(){saPriorApply.apply(this,arguments);saScope();};
const saPoll=setInterval(()=>{if(document.visibilityState==='visible'&&state.role==='staff'&&state.route?.startsWith('s-')&&saOwner())void saLoad();},30000);
if(typeof document.addEventListener==='function')document.addEventListener('toggle',event=>{
 const el=event.target;if(!el?.isConnected||el.tagName!=='DETAILS')return;saScope();
 if(el.dataset.saTask){if(el.open)sa.open.add(el.dataset.saTask);else sa.open.delete(el.dataset.saTask);}
 if(el.hasAttribute('data-sa-more'))sa.moreOpen=el.open;
},true);
