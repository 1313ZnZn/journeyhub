/* Durable traveler planning. This adapter never sends a reservation or payment action. */
const ptuPendingKey=owner=>'journeyhub-planner-task-'+owner;
const ptuFresh=owner=>({owner,epoch:0,task:null,binding:null,waiter:null,timer:null,checking:false,restored:false,polls:0,failures:0,error:'',logOpen:false});
let ptu=ptuFresh(null);
const ptuActive=task=>task&&['queued','running'].includes(task.status);
const ptuCurrent=ctx=>ptu===ctx&&ctx.owner===(jhUser?.id||null)&&ctx.owner===ag.owner;
const ptuWorkingRoute=()=>['place-search','ai-picks'].includes(state.route)&&pd.busy;
function ptuHint(owner,value){try{if(value)localStorage.setItem(ptuPendingKey(owner),value);else localStorage.removeItem(ptuPendingKey(owner));}catch{}}
function ptuReadHint(owner){try{return localStorage.getItem(ptuPendingKey(owner));}catch{return null;}}
function ptuRetire(ctx){clearTimeout(ctx.timer);ctx.epoch++;if(ctx.waiter){ctx.waiter.reject(Object.assign(Error('Your planning task continues in your account.'),{code:'PLANNER_DETACHED'}));ctx.waiter=null;}}
function ptuScope(){const owner=jhUser?.id||null;if(ptu.owner!==owner){ptuRetire(ptu);ptu=ptuFresh(owner);}return ptu;}
function ptuRender(ctx){if(!ptuCurrent(ctx))return;if(ptuWorkingRoute()||state.route==='journey'&&!document.querySelector('#ag-prompt:focus'))render();}
async function ptuHTTP(payload,ctx){
  if(!ptuCurrent(ctx))throw Error('Please sign in again.');
  const {data,error}=await sb.auth.getSession();if(error)throw error;
  if(!data.session||data.session.user.id!==ctx.owner||!ptuCurrent(ctx))throw Error('Please sign in again.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  try{const response=await fetch(jhConfig.url+'/functions/v1/journeyhub-agent',{method:'POST',headers:{'Content-Type':'application/json',apikey:jhConfig.publishableKey,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(payload),signal:controller.signal});const body=await response.json();if(!response.ok){const e=Error(body?.error?.message||'The saved task could not be checked. Try again.');e.code=body?.error?.code||String(response.status);throw e;}return body;}
  finally{clearTimeout(timer);}
}
function ptuError(task){return Object.assign(Error(task.error?.message||task.message||(task.status==='needs_input'?'Your preferences need a little more information.':'The agent needs another attempt.')),{code:task.error?.code||'PLANNER_NEEDS_ATTENTION'});}
function ptuValidate(task){if(!task||typeof task.id!=='string'||!['discover','discover_plan'].includes(task.kind)||!['queued','running','completed','needs_input','failed'].includes(task.status))throw Error('The saved planning task is incomplete. Try checking again.');return task;}
function ptuStore(ctx,task){
  if(!ptuCurrent(ctx))return false;ptuValidate(task);
  if(ctx.task?.id===task.id&&Date.parse(ctx.task.updatedAt||'')>Date.parse(task.updatedAt||''))return false;
  ctx.task=task;ctx.error='';ctx.failures=0;
  if(ptuActive(task))ptuHint(ctx.owner,task.id);
  if(ctx.binding&&pdCurrent(ctx.binding)){ctx.binding.plannerTask=task;ctx.binding.plannerTaskId=task.id;}
  if(!ptuActive(task)&&ctx.waiter){const waiter=ctx.waiter;ctx.waiter=null;clearTimeout(ctx.timer);if(task.status==='completed'){if(typeof jhInvalidateSnapshot==='function')jhInvalidateSnapshot();ptuHint(ctx.owner,null);waiter.resolve(task.result);}else waiter.reject(ptuError(task));}
  return true;
}
function ptuSchedule(ctx){
  clearTimeout(ctx.timer);if(!ptuCurrent(ctx)||!ptuActive(ctx.task))return;
  ctx.timer=setTimeout(()=>{if(document.visibilityState==='hidden'){ptuSchedule(ctx);return;}void ptuPoll(ctx);},3000);
}
async function ptuPoll(ctx=ptu){
  if(!ptuCurrent(ctx)||ctx.checking||!ctx.task?.id)return;
  const id=ctx.task.id,epoch=ctx.epoch;ctx.checking=true;
  try{const {task}=await ptuHTTP({action:'planner_status',id},ctx);if(!ptuCurrent(ctx)||epoch!==ctx.epoch||ctx.task?.id!==id)return;
    ptuStore(ctx,task);ctx.polls++;ptuRender(ctx);
  }catch(e){if(ptuCurrent(ctx)&&epoch===ctx.epoch){ctx.failures++;ctx.error=agErrorText(e);if(ctx.failures>=3&&ctx.waiter){const waiter=ctx.waiter;ctx.waiter=null;waiter.reject(Error('Your task is saved and can continue in the background. Check its progress again.'));}ptuRender(ctx);}}
  finally{if(ptuCurrent(ctx)&&epoch===ctx.epoch){ctx.checking=false;if(ctx.failures<3)ptuSchedule(ctx);}}
}
function ptuWait(ctx){return new Promise((resolve,reject)=>{ctx.waiter={resolve,reject};if(ctx.task&&!ptuActive(ctx.task)){const task=ctx.task;ctx.waiter=null;task.status==='completed'?resolve(task.result):reject(ptuError(task));}else ptuSchedule(ctx);});}
const ptuPreviousRequest=pdRequest;
pdRequest=async function(payload,discovery,timeoutMs){
  if(!['discover','discover_plan'].includes(payload.action))return ptuPreviousRequest(payload,discovery,timeoutMs);
  const ctx=ptuScope();if(!ptuCurrent(ctx)||!pdCurrent(discovery))throw Error('Please sign in again.');
  ptuRetire(ctx);ctx.binding=discovery;ctx.task=null;ctx.error='';ctx.failures=0;ctx.polls=0;ctx.restored=true;ctx.checking=false;discovery.plannerTask=null;
  const fingerprint=JSON.stringify(payload);
  if(discovery.plannerFingerprint!==fingerprint){discovery.plannerFingerprint=fingerprint;discovery.plannerRequestId=payload.requestId||crypto.randomUUID();}
  const epoch=ctx.epoch;
  let {task}=await ptuHTTP({action:'planner_start',kind:payload.action,requestId:discovery.plannerRequestId,payload},ctx);
  if(!ptuCurrent(ctx)||epoch!==ctx.epoch||!pdCurrent(discovery))throw Error('Your saved task continues in your account.');
  ptuStore(ctx,task);ptuRender(ctx);
  return ptuWait(ctx);
};
const ptuPreviousWorking=pdWorkingHTML;
function ptuSteps(task){
  const rows=[];
  for(const event of (task.events||[])){if(typeof event.summary!=='string'||!event.summary.trim())continue;const summary=event.summary.trim();if(rows.at(-1)?.summary===summary)continue;rows.push({summary,done:['tool_result','completed'].includes(event.kind)});}
  const recent=rows.slice(-3),message=String(task.message||'').trim();
  if(message&&!recent.some(e=>e.summary===message))recent.push({summary:message,done:false});
  return recent.slice(-4);
}
pdWorkingHTML=function(phase){
  const task=pd.plannerTask,kind=phase==='plan'?'discover_plan':'discover';
  // The page renders before planner_start resolves. Only the active task bound
  // to this exact discovery and phase may supply its progress message.
  if(!ptuCurrent(ptu)||!pdCurrent(pd)||ptu.binding!==pd||!ptuActive(task)||task.kind!==kind||task.id!==pd.plannerTaskId||task.id!==ptu.task?.id)return ptuPreviousWorking(phase);
  const title=phase==='plan'?'Creating your itinerary.':'Finding your places.',steps=ptuSteps(task);
  return '<section class="jp-working pd-working ptu-working" aria-busy="true"><span class="ix-orb" aria-hidden="true">'+ic('sparkle',32)+'</span><h1 id="pd-working-title">'+title+'</h1><div class="pd-generation-progress" role="progressbar" aria-labelledby="pd-working-title" aria-valuetext="'+esc(task.message||'In progress')+'"><span></span></div>'+(steps.length?'<section class="ptu-steps" aria-label="Agent activity"><h2>Agent activity</h2><ol aria-live="polite">'+steps.map(e=>'<li class="'+(e.done?'is-done':'is-current')+'"><span class="ptu-step-icon" aria-label="'+(e.done?'Completed':'In progress')+'">'+(e.done?ic('check',16):'<i></i>')+'</span><span>'+esc(e.summary)+'</span></li>').join('')+'</ol></section>':'<p class="ptu-current" role="status">Your saved task is queued.</p>')+(ptu.error?'<p class="pd-error" role="alert">'+esc(ptu.error)+'</p><button class="btn-text" data-act="ptuCheck">Check progress</button>':'')+'</section>';
};
document.addEventListener('toggle',event=>{if(event.target?.classList?.contains('ptu-log'))ptu.logOpen=event.target.open;},true);
async function ptuApply(task,discovery){
  if(!pdCurrent(discovery))return;const result=task.result||{};
  if(task.kind==='discover'){
    if(!Array.isArray(result.places)||!result.places.length||!result.token)throw Error('No verified places were returned. Try broader interests.');
    Object.assign(discovery,{places:result.places,token:result.token,expires:result.expires,missingCategories:result.missingCategories||[],plan:null});
  }else{
    const days=Number(task.input?.days)||Number(result.plan?.days)||1;
    if(!result.plan?.stops?.length||Number(result.plan.days)!==days||!Array.from({length:days},(_,i)=>i+1).every(day=>result.plan.stops.some(s=>s.dayIndex===day)))throw Error('The itinerary is incomplete. Check the saved task again.');
    if(!discovery.token&&result.historyId){
      try{const restored=await ptuPreviousRequest({action:'history_open',id:result.historyId},discovery);if(!pdCurrent(discovery))return;Object.assign(discovery,{places:restored.places||result.plan.stops,token:restored.token,expires:restored.expires,wanted:restored.wanted||[],skipped:restored.skipped||[]});}catch{/* The saved itinerary still opens; metadata can be refreshed from history. */}
    }
    discovery.plan=result.plan;discovery.day='all';if(!discovery.places.length)discovery.places=result.places||result.plan.stops;
  }
  if(!pdCurrent(discovery))return;discovery.busy=false;discovery.phase=null;discovery.error='';
  if(typeof thSavedResult==='function')thSavedResult(discovery,result);if(task.kind==='discover_plan'&&typeof calWeatherPrefetch==='function')void calWeatherPrefetch({city:discovery.plan.city||task.input?.city,date:discovery.plan.date||task.input?.date,days:discovery.plan.days});if(typeof jhInvalidateSnapshot==='function')jhInvalidateSnapshot();ptuHint(discovery.owner,null);
}
async function ptuOpenTask({retry=false}={}){
  const ctx=ptuScope();if(!ptuCurrent(ctx)||!ctx.task||ctx.waiter)return;
  const task=ctx.task,existing=pdCurrent(pd)&&pd.plannerTaskId===task.id?pd:null;
  if(!existing&&pdCurrent(pd)&&pd.historyId&&typeof thFlushChoices==='function'&&!await thFlushChoices(pd))return;
  if(!ptuCurrent(ctx))return;
  const discovery=existing||pdFresh();pd=discovery;Object.assign(discovery,{mode:true,input:task.input||discovery.input||{},plannerTask:task,plannerTaskId:task.id,error:'',busy:true,phase:task.kind==='discover_plan'?'plan':'search'});ctx.binding=discovery;
  // Explicitly opening a task is the only resume action that changes the route.
  go(task.kind==='discover_plan'?'ai-picks':'place-search');
  try{
    if(retry){const response=await ptuHTTP({action:'planner_retry',id:task.id},ctx);if(!ptuCurrent(ctx)||!pdCurrent(discovery))return;ptuStore(ctx,response.task);}
    else if(ptuActive(task)){await ptuPoll(ctx);if(!ptuCurrent(ctx)||!pdCurrent(discovery))return;}
    if(ptuActive(ctx.task))await ptuWait(ctx);
    if(!ptuCurrent(ctx)||!pdCurrent(discovery))return;
    if(ctx.task.status!=='completed')throw ptuError(ctx.task);
    await ptuApply(ctx.task,discovery);if(!pdCurrent(discovery))return;
    if(['place-search','ai-picks'].includes(state.route))go(ctx.task.kind==='discover_plan'?'place-plan':'ai-picks');
  }catch(e){if(pdCurrent(discovery))discovery.error=agErrorText(e);}
  finally{if(pdCurrent(discovery)){discovery.busy=false;discovery.phase=null;render();}}
}
A.ptuOpen=()=>ptuOpenTask();
A.ptuRetry=()=>ptu.task?.status==='needs_input'?A.ptuEdit():ptuOpenTask({retry:true});
A.ptuEdit=()=>{const task=ptuCurrent(ptu)&&ptu.task;if(!task||pd.busy)return;if(task.input){ag.prefs=jpNormalize({...ag.prefs,...task.input});jpSavePrefs();}go('journey');};
A.ptuCheck=()=>{ptu.failures=0;return ptuPoll();};
function ptuTaskEntry(){
  const task=ptuCurrent(ptu)&&ptu.task;if(!task||task.status==='completed'&&pd.plannerTaskId===task.id)return '';
  const label=ptuActive(task)?'Your agent is working':task.status==='completed'?(task.kind==='discover_plan'?'Your itinerary is ready':'Your places are ready'):'Your agent needs attention';
  return '<button class="ptu-resume" data-act="ptuOpen">'+ic('sparkle',18)+'<span>'+label+'</span>'+ic('right',16)+'</button>';
}
const ptuJourney=V.journey;
V.journey=()=>{const view=ptuJourney();const entry=ptuTaskEntry();if(entry)view.body+='<div class="jh-home-below ptu-home">'+entry+'</div>';return view;};
for(const route of ['place-search','ai-picks']){
  const previous=V[route];V[route]=()=>{const view=previous(),task=pd.plannerTask;
    if(!pd.busy&&pd.error&&task&&ptu.task?.id===task.id&&['failed','needs_input'].includes(task.status)){
      const needsInput=task.status==='needs_input',action=needsInput?'ptuEdit':'ptuRetry',label=needsInput?'Edit trip preferences':'Continue saved task';
      if(route==='place-search')view.body=view.body.replace('data-act="jpRequirements"','data-act="'+action+'"').replace('Try place search again',label);
      else if(view.foot)view.foot=view.foot.replace('data-act="pdFinish"','data-act="'+action+'"').replace('Create my plan',label);
      else view.body+='<div class="ptu-retry"><button class="btn btn-soft btn-block" data-act="'+action+'">'+label+'</button></div>';
      if(!needsInput)view.body+='<div class="ptu-retry"><button class="btn-text" data-act="ptuEdit">Edit trip preferences</button></div>';
    }
    return view;};
}
async function ptuRestore(ctx){
  if(!ptuCurrent(ctx)||ctx.restored||ctx.checking||!ctx.owner||typeof traveler==='function'&&!traveler())return;
  ctx.restored=true;ctx.checking=true;const epoch=ctx.epoch,hint=ptuReadHint(ctx.owner);
  try{let response;try{response=await ptuHTTP({action:'planner_status',...(hint?{id:hint}:{})},ctx);}catch(e){if(!hint||!['404','PLANNER_NOT_FOUND','TASK_NOT_FOUND'].includes(e.code))throw e;ptuHint(ctx.owner,null);response=await ptuHTTP({action:'planner_status'},ctx);}
    if(!ptuCurrent(ctx)||epoch!==ctx.epoch)return;if(response.task){ptuStore(ctx,response.task);ptuSchedule(ctx);ptuRender(ctx);}
  }catch(e){if(ptuCurrent(ctx)&&epoch===ctx.epoch)ctx.error=agErrorText(e);}
  finally{if(ptuCurrent(ctx)&&epoch===ctx.epoch)ctx.checking=false;}
}
const ptuPreviousRender=render;
render=function(){ptuPreviousRender();const ctx=ptuScope();if(ctx.owner&&!ctx.restored)Promise.resolve().then(()=>ptuRestore(ctx));};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){const ctx=ptuScope();if(ptuActive(ctx.task))void ptuPoll(ctx);else if(!ctx.restored)void ptuRestore(ctx);}});
