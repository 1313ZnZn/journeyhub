/* Account-owned saved displays open first; live place refresh never blocks them. */
TAB_OF['trip-history']='home';
const thFresh=owner=>({owner,items:[],cursor:null,loaded:false,loading:false,error:'',retry:null,opening:null,openVersion:0,hydrated:new Map(),hydrating:new Map(),refreshes:new Map()});
let th=thFresh(jhUser?.id||null),thLastRoute=state.route;
const thCurrent=ctx=>th===ctx&&ctx.owner===(jhUser?.id||null);
function thScope(){const owner=jhUser?.id||null;if(th.owner!==owner)th=thFresh(owner);else thPruneHydration(th);}
const thCopy=value=>JSON.parse(JSON.stringify(value));
const thRevision=(ctx,id)=>ctx.items.find(item=>item.id===id)?.updatedAt||'';
const thRemoved=id=>typeof cmHidden==='function'&&cmHidden('history',id);
function thForgetHydration(ctx,id,{calendar=true,preserveRefresh=false}={}){
  if(id){ctx.hydrated.delete(id);ctx.hydrating.delete(id);}else{ctx.hydrated.clear();ctx.hydrating.clear();}
  for(const [key,request]of ctx.refreshes)if(!id||key===id){if(preserveRefresh){request.metadataOnly=true;}else{clearTimeout(request.timer);ctx.refreshes.delete(key);}}
  if(calendar&&typeof cal!=='undefined'&&cal.owner===ctx.owner){if(id)delete cal.details[id];else{cal.details={};cal.detailVersion++;}}
}
const thCanonical=value=>Array.isArray(value)?value.map(thCanonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,thCanonical(value[key])])):value;
const thScheduleKey=result=>JSON.stringify(thCanonical([result.input,result.plan?{city:result.plan.city,date:result.plan.date,days:result.plan.days,transport:result.plan.transport,summary:result.plan.summary,stops:result.plan.stops?.map(s=>[s.id,s.dayIndex,s.start,s.end,s.reason])}:null,[...(result.wanted||[])].sort(),[...(result.skipped||[])].sort()]));
function thSnapshotVisible(id){return ['place-plan','ai-picks'].includes(state.route)&&pdCurrent(pd)&&pd.historyId===id||state.route==='orders'&&typeof cal!=='undefined'&&cal.owner===(jhUser?.id||null)&&!!cal.details[id]?.plan;}
function thSamePlaces(discovery,result){return JSON.stringify(thCanonical(discovery.input))===JSON.stringify(thCanonical(result.input))&&JSON.stringify(discovery.places.map(p=>p.id).sort())===JSON.stringify(result.places.map(p=>p.id).sort());}
function thSnapshotPublish(ctx,id,result,baseline,metadataOnly=false){
  if(!thCurrent(ctx)||thRemoved(id))return;
  // Updating venue information must not revise a schedule, shortlist or editor.
  const currentPlan=pdCurrent(pd)&&pd.historyId===id&&thScheduleKey({input:pd.input,plan:pd.plan,wanted:pd.wanted,skipped:pd.skipped})===baseline;
  const editing=state.route==='plan-editor'||typeof pe!=='undefined'&&pe?.discovery===pd;
  let published=false;
  if(currentPlan&&!metadataOnly&&!editing&&!pd.busy&&!pd.historySaving&&!pd.historyTimer&&(pd.historyRevision||0)===(pd.historySavedRevision||0)){
    pd.places=thCopy(result.places);pd.plan=result.plan?thCopy(result.plan):null;pd.token=result.token;pd.expires=result.expires;pd.unavailablePlaceIds=result.unavailablePlaceIds||[];pd.snapshot=result.snapshot||null;
    published=true;
  }else if(pdCurrent(pd)&&pd.historyId===id&&thSamePlaces(pd,result)){
    // Like/Skip and the editor may change while venue metadata is loading.
    // Enrich those same IDs without restoring a cleared plan or old choices.
    const lookup=new Map(result.places.map(p=>[p.id,p]));
    pd.places=pd.places.map(place=>{const fresh=lookup.get(place.id);return fresh.detailsPending&&!place.detailsPending?place:thCopy(fresh);});
    if(!pd.plan)pd.snapshot=result.snapshot||null;
  }
  if(!metadataOnly&&typeof cal!=='undefined'&&cal.owner===ctx.owner&&cal.details[id]?.plan&&result.plan){const record=cal.details[id];record.plan=thCopy(result.plan);record.snapshot=result.snapshot||null;}
  return published;
}
function thQueueSnapshotRefresh(ctx,id,result,{force=false,reopen=false}={}){
  if(!thCurrent(ctx)||thRemoved(id)||!result?.snapshot?.refreshNeeded&&!force)return;
  const revision=thRevision(ctx,id),key=JSON.stringify([revision,result.snapshot?.savedAt||'']),previous=ctx.refreshes.get(id);
  if(previous&&(previous.status==='queued'||previous.status==='refreshing'||!force&&!reopen&&previous.key===key))return;
  if(previous)clearTimeout(previous.timer);
  const request={key,revision,status:'queued',error:'',timer:null,result:thCopy(result),baseline:thScheduleKey(result)};ctx.refreshes.set(id,request);
  // Let history/calendar render the DB snapshot before any provider work starts.
  request.timer=setTimeout(async()=>{
    if(!thCurrent(ctx)||ctx.refreshes.get(id)!==request||thRemoved(id)||thRevision(ctx,id)!==revision)return;
    if(!thSnapshotVisible(id)){ctx.refreshes.delete(id);return;}
    request.status='refreshing';if(thSnapshotVisible(id))render();
    try{
      request.allCandidates=state.route==='ai-picks'&&pdCurrent(pd)&&pd.historyId===id;
      const fresh=await thRequest({action:'history_refresh',id,...(request.allCandidates?{allCandidates:true}:{})},ctx);
      if(!thCurrent(ctx)||ctx.refreshes.get(id)!==request||thRemoved(id)||thRevision(ctx,id)!==revision)return;
      if(!fresh.input||!Array.isArray(fresh.places)||!fresh.token||(fresh.historyId&&fresh.historyId!==id)||fresh.updatedAt&&revision&&fresh.updatedAt!==revision||thScheduleKey(fresh)!==request.baseline)throw Error('This itinerary changed. Reopen it to see the latest version.');
      if(!request.metadataOnly)thRememberHydration(ctx,id,fresh,revision);
      if(thSnapshotPublish(ctx,id,fresh,request.baseline,request.metadataOnly)){request.publishedFor=pd;request.publishedPlan=pd.plan;}
      request.completed=true;request.status=fresh.snapshot?.stale?'error':'done';request.error=fresh.snapshot?.stale?'Some place details could not refresh.':'';request.result=thCopy(fresh);
      if(pdCurrent(pd)&&pd.historyId===id&&thSamePlaces(pd,fresh)&&!pd.places.some(p=>p.detailsPending))pd.snapshotChoicesDirty=false;
    }catch(error){if(thCurrent(ctx)&&ctx.refreshes.get(id)===request){request.status='error';request.error=agErrorText(error);}}
    finally{if(thCurrent(ctx)&&ctx.refreshes.get(id)===request){if(thSnapshotVisible(id))render();if(pdCurrent(pd)&&pd.historyId===id)void thResumeChoiceDetails(pd);}}
  },0);
  while(ctx.refreshes.size>8){const oldest=ctx.refreshes.keys().next().value;if(oldest===id)break;clearTimeout(ctx.refreshes.get(oldest).timer);ctx.refreshes.delete(oldest);}
}
function thSnapshotUpdating(id){return thCurrent(th)&&['queued','refreshing'].includes(th.refreshes.get(id)?.status);}
function thSnapshotHTML(id){
  const request=th.refreshes.get(id);if(!request||!thCurrent(th))return '';
  if(['queued','refreshing'].includes(request.status))return '<p class="th-snapshot-status fine" role="status">Saved itinerary · Updating place details…</p>';
  if(request.status==='error')return '<p class="th-snapshot-status fine" role="status">Saved itinerary · Place details could not refresh. <button class="btn-text" data-act="thRefreshDetails" data-a="'+esc(id)+'">Retry update</button></p>';
  return '';
}
A.thRefreshDetails=id=>{thScope();const ctx=th,result=ctx.hydrated.get(id)?.result||ctx.refreshes.get(id)?.result;if(result)thQueueSnapshotRefresh(ctx,id,result,{force:true});};
function thConsumeSnapshot(){
  if(!pdCurrent(pd)||!pd.historyId||!['place-plan','ai-picks'].includes(state.route))return;
  const request=th.refreshes.get(pd.historyId);
  if((request?.status==='done'||request?.completed)&&!request.metadataOnly&&(request.publishedFor!==pd||request.publishedPlan!==pd.plan)&&thScheduleKey({input:pd.input,plan:pd.plan,wanted:pd.wanted,skipped:pd.skipped})===request.baseline&&thSnapshotPublish(th,pd.historyId,request.result,request.baseline)){
    request.publishedFor=pd;request.publishedPlan=pd.plan;
  }
  // Returning from the plan to unselected cards needs their live metadata too.
  if(state.route==='ai-picks'&&pd.places.some(p=>p.detailsPending)&&(request?.status==='done'||request?.completed)&&!request.allCandidates){pd.snapshotChoicesDirty=true;void thResumeChoiceDetails(pd);}
}
async function thResumeChoiceDetails(discovery){
  if(!pdCurrent(discovery)||state.route!=='ai-picks'||!discovery.snapshotChoicesDirty||discovery.snapshotResuming||discovery.busy||discovery.historySaving||discovery.historyTimer)return;
  const request=th.refreshes.get(discovery.historyId);if(request&&['queued','refreshing'].includes(request.status))return;
  const revision=discovery.historySavedRevision||0;if(discovery.snapshotResumeRevision===revision)return;
  discovery.snapshotResumeRevision=revision;discovery.snapshotChoicesDirty=false;discovery.snapshotResuming=true;
  try{await thHydrate(discovery.historyId,{force:true});}catch{/* Keep visible names/choices; a subsequent user change or explicit reopen can retry. */}
  finally{if(pdCurrent(discovery)){discovery.snapshotResuming=false;void thResumeChoiceDetails(discovery);}}
}
function thPruneHydration(ctx){
  for(const [id,entry]of ctx.hydrated){
    if(thRemoved(id)){thForgetHydration(ctx,id);continue;}
    if(entry.until<=Date.now())ctx.hydrated.delete(id);
  }
  for(const id of ctx.hydrating.keys())if(thRemoved(id))thForgetHydration(ctx,id);
}
function thHydrationVersion(ctx,id){
  const revision=thRevision(ctx,id),entry=ctx.hydrated.get(id),pending=ctx.hydrating.get(id);
  if((entry&&entry.revision!==revision)||(pending&&pending.revision!==revision))thForgetHydration(ctx,id);
  return revision;
}
function thRememberHydration(ctx,id,result,revision=thRevision(ctx,id)){
  if(!thCurrent(ctx)||thRemoved(id)||!result?.input||!Array.isArray(result.places)||!result.token||(result.historyId&&result.historyId!==id))return;
  const expires=Number(result.expires),now=Date.now();if(!Number.isFinite(expires)||expires<=now+5000)return;
  ctx.hydrated.delete(id);ctx.hydrated.set(id,{revision,until:Math.min(now+60000,expires-5000),result:thCopy({...result,historyId:id})});
  while(ctx.hydrated.size>8)ctx.hydrated.delete(ctx.hydrated.keys().next().value);
}
// Provider responses stay in this signed-in browser session for at most a
// minute. Calendar and Map & details share both the response and pending read.
// None of this data is persisted or used to authorize booking/payment.
async function thHydrate(id,{force=false}={}){
  thScope();const ctx=th;if(!ctx.owner||thRemoved(id))throw Error('This saved trip is unavailable. Refresh your trips.');
  if(force)thForgetHydration(ctx,id,{calendar:false});
  const revision=thHydrationVersion(ctx,id),cached=ctx.hydrated.get(id);
  if(cached){thQueueSnapshotRefresh(ctx,id,cached.result);return thCopy(cached.result);}
  const current=ctx.hydrating.get(id);if(current)return thCopy(await current.promise);
  const request={revision,promise:null};
  request.promise=(async()=>{
    const result=await thRequest({action:'history_open',id},ctx);
    if(!thCurrent(ctx)||ctx.hydrating.get(id)!==request||thRevision(ctx,id)!==revision||thRemoved(id))throw Error('This saved trip changed. Please open it again.');
    // If the service reports a newer saved revision, update the summary used
    // for future cache comparisons. The full schedule still comes from it.
    if(result.updatedAt){const row=ctx.items.find(item=>item.id===id);if(row)row.updatedAt=result.updatedAt;}
    thRememberHydration(ctx,id,result,thRevision(ctx,id));thQueueSnapshotRefresh(ctx,id,result,{reopen:true});return result;
  })().finally(()=>{if(ctx.hydrating.get(id)===request)ctx.hydrating.delete(id);});
  ctx.hydrating.set(id,request);return thCopy(await request.promise);
}
function thInvalidate(id,options){thScope();th.loaded=false;if(id)thForgetHydration(th,id,options);}
function thReloadAfterRevision(owner){
  thScope();if(th.owner!==owner)return;
  // Retire in-flight list/open callbacks from before the save, while retaining
  // the visible rows until the authoritative first page is refreshed.
  const items=th.items;th=thFresh(owner);th.items=items;void thLoad();
}
async function thRequest(payload,ctx){
  const {data,error}=await sb.auth.getSession();if(error)throw error;
  if(!data.session||data.session.user.id!==ctx.owner||!thCurrent(ctx))throw Error('Please sign in again to see your trips.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  try{const response=await fetch(jhConfig.url+'/functions/v1/journeyhub-agent',{method:'POST',headers:{'Content-Type':'application/json',apikey:jhConfig.publishableKey,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(payload),signal:controller.signal});const body=await response.json();if(!response.ok){const error=new Error(body?.error?.message||'Your trip history could not load. Please retry.');error.code=body?.error?.code||String(response.status);throw error;}return body;}finally{clearTimeout(timer);}
}
function thSavedResult(ctx,result){
  ctx.historyId=result.historyId||null;ctx.historyError=result.historyError?String(result.historyError):ctx.historyId?'':'This trip has not been saved yet.';
  if(ctx.historyId)ctx.historySavedRevision=ctx.historyRevision||0;
  thInvalidate(ctx.historyId);
  if(ctx.historyId&&pdCurrent(ctx)){
    const restored={historyId:ctx.historyId,input:ctx.input,places:ctx.places,token:ctx.token,expires:ctx.expires,plan:ctx.plan||null,wanted:ctx.wanted||[],skipped:ctx.skipped||[],sample:ctx.sample===true,unavailablePlaceIds:ctx.unavailablePlaceIds||[],...result};
    if(restored.updatedAt){const row=th.items.find(item=>item.id===ctx.historyId);if(row)row.updatedAt=restored.updatedAt;}
    thRememberHydration(th,ctx.historyId,restored);
  }
}
function thQueueChoices(ctx){
  if(ctx.snapshot?.refreshNeeded||ctx.places.some(p=>p.detailsPending))ctx.snapshotChoicesDirty=true;
  if(ctx.historyId&&th.owner===ctx.owner)thForgetHydration(th,ctx.historyId,{preserveRefresh:true});
  ctx.historyRevision=(ctx.historyRevision||0)+1;clearTimeout(ctx.historyTimer);
  ctx.historyTimer=setTimeout(()=>{ctx.historyTimer=null;void thFlushChoices(ctx);},450);
}
async function thFlushChoices(ctx){
  clearTimeout(ctx.historyTimer);ctx.historyTimer=null;
  if(!pdCurrent(ctx)||!ctx.historyId)return false;
  if(ctx.historyPending){await ctx.historyPending;return pdCurrent(ctx)&&ctx.historySavedRevision===ctx.historyRevision;}
  if((ctx.historySavedRevision||0)===(ctx.historyRevision||0))return true;
  ctx.historySaving=true;
  ctx.historyPending=(async()=>{
    try{
      while(pdCurrent(ctx)&&(ctx.historySavedRevision||0)!==(ctx.historyRevision||0)){
        const revision=ctx.historyRevision;
        await pdRequest({action:'history_choices',id:ctx.historyId,wanted:[...ctx.wanted],skipped:[...ctx.skipped]},ctx);
        if(!pdCurrent(ctx))return false;
        ctx.historySavedRevision=revision;ctx.historyError='';thInvalidate(ctx.historyId,{preserveRefresh:true});
      }
      return true;
    }catch(error){if(pdCurrent(ctx))ctx.historyError=agErrorText(error);return false;}
    finally{if(pdCurrent(ctx)){ctx.historySaving=false;ctx.historyPending=null;render();void thResumeChoiceDetails(ctx);}}
  })();
  return ctx.historyPending;
}
async function thSaveCurrent(ctx=pd){
  if(!pdCurrent(ctx)||!ctx.token||ctx.historySaving||ctx.busy)return;
  if(ctx.historyId&&ctx.historyRevision!==ctx.historySavedRevision){await thFlushChoices(ctx);return;}
  if(ctx.sample)return;
  ctx.historySaving=true;ctx.busy=true;ctx.historyError='';render();
  try{
    const revision=ctx.historyRevision||0;
    // Import only our itinerary structure, never provider names, images or coordinates.
    const plan=ctx.plan?{summary:ctx.plan.summary,stops:ctx.plan.stops.map(s=>({id:s.id,dayIndex:s.dayIndex,start:s.start,end:s.end,reason:s.reason}))}:undefined;
    const result=await pdRequest({action:'history_import',token:ctx.token,plan,wanted:[...ctx.wanted],skipped:[...ctx.skipped]},ctx);
    if(!pdCurrent(ctx))return;if(!result.historyId)throw Error('Your trip could not be saved. Please retry.');thSavedResult(ctx,result);ctx.historySavedRevision=revision;
  }catch(error){if(pdCurrent(ctx))ctx.historyError=agErrorText(error);}
  finally{if(pdCurrent(ctx)){ctx.historySaving=false;ctx.busy=false;render();if(ctx.historyId&&ctx.historyRevision!==ctx.historySavedRevision)void thFlushChoices(ctx);}}
}
A.thSave=()=>thSaveCurrent();
A.thSignIn=()=>openLogin('traveler',{route:'trip-history'});
async function thLoad(more=false){
  thScope();const ctx=th;if(!ctx.owner||ctx.loading||(more&&!ctx.cursor))return;
  const cursor=more?ctx.cursor:null;ctx.loading=true;ctx.error='';ctx.retry=null;render();
  try{
    const result=await thRequest({action:'history_list',limit:20,...(cursor?{cursor}:{})},ctx);if(!thCurrent(ctx))return;
    if(!Array.isArray(result.items))throw Error('Your trip history could not load. Please retry.');
    const items=more?[...ctx.items,...result.items]:result.items,seen=new Set();ctx.items=items.filter(item=>item?.id&&!seen.has(item.id)&&seen.add(item.id));ctx.cursor=result.nextCursor||null;ctx.loaded=true;
    for(const item of result.items)thHydrationVersion(ctx,item.id);
  }catch(error){if(thCurrent(ctx)){ctx.error=agErrorText(error);ctx.retry={more};}}
  finally{if(thCurrent(ctx)){ctx.loading=false;render();}}
}
A.thRefresh=()=>{thScope();thForgetHydration(th);return thLoad();};A.thMore=()=>thLoad(true);
A.thRetry=()=>th.retry?.id?A.thOpen(th.retry.id):thLoad(!!th.retry?.more);
A.thOpen=async (id,options={})=>{
  thScope();const ctx=th;if(!ctx.owner||ctx.opening||pd.historySaving&&!pd.historyPending||!ctx.items.some(item=>item.id===id))return;
  const origin=state.route;if(!['trip-history','orders'].includes(origin))return;
  const version=++ctx.openVersion;ctx.opening=id;ctx.error='';ctx.retry=null;render();
  try{
    if(pdCurrent(pd)&&pd.historyId&&!await thFlushChoices(pd))throw Error('Your latest shortlist could not be saved. Please retry before opening another trip.');
    if(!thCurrent(ctx)||ctx.openVersion!==version||state.route!==origin)return;
    const result=await thHydrate(id);
    if(!thCurrent(ctx)||ctx.openVersion!==version||state.route!==origin)return;
    if(!result.input||!Array.isArray(result.places)||!result.token)throw Error('This saved trip could not open. Please retry.');
    const restored=pdFresh();restored.mode=true;restored.sample=result.sample===true;restored.input=JSON.parse(JSON.stringify(result.input));restored.places=result.places;restored.token=result.token;restored.expires=result.expires;restored.historyId=result.historyId||id;restored.wanted=Array.isArray(result.wanted)?result.wanted:[];restored.skipped=Array.isArray(result.skipped)?result.skipped:[];restored.plan=result.plan||null;restored.unavailablePlaceIds=result.unavailablePlaceIds||[];restored.snapshot=result.snapshot||null;
    if(restored.plan&&Number.isInteger(options.day)&&options.day>=1&&options.day<=(Number(restored.plan.days)||Number(result.input.days)||1))restored.day=options.day;
    pd=restored;ag.prefs=jpNormalize(result.input);jpSavePrefs();ctx.opening=null;go(restored.plan?'place-plan':'ai-picks',origin==='orders'?{fromCalendar:true}:undefined);
  }catch(error){if(thCurrent(ctx)&&ctx.openVersion===version){ctx.error=agErrorText(error);ctx.retry={id};}}
  finally{if(thCurrent(ctx)&&ctx.openVersion===version){ctx.opening=null;render();}}
};
function thDate(value){const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function thRelated(){return '<div class="th-related"><button data-act="go" data-a="journey-drafts">'+ic('sparkle',18)+'<span>Draft trips<small>JourneyHub experience plans</small></span>'+ic('right',16)+'</button><button data-act="go" data-a="reserved-trips">'+ic('calendar',18)+'<span>Your reservations<small>Confirmed and pending bookings</small></span>'+ic('right',16)+'</button></div>';}
V['trip-history']=()=>{
  thScope();const ctx=th;
  const header='<div class="th-heading"><span class="jr-eyebrow">YOUR JOURNEYS</span><h1>Trip history</h1><p>Your searches and AI itineraries, saved to your account.</p></div>';
  if(!ctx.owner)return {bar:bar({title:'Trip history'}),tabs:true,body:'<div class="content th-page">'+header+'<div class="th-empty">'+ic('globe',34)+'<h2>Keep your next adventure.</h2><p>Sign in to save searches and reopen your trips on any device.</p><button class="btn btn-primary btn-block" data-act="thSignIn">Sign in</button></div>'+thRelated()+'</div>'};
  const live=pdCurrent(pd)&&pd.mode&&pd.token&&!pd.historyId;
  const visible=ctx.items.filter(item=>!cmHidden('history',item.id));
  const rows=visible.map(item=>{const input=item.input||{},planned=item.status==='itinerary',sample=String(input.prompt||'').startsWith('[Sample]'),opening=ctx.opening===item.id;return '<article class="cm-history-row"><button class="th-card" data-act="thOpen" data-a="'+esc(item.id)+'"'+(ctx.opening?' disabled':'')+'><span class="th-card-icon">'+ic(planned?'calendar':'search',22)+'</span><span class="th-card-copy"><span class="th-card-top"><strong>'+esc(input.city||'Your trip')+'</strong><span class="th-state '+(sample?'sample':planned?'planned':'')+'">'+(sample?(planned?'Sample itinerary':'Sample search'):(planned?'Itinerary':'Search'))+'</span></span><span class="th-trip-date">'+esc(agDate(input.date))+' · '+(Number(input.days)||1)+' '+(Number(input.days)===1?'day':'days')+' · '+(planned?Number(item.stopCount)||0:Number(item.placeCount)||0)+' places</span><span class="th-prompt">'+esc(String(input.prompt||'Travel ideas').replace(/^\[Sample\]\s*/,''))+'</span><span class="th-saved-date">'+(opening?'Opening your saved trip…':'Saved '+esc(thDate(item.createdAt)))+'</span></span><span class="th-card-arrow">'+ic('right',18)+'</span></button><div class="cm-history-actions">'+cmActionButton('history',item.id)+'</div></article>';}).join('');
  return {bar:bar({title:'Trip history',right:'<button class="btn-text" data-act="thRefresh"'+(ctx.loading?' disabled':'')+'>Refresh</button>'}),tabs:true,body:'<div class="content th-page">'+header+(live?'<div class="th-live"><div><strong>Keep the trip you have open</strong><p>Save this session’s search or itinerary before closing it.</p></div><button class="btn btn-soft" data-act="thSave"'+(pd.historySaving?' disabled':'')+'>'+(pd.historySaving?'Saving…':'Save trip')+'</button>'+(pd.historyError?'<p role="alert">'+esc(pd.historyError)+'</p>':'')+'</div>':'')+(ctx.error?'<div class="th-error" role="alert"><p>'+esc(ctx.error)+'</p><button class="btn-text" data-act="thRetry">Retry</button></div>':'')+'<div class="th-list">'+rows+'</div>'+(ctx.loading?'<div class="th-loading" role="status">Loading your trips…</div>':!visible.length&&!ctx.error?'<div class="th-empty">'+ic('globe',36)+'<h2>Your next trip starts here.</h2><p>Search for places in Journey. Your searches and generated itineraries will appear here automatically.</p><button class="btn btn-primary btn-block" data-act="go" data-a="journey">Plan a trip</button></div>':'')+(ctx.cursor&&!ctx.loading?'<button class="btn btn-soft btn-block th-more" data-act="thMore">Load older trips</button>':'')+thRelated()+'<p class="th-history-note">Trips created before automatic saving may only be available if that session is still open.</p></div>',after:()=>{if(!ctx.loaded&&!ctx.loading&&!ctx.error&&thCurrent(ctx))void thLoad();}};
};
function thBadge(ctx){
  if(!ctx.token)return '';
  const dirty=(ctx.historyRevision||0)!==(ctx.historySavedRevision||0),saving=ctx.historySaving||!!ctx.historyTimer;
  const saved=!!ctx.historyId&&!ctx.historyError&&!dirty;
  return '<div class="th-save-status '+(saved?'saved':saving?'saving':'unsaved')+'" role="status"><span>'+ic(saved?'check':'cloud',16)+' '+(ctx.sample?'Sample · ':'')+(saving?'Saving changes…':saved?(ctx.sample?'Saved':'Saved to Trip history'):ctx.historyId?'Changes not saved':'Not saved yet')+'</span>'+(saving?'':saved?'<button data-act="go" data-a="trip-history">View history</button>':'<button data-act="thSave">Retry save</button>')+(ctx.historyError&&!saving?'<small>'+esc(ctx.historyError)+'</small>':'')+'</div>';
}
function thSampleHTML(ctx,withAction=false){return ctx.sample?'<aside class="th-sample" aria-label="Sample trip"><strong>Sample itinerary</strong><p>JourneyHub sample catalog · Illustrative places and visit times. No live search or reservations.</p>'+(withAction?'<button data-act="pdNewSearch">Plan my own trip '+ic('right',15)+'</button>':'')+'</aside>':'';}
const thPicks=V['ai-picks'];V['ai-picks']=()=>{const view=thPicks();if(pd.mode&&pd.token&&pd.historyError)view.body=thBadge(pd)+view.body;return view;};
const thPlan=V['place-plan'];V['place-plan']=()=>{
  const view=thPlan();if(!pd.plan)return view;
  const template=document.createElement('template');template.innerHTML=view.body;const title=template.content.querySelector('.tu-title'),root=template.content.querySelector('.pd-plan');
  if(title){title.insertAdjacentHTML('afterend',thBadge(pd));const scroll=template.content.querySelector('.tu-sheet-scroll'),notes=scroll?.querySelector('.tu-trip-details');if(notes)notes.insertAdjacentHTML('beforebegin',thSampleHTML(pd,true));else scroll?.insertAdjacentHTML('beforeend',thSampleHTML(pd,true));}else if(root)root.insertAdjacentHTML('afterbegin',thBadge(pd)+thSampleHTML(pd,true));
  if(pd.unavailablePlaceIds?.length){const body=template.content.querySelector('.tu-sheet-scroll')||root;body?.insertAdjacentHTML('afterbegin','<p class="th-unavailable" role="status">Some place details are currently unavailable. Your original itinerary and visit times are preserved.</p>');}
  (template.content.querySelector('.tu-sheet-scroll')||root)?.insertAdjacentHTML('afterbegin',thSnapshotHTML(pd.historyId));
  view.body=template.innerHTML;return view;
};
const thRender=render;render=function(){
  thScope();if(thLastRoute!==state.route){if(['trip-history','orders'].includes(thLastRoute)){th.openVersion++;th.opening=null;}if(pdCurrent(pd)&&pd.historyId&&pd.historyTimer)void thFlushChoices(pd);thLastRoute=state.route;}
  thConsumeSnapshot();
  thRender();thScope();
};
