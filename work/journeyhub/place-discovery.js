/* Live places are transient provider data, never catalog inventory. */
Object.assign(TAB_OF,{'place-search':'journey','place-plan':'journey'});
const pdFresh=()=>({owner:ag.owner,mode:false,sample:false,busy:false,phase:null,error:'',places:[],wanted:[],skipped:[],undo:[],token:null,expires:0,plan:null,day:'all',version:0,historyId:null,historyError:'',historySaving:false,historyRevision:0,historySavedRevision:0});
let pd=pdFresh(),pdGuest=null;
const pdCurrent=ctx=>pd===ctx&&ctx.owner===ag.owner&&ctx.owner===jhUser?.id;
const pdScope=()=>{if(pd.owner!==ag.owner)pd=pdFresh();};
const pdSafeURL=url=>{try{const u=new URL(url);return u.protocol==='https:'?u.href:'';}catch{return '';}};
function pdSource(p){const url=pdSafeURL(p.sourceURL),label=pd.sample?(/^https:\/\/(?:www\.)?google\.[^/]+\/maps(?:\/|\?)|^https:\/\/maps\.google\./i.test(url)?'Open in Google Maps ↗':'View place details ↗'):p.source==='Amap'?'View on Amap ↗':'View on Google Maps ↗';return '<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>'+p.attributions.map(a=>'<span>'+esc(a.provider)+'</span>').join('');}
async function pdRequest(payload,ctx,timeoutMs=145000){
  const {data,error}=await sb.auth.getSession();if(error)throw error;
  if(!data.session||data.session.user.id!==ctx.owner||!pdCurrent(ctx))throw Error('Please sign in again.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(145000,Math.max(1000,Number(timeoutMs)||145000)));
  try{const response=await fetch(jhConfig.url+'/functions/v1/journeyhub-agent',{method:'POST',headers:{'Content-Type':'application/json',apikey:jhConfig.publishableKey,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(payload),signal:controller.signal});const body=await response.json();if(!response.ok){const error=new Error(body?.error?.message||'Live place search could not complete. Please retry.');error.code=body?.error?.code||String(response.status);throw error;}if(pdCurrent(ctx)&&['history_choices','history_import','discover','discover_plan','discover_revise_apply'].includes(payload.action)&&typeof jhInvalidateSnapshot==='function')jhInvalidateSnapshot();return body;}finally{clearTimeout(timer);}
}
const pdCatalogRequirements=A.jpRequirements;
A.pdCatalog=()=>{if(pd.busy)return;pd.mode=false;pd.error='';pdCatalogRequirements();};
A.pdNewSearch=()=>{if(pd.busy)return;ag.prefs=jpNormalize({...ag.prefs,date:ag.prefs.date<dayISO(0)?dayISO(1):ag.prefs.date,prompt:String(ag.prefs.prompt||'').replace(/^\[Sample\]\s*/,'')});jpSavePrefs();go('journey');};
A.jpRequirements=async()=>{
  if(pd.busy||ag.busy)return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(ag.prefs.date)){ag.error='Choose a travel date.';render();return;}
  const preferences=jpPayload(ag.prefs);if(!preferences)return;
  jpSavePrefs();ag.error='';
  if(!jhUser){pdGuest=JSON.parse(JSON.stringify(ag.prefs));openLogin('traveler',{route:'journey'});return;}
  if(pd.historyId&&typeof thFlushChoices==='function'){
    const previous=pd;previous.busy=true;const saved=await thFlushChoices(previous);if(!pdCurrent(previous))return;previous.busy=false;
    if(!saved){ag.error='Your latest shortlist could not be saved. Please retry before starting another trip.';render();return;}
  }
  const previous=pd,input=JSON.parse(JSON.stringify({...ag.prefs,...preferences,prompt:ag.prefs.prompt.trim()||jpDefaultPrompt}));pd=pdFresh();pd.mode=true;pd.input=input;pd.requestId=previous.owner===pd.owner&&previous.error&&!previous.places.length&&JSON.stringify(previous.input)===JSON.stringify(input)?previous.requestId:crypto.randomUUID();const ctx=pd;ctx.busy=true;ctx.phase='search';go('place-search');
  try{
    // The authenticated search endpoint checks provider configuration itself.
    // A second health request must not hold up the actual search.
    const result=await pdRequest({action:'discover',...ctx.input,requestId:ctx.requestId},ctx);if(!pdCurrent(ctx))return;
    if(!Array.isArray(result.places)||!result.places.length||!result.token)throw Error('No verified places were returned. Please try broader interests.');
    ctx.places=result.places;ctx.missingCategories=result.missingCategories||[];ctx.token=result.token;ctx.expires=result.expires;if(typeof thSavedResult==='function')thSavedResult(ctx,result);
    ctx.busy=false;ctx.phase=null;
    if(state.route==='place-search')go('ai-picks');
    if(Number(result.cardCountShortfall)>0&&Number(result.targetCardCount)>ctx.places.length)toast('Found '+ctx.places.length+' matching places. Try broader interests for more.');
  }catch(error){if(pdCurrent(ctx))ctx.error=agErrorText(error);}
  finally{if(pdCurrent(ctx)){ctx.busy=false;ctx.phase=null;render();}}
};
const pdLogin=doLogin;
doLogin=async function(kind){await pdLogin(kind);if(kind==='traveler-signin'&&pdGuest&&jhUser&&ag.owner===jhUser.id){ag.prefs=jpNormalize(pdGuest);pdGuest=null;jpSavePrefs();go('journey');toast('Your preferences are ready. Choose places next to search.');}};
const pdLogout=signOut;
signOut=async function(){pdGuest=null;pd=pdFresh();return pdLogout();};
// The provider does not report a numeric percentage. This bar is indeterminate
// and stays active only while the actual search or planning request is pending.
function pdWorkingHTML(phase){
  const title=phase==='plan'?'Creating your itinerary.':'Finding your places.';
  return '<section class="jp-working pd-working" aria-busy="true"><span class="ix-orb" aria-hidden="true">'+ic('sparkle',32)+'</span><h1 id="pd-working-title">'+title+'</h1><div class="pd-generation-progress" role="progressbar" aria-labelledby="pd-working-title" aria-valuetext="In progress"><span></span></div></section>';
}
V['place-search']=()=>({bar:bar({title:'Finding your places'}),tabs:true,body:pd.busy?pdWorkingHTML('search'):'<div class="jp-working"><span class="ix-orb">'+ic('sparkle',32)+'</span><h1>Let’s find your places.</h1><p role="alert">'+esc(pd.error||'Ready to find places for your trip.')+'</p><button class="btn btn-primary btn-block" data-act="jpRequirements">Try place search again</button><button class="btn btn-soft btn-block" data-act="pdCatalog">Browse JourneyHub experiences</button></div>'});
const pdPicks=V['ai-picks'];
const pdPhotoStates=new WeakMap(),pdPhotoBound=new WeakSet();
function pdPhotoState(p){
  const urls=[...new Set([p.photo?.url,...(p.photo?.alternatives||[])].map(pdSafeURL).filter(Boolean))],signature=JSON.stringify(urls);
  let photo=pdPhotoStates.get(p);if(!photo||photo.signature!==signature){photo={signature,urls,index:0,loaded:false,preload:null};pdPhotoStates.set(p,photo);}return photo;
}
function pdPhotoHTML(p){
  const photo=pdPhotoState(p),url=photo.urls[photo.index],pending=p.detailsPending&&(pd.snapshotResuming||typeof thSnapshotUpdating==='function'&&thSnapshotUpdating(pd.historyId)),label=url||pending?'Loading photo':'Photo unavailable';
  return '<div class="pd-photo-fallback" aria-label="'+label+'">'+ic('pin',40)+'<span class="pd-photo-label">'+label+'</span></div>'+(url?'<img class="pd-photo" src="'+esc(url)+'" alt="'+esc(p.name)+'" loading="eager" fetchpriority="high" decoding="async" referrerpolicy="no-referrer" draggable="false">':'');
}
function pdBindPhotos(){
  document.querySelectorAll('.pd-simple-picks img.pd-photo').forEach(img=>{
    if(pdPhotoBound.has(img))return;pdPhotoBound.add(img);
    const card=img.closest('article'),place=pd.places.find(p=>p.id===card?.dataset.pickId);if(!place)return;
    const photo=pdPhotoState(place),fallback=card.querySelector('.pd-photo-fallback');
    const loaded=()=>{photo.loaded=true;card.classList.add('pd-photo-ready');if(fallback){fallback.hidden=true;fallback.setAttribute('aria-hidden','true');}};
    const failed=()=>{if(img.hidden||img.complete&&img.naturalWidth)return;const url=img.getAttribute('src');if(photo.urls[photo.index]===url)photo.index++;photo.loaded=false;
      if(photo.urls[photo.index])img.src=photo.urls[photo.index];else{img.hidden=true;card.classList.add('pd-no-photo');if(fallback){fallback.hidden=false;fallback.removeAttribute('aria-hidden');fallback.setAttribute('aria-label','Photo unavailable');fallback.querySelector('.pd-photo-label').textContent='Photo unavailable';}}
    };
    img.addEventListener('load',loaded);img.addEventListener('error',failed);
    if(img.complete&&img.naturalWidth)loaded();else if(img.complete&&img.currentSrc)failed();
  });
  const remaining=pd.places.filter(p=>!pd.wanted.includes(p.id)&&!pd.skipped.includes(p.id));
  for(const p of remaining.slice(1,3)){
    const photo=pdPhotoState(p);if(photo.preload||!photo.urls[photo.index])continue;
    const img=new Image();photo.preload=img;img.referrerPolicy='no-referrer';
    img.onload=()=>{photo.loaded=true;};img.onerror=()=>{if(photo.urls[photo.index]===img.src)photo.index++;if(photo.urls[photo.index])img.src=photo.urls[photo.index];};img.src=photo.urls[photo.index];
  }
}
V['ai-picks']=()=>{
  pdScope();if(!pd.mode)return pdPicks();
  if(pd.busy&&pd.phase==='plan')return {bar:bar({title:'Creating your itinerary'}),tabs:true,body:pdWorkingHTML('plan')};
  const remaining=pd.places.filter(p=>!pd.wanted.includes(p.id)&&!pd.skipped.includes(p.id)),p=remaining[0];
  const details=p?'<details class="pd-card-details"><summary>Place details</summary><p>'+esc(p.reason)+'</p><p>'+esc(p.address)+'</p>'+pdSource(p)+(p.photo?.authors||[]).map(a=>'<small>Photo: '+esc(a.name)+'</small>').join('')+'<button data-act="pdUndo"'+(!pd.undo.length||pd.busy?' disabled':'')+'>Undo last choice</button>'+(pd.sample?'<button data-act="pdNewSearch">Plan my own trip</button>':'')+'</details>':'';
  return {bar:bar({title:pd.sample?'Sample places':'Places for you',right:'<button class="btn-text" data-act="'+(pd.sample?'pdNewSearch':'pdFinish')+'"'+(pd.busy?' disabled':'')+'>'+(pd.sample?'New search':'Done')+'</button>'}),tabs:true,
    body:'<div class="pd-simple-picks jp-swipe-page">'+(p?jpDeckBacks(remaining.length)+'<article class="jp-swipe-card pd-place-card" data-pick-id="'+esc(p.id)+'" tabindex="0" aria-label="'+esc(p.name)+'. Right arrow to keep as must visit, left arrow to skip.">'+pdPhotoHTML(p)+'<div class="jp-card-shade"></div><span class="jp-vote-label want">'+(pd.sample?'LIKE':'MUST VISIT')+'</span><span class="jp-vote-label skip">SKIP</span><div class="jp-card-copy"><h1>'+esc(p.name)+'</h1>'+(typeof pdReviewHTML==='function'?pdReviewHTML(p):'')+'</div></article></div><div class="jp-swipe-actions"><button class="jp-choice skip" data-act="jpPick" data-a="'+esc(p.id)+'" data-b="skip"'+(pd.busy?' disabled':'')+'>'+ic('x',22)+'<span>Skip</span></button><button class="jp-choice want" data-act="jpPick" data-a="'+esc(p.id)+'" data-b="want"'+(pd.busy?' disabled':'')+'>'+ic('heart',22)+'<span>'+(pd.sample?'Like':'Must visit')+'</span></button></div><div class="pd-card-credit">'+esc(p.source||'JourneyHub')+(p.photo?.authors?.length?' · Photo: '+p.photo.authors.map(a=>esc(a.name)).join(', '):'')+'</div>'+(!pd.sample?'<p class="ix-note">Must visit keeps this place in your plan. Skip excludes it. Tap Done to leave unreviewed places optional.</p>':'')+details:'<div class="jp-picks-complete"><span>'+ic('check',32)+'</span><h1>Your shortlist is ready.</h1><p>'+pd.wanted.length+' must-visit places</p><button class="btn-text" data-act="pdReset">Choose again</button></div>')+(pd.missingCategories?.length?'<details class="pd-card-details"><summary>No suitable matches for: '+pd.missingCategories.map(esc).join(', ')+'</summary><p>Try broader interests in a new search.</p></details>':'')+(pd.error?'<p class="pd-error" role="alert">'+esc(pd.error)+'</p>'+(typeof agConflictLink==='function'?agConflictLink(pd.error):''):'')+'</div>',
    foot:!p||pd.busy?'<div class="foot"><button class="btn btn-primary btn-block" data-act="'+(pd.sample?'pdNewSearch':'pdFinish')+'"'+(pd.busy?' disabled':'')+'>'+ic('sparkle',17)+(pd.sample?'Plan my own trip':pd.busy?'Planning your route…':'Create my plan')+'</button></div>':'',after:pdBindPhotos};
};
const pdPick=A.jpPick;
A.jpPick=(id,vote)=>{if(!pd.mode)return pdPick(id,vote);if(pd.busy||!['want','skip'].includes(vote)||!pd.places.some(p=>p.id===id)||pd.wanted.includes(id)||pd.skipped.includes(id))return;jpChoiceMotion(id,vote);pd.plan=null;pd.error='';pd.undo.push(id);pd[vote==='want'?'wanted':'skipped'].push(id);if(typeof thQueueChoices==='function')thQueueChoices(pd);render();};
A.pdUndo=()=>{if(pd.busy||!pd.undo.length)return;pd.plan=null;pd.error='';const id=pd.undo.pop();pd.wanted=pd.wanted.filter(x=>x!==id);pd.skipped=pd.skipped.filter(x=>x!==id);if(typeof thQueueChoices==='function')thQueueChoices(pd);render();};
A.pdReset=()=>{if(pd.busy)return;pd.plan=null;pd.error='';pd.wanted=[];pd.skipped=[];pd.undo=[];if(typeof thQueueChoices==='function')thQueueChoices(pd);render();};
A.pdFinish=async()=>{
  const ctx=pd;if(ctx.busy||!ctx.token)return;
  if(ctx.sample){ctx.error='This sample is read-only. Start a new search to create your own itinerary.';render();return;}
  if(ctx.expires<=Date.now()){ctx.error='This search expired. Start a new search with your preferences.';go('place-search');return;}
  const days=Number(ctx.input?.days)||1,eligible=ctx.places.some(p=>!p.unavailable&&!ctx.skipped.includes(p.id));
  if(!eligible){ctx.error='Keep at least one place available. Undo a skip or choose again.';render();return;}
  ctx.busy=true;ctx.phase='plan';ctx.error='';render();
  try{if(typeof thFlushChoices==='function')await thFlushChoices(ctx);if(!pdCurrent(ctx))return;const result=await pdRequest({action:'discover_plan',token:ctx.token,wanted:ctx.wanted,skipped:ctx.skipped},ctx);if(!pdCurrent(ctx))return;if(!result.plan?.stops?.length)throw Error('No usable itinerary was returned. Please retry.');if(Number(result.plan.days)!==days||(!result.plan.agent?.checked&&!Array.from({length:days},(_,i)=>i+1).every(day=>result.plan.stops.some(s=>s.dayIndex===day))))throw Error('Your itinerary needs a stop on every day. Please try creating it again.');if(ctx.wanted.some(id=>!result.plan.stops.some(s=>s.id===id))||result.plan.stops.some(s=>ctx.skipped.includes(s.id)))throw Error('The itinerary did not respect your shortlist. Please try again.');ctx.plan=result.plan;ctx.day='all';if(typeof thSavedResult==='function')thSavedResult(ctx,result);if(typeof calWeatherPrefetch==='function')void calWeatherPrefetch({city:ctx.plan.city||ctx.input?.city,date:ctx.plan.date||ctx.input?.date,days:ctx.plan.days});if(state.route==='ai-picks')go('place-plan');}
  catch(e){if(pdCurrent(ctx))ctx.error=agErrorText(e);}
  finally{if(pdCurrent(ctx)){ctx.busy=false;ctx.phase=null;if(ctx.plan&&!ctx.error&&state.route==='place-plan'){go('orders');if(typeof calSelect==='function')calSelect(ctx.plan.date||ctx.input.date);}else render();}}
};
A.pdDay=value=>{pd.mapStop=null;pd.day=value==='all'?'all':Number(value);render();};
V['place-plan']=()=>{
  pdScope();const p=pd.plan;if(!p)return V['place-search']();
  const days=Array.from({length:p.days},(_,i)=>i+1).filter(i=>pd.day==='all'||pd.day===i);
  return {bar:bar({title:pd.sample?'Sample itinerary':'Your self-guided trip'}),tabs:true,body:'<div class="content pd-plan"><span class="jr-eyebrow">'+(pd.sample?'SAMPLE ITINERARY':'AI ITINERARY')+' · '+esc(p.city)+'</span><h1>'+agDate(p.date)+'</h1><p>'+esc(p.summary)+'</p><div class="jr-days"><button data-act="pdDay" data-a="all" aria-pressed="'+(pd.day==='all')+'">All days</button>'+Array.from({length:p.days},(_,i)=>'<button data-act="pdDay" data-a="'+(i+1)+'" aria-pressed="'+(pd.day===i+1)+'">Day '+(i+1)+'</button>').join('')+'</div>'+days.map(day=>'<section><h2>Day '+day+'</h2>'+p.stops.filter(s=>s.dayIndex===day).map(s=>(s.travel?'<p class="pd-transfer">'+s.travel.durationMinutes+' min '+esc(s.travel.mode)+' · estimated transfer</p>':'')+'<article class="pd-stop"><small>'+esc(s.start)+'–'+esc(s.end)+' · suggested</small><h3>'+esc(s.name)+'</h3><p>'+esc(s.reason)+'</p><p>'+esc(s.address)+'</p>'+pdSource(s)+(s.openingHours.length?'<details><summary>Regular opening hours</summary>'+s.openingHours.map(h=>'<p>'+esc(h)+'</p>').join('')+'<small>Not confirmation for your travel date.</small></details>':'<small>Opening hours not supplied. Check before visiting.</small>')+'</article>').join('')+(p.stops.some(s=>s.dayIndex===day)?'':'<p>Free time · no stops scheduled.</p>')+'</section>').join('')+'<p class="pd-attribution">'+(pd.sample?'JourneyHub sample catalog':'Place data: '+esc((pd.places||[])[0]?.source||'Google Maps'))+'</p><p class="ix-note">'+esc(p.notice)+'</p><p class="ix-note">Self-guided itinerary · No tickets or reservations.</p><button class="btn btn-soft btn-block" data-act="pdCatalog">Explore bookable JourneyHub experiences</button><button class="btn-text" data-act="go" data-a="ai-picks">'+(pd.sample?'Try sample cards':'Edit my shortlist')+'</button></div>'};
};
const pdHome=V.journey;
V.journey=()=>{const view=pdHome();pdScope();if(pd.mode&&pd.places.length)view.body+='<div class="jh-home-below"><button class="jh-home-link" data-act="go" data-a="'+(pd.plan?'place-plan':'ai-picks')+'">'+ic('globe',18)+(pd.sample?' Continue sample trip ':' Continue live trip ')+ic('right',15)+'</button></div>';return view;};
const pdRender=render;
let pdSwipeRendered=null;
function pdSwipeSnapshot(){
  if(state.route!=='ai-picks'||ag.busy||pd.busy||(typeof scrollTop!=='undefined'&&scrollTop))return null;
  const card=document.querySelector('#app .jp-swipe-card');if(!card)return null;
  const view=V['ai-picks'](),scope=typeof inputStableScope==='function'?inputStableScope():JSON.stringify([state.route,state.params,state.role,jhUser?.id,ag.owner]);
  // Photo attempts are local loading state, not a changed view. Keep the same
  // connected card on autosave/poll completion; do not replay entry animation,
  // restart image requests or cancel a pointer gesture in progress.
  const body=view.body.replace(/<div class="pd-photo-fallback"[\s\S]*?(?=<div class="jp-card-shade">)/g,'<div class="pd-photo-state"></div>').replace(/<div class="th-save-status\b[\s\S]*?<\/div>/g,'');
  const key=JSON.stringify([scope,ag.owner,view.bar,body,view.foot,typeof tabbar==='function'?tabbar():'',typeof ui==='undefined'?null:[ui.sheet,ui.toast],pd.mode?pd.places.map(p=>[p.id,p.photo]):null]);
  return {key,card,context:pd,view};
}
function pdRefreshSaveBadge(view){
  const template=document.createElement('template');template.innerHTML=view.body;
  const nextPhoto=template.content.querySelector('.pd-photo-fallback'),currentPhoto=document.querySelector('#app .pd-photo-fallback');
  if(nextPhoto&&currentPhoto&&!document.querySelector('#app img.pd-photo')){currentPhoto.setAttribute('aria-label',nextPhoto.getAttribute('aria-label'));currentPhoto.querySelector('.pd-photo-label').textContent=nextPhoto.querySelector('.pd-photo-label').textContent;}
  const next=template.content.querySelector('.th-save-status'),current=document.querySelector('#app .th-save-status');
  if(current?.outerHTML===next?.outerHTML)return;
  if(current){if(next)current.replaceWith(next);else current.remove();}
  else if(next)document.querySelector('#app .pd-simple-picks')?.before(next);
}
render=function(){
  if(pd.owner!==ag.owner)pd=pdFresh();
  const before=pdSwipeSnapshot();
  if(before&&pdSwipeRendered?.context===pd&&before.card===pdSwipeRendered.card&&before.key===pdSwipeRendered.key){pdRefreshSaveBadge(before.view);if(typeof jhDrawStatus==='function')jhDrawStatus();return;}
  pdRender();if(pd.owner!==ag.owner)pd=pdFresh();pdSwipeRendered=pdSwipeSnapshot();
};
