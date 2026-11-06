/* Preview a new itinerary version before applying it. Reservations are independent. */
TAB_OF['plan-editor']='journey';
let pe=null;
const peCurrent=ctx=>pe===ctx&&pd===ctx.discovery&&pdCurrent(pd)&&pd.historyId===ctx.historyId&&pd.plan===ctx.basePlan;
document.addEventListener('toggle',event=>{if(event.target.isConnected&&event.target.matches?.('.pe-preferences')&&pe&&peCurrent(pe))pe.preferencesOpen=event.target.open;},true);
const pePlace=(ctx,id)=>ctx.discovery.places.find(place=>place.id===id&&!place.unavailable);
const peInput=p=>({city:p.city,date:p.date,days:p.days,guests:p.guests,prompt:String(p.prompt||'').slice(0,1200),dayStart:p.dayStart,dayEnd:p.dayEnd,transport:p.transport,...jpBudgetFields(p)});
const peMoney=minor=>'CNY '+(Number(minor)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function peEstimateHTML(plan){
 const estimate=plan?.estimate;if(estimate?.currency!=='CNY'||!Number.isFinite(estimate.totalMinor)||estimate.totalMinor<0)return '';
 const budget=Number.isFinite(estimate.budgetCnyMinor)?'<small class="pe-budget-status">Group budget '+peMoney(estimate.budgetCnyMinor)+(estimate.budgetExceeded?' · Over budget':'')+'</small>':'';
 return '<div class="pe-estimate"><span>Activities & dining estimate <small>Entire group · illustrative virtual credits</small>'+(estimate.incomplete?'<small>Some prices unavailable</small>':'')+budget+'</span><strong>'+peMoney(estimate.totalMinor)+'</strong></div>';
}
function peResetPreview(){if(!pe)return;pe.preview=null;pe.revisionToken=null;pe.error='';pe.requestId=null;pe.applyRequestId=null;}
A.peStart=()=>{
 if(pd.busy||!pd.plan)return;
 if(pd.sample||!pd.historyId){toast(pd.sample?'Start your own trip to edit this sample.':'Save this trip before editing it.');return;}
 pe={discovery:pd,historyId:pd.historyId,basePlan:pd.plan,input:peInput(jpNormalize({...pd.input,...pd.plan,prompt:pd.input?.prompt||''})),stops:pd.plan.stops.map(s=>({id:s.id,dayIndex:s.dayIndex})),preferencesOpen:false,preview:null,revisionToken:null,busy:false,error:'',requestId:null,applyRequestId:null};
 go('plan-editor');
};
A.peCancel=()=>{if(pe?.busy)return;pe=null;go('place-plan');};
A.peBack=()=>{if(pe?.busy)return;peResetPreview();scrollTop=true;render();};
A.peRemove=id=>{if(!pe||pe.busy)return;const row=pe.stops.find(s=>s.id===id);if(!row||pe.stops.filter(s=>s.dayIndex===row.dayIndex).length<=1)return;pe.stops=pe.stops.filter(s=>s.id!==id);peResetPreview();render();};
A.peMove=(id,direction)=>{if(!pe||pe.busy)return;const index=pe.stops.findIndex(s=>s.id===id),other=index+(direction==='up'?-1:1);if(index<0||!pe.stops[other]||pe.stops[other].dayIndex!==pe.stops[index].dayIndex)return;[pe.stops[index],pe.stops[other]]=[pe.stops[other],pe.stops[index]];peResetPreview();render();};
CHANGES.peReplace=el=>{if(!pe||pe.busy)return;const row=pe.stops.find(s=>s.id===el.dataset.stop),place=pePlace(pe,el.value);if(!row||!place||pe.stops.some(s=>s.id===place.id&&s!==row))return;row.id=place.id;peResetPreview();render();};
CHANGES.peOption=el=>{if(!pe||pe.busy)return;const key=el.dataset.key;if(!['dayStart','dayEnd','transport','guests','budgetCurrency','budgetScope'].includes(key))return;pe.input[key]=key==='guests'?Number(el.value):el.value;peResetPreview();};
INPUTS.pePrompt=value=>{if(pe&&!pe.busy){pe.input.prompt=String(value).slice(0,1200);peResetPreview();}};
INPUTS.peBudget=value=>{if(pe&&!pe.busy){pe.input.budgetAmount=value===''?null:Number(value);peResetPreview();}};
function peValidate(ctx){
 const days=Number(ctx.input.days),ids=new Set();
 for(const row of ctx.stops){if(!pePlace(ctx,row.id)||ids.has(row.id)||!Number.isInteger(row.dayIndex)||row.dayIndex<1||row.dayIndex>days)return 'Choose each available place only once.';ids.add(row.id);}
 if(!Array.from({length:days},(_,i)=>i+1).every(day=>ctx.stops.some(s=>s.dayIndex===day)))return 'Keep at least one place on every day.';
 const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;if(!time.test(ctx.input.dayStart)||!time.test(ctx.input.dayEnd)||ctx.input.dayStart>=ctx.input.dayEnd)return 'Choose an end time after the start time.';
 if(!Number.isInteger(ctx.input.guests)||ctx.input.guests<1||ctx.input.guests>6)return 'Choose 1–6 guests.';
 const budget=jpBudgetFields(ctx.input);if(budget.budgetAmount!==null&&(!Number.isFinite(budget.budgetAmount)||budget.budgetAmount<=0||budget.budgetAmount>1000000))return 'Enter a budget above 0, or leave it blank.';
 return '';
}
A.pePreview=async()=>{
 const ctx=pe;if(!ctx||ctx.busy||!peCurrent(ctx))return;ctx.error=peValidate(ctx);if(ctx.error){render();return;}
 ctx.busy=true;ctx.phase='preview';ctx.requestId||=crypto.randomUUID();render();
 try{
  const result=await pdRequest({action:'discover_revise',historyId:ctx.historyId,stops:ctx.stops.map(s=>({id:s.id,dayIndex:s.dayIndex})),input:peInput(ctx.input),requestId:ctx.requestId},ctx.discovery);if(!peCurrent(ctx))return;
  if(!result.revisionToken||!result.plan?.stops?.length||Number(result.plan.days)!==Number(ctx.input.days)||!Array.from({length:Number(ctx.input.days)},(_,i)=>i+1).every(day=>result.plan.stops.some(s=>s.dayIndex===day)))throw Error('The revised itinerary could not be previewed. Please retry.');
  ctx.preview=result.plan;ctx.revisionToken=result.revisionToken;ctx.applyRequestId=crypto.randomUUID();scrollTop=true;
 }catch(error){if(peCurrent(ctx))ctx.error=agErrorText(error);}
 finally{if(peCurrent(ctx)){ctx.busy=false;render();}}
};
A.peApply=async()=>{
 const ctx=pe;if(!ctx||ctx.busy||!ctx.preview||!ctx.revisionToken||!peCurrent(ctx))return;ctx.busy=true;ctx.phase='apply';ctx.error='';render();
 try{
  const result=await pdRequest({action:'discover_revise_apply',historyId:ctx.historyId,revisionToken:ctx.revisionToken,requestId:ctx.applyRequestId},ctx.discovery);if(!peCurrent(ctx))return;
  if(!result.plan?.stops?.length||(result.historyId&&result.historyId!==ctx.historyId))throw Error('The saved revision could not be loaded. Please retry.');
  const current=ctx.discovery;current.plan=result.plan;current.input=result.input||peInput(ctx.input);current.day='all';current.mapStop=null;
  if(result.token)current.token=result.token;if(result.expires)current.expires=result.expires;
  current.wanted=result.wanted||result.plan.stops.map(s=>s.id);if(result.skipped)current.skipped=result.skipped;
  if(typeof thSavedResult==='function')thSavedResult(current,{...result,historyId:ctx.historyId});
  if(typeof dw!=='undefined'&&dw.owner===current.owner&&dw.quotes)delete dw.quotes['history:'+ctx.historyId];
  if(typeof cal!=='undefined'&&cal.owner===current.owner)cal.details[ctx.historyId]={loading:false,error:'',plan:current.plan};
  // A prior care snapshot must not overwrite the new plan while its fresh
  // server state loads. SQL retains the existing reservations independently.
  if(typeof tc!=='undefined'&&tc.owner===current.owner){tc.loadVersion++;tc.trips=tc.trips.filter(trip=>trip.sourceType!=='history'||trip.sourceId!==ctx.historyId);tc.loaded=false;tc.loading=false;}
  ag.prefs=jpNormalize(current.input);jpSavePrefs();pe=null;go('place-plan');toast('Itinerary updated. Existing reservations are unchanged.');
  if(typeof thReloadAfterRevision==='function')thReloadAfterRevision(current.owner);
  if(typeof tcLoad==='function')void tcLoad(true);
 }catch(error){if(peCurrent(ctx)){
  if(['SEARCH_EXPIRED','EDIT_STALE','PLAN_EDIT_STALE','EDIT_INVALID'].includes(error?.code)){ctx.preview=null;ctx.revisionToken=null;ctx.applyRequestId=null;ctx.requestId=null;ctx.error='This preview expired or the saved itinerary changed. Preview your edits again before applying.';}
  else ctx.error=agErrorText(error);
 }}
 finally{if(peCurrent(ctx)){ctx.busy=false;render();}}
};
function pePreferencesHTML(ctx){
 const p=ctx.input,budget=jpBudgetHTML(p).replaceAll('data-in="jpBudget"','data-in="peBudget"').replace('data-ch="jpBudgetCurrency"','data-ch="peOption" data-key="budgetCurrency"').replace('data-ch="jpBudgetScope"','data-ch="peOption" data-key="budgetScope"');
 return '<details class="pe-preferences"'+(ctx.preferencesOpen?' open':'')+'><summary>Preferences & budget</summary><div class="pe-options"><label>Start each day<input type="time" data-ch="peOption" data-key="dayStart" value="'+esc(p.dayStart)+'"></label><label>Finish by<input type="time" data-ch="peOption" data-key="dayEnd" value="'+esc(p.dayEnd)+'"></label><label>Getting around<select data-ch="peOption" data-key="transport"><option value="drive"'+(p.transport==='drive'?' selected':'')+'>Car / taxi</option><option value="walk"'+(p.transport==='walk'?' selected':'')+'>Walking</option></select></label><label>Guests<select data-ch="peOption" data-key="guests">'+[1,2,3,4,5,6].map(n=>'<option value="'+n+'"'+(p.guests===n?' selected':'')+'>'+n+'</option>').join('')+'</select></label>'+budget+'<label class="pe-prompt">Other preferences (optional)<textarea data-in="pePrompt" maxlength="1200" rows="3">'+esc(p.prompt)+'</textarea></label></div></details>';
}
V['plan-editor']=()=>{
 const ctx=pe;if(!ctx||!peCurrent(ctx))return {bar:bar({title:'Edit itinerary'}),tabs:true,body:'<div class="content"><p>Open a saved itinerary to edit it.</p><button class="btn btn-primary" data-act="go" data-a="trip-history">Trip history</button></div>'};
 const preview=ctx.preview,days=Array.from({length:ctx.input.days},(_,i)=>i+1),rows=preview?.stops||ctx.stops;
 const content=days.map(day=>{const dayRows=rows.filter(s=>s.dayIndex===day);return '<section class="pe-day"><h2>Day '+day+'</h2>'+dayRows.map((stop,index)=>{
  const place=pePlace(ctx,stop.id)||stop;
  if(preview)return '<article class="pe-preview-stop"><strong>'+esc(stop.start)+'–'+esc(stop.end)+'</strong><span>'+esc(stop.name||place.name||'Unavailable place')+'</span>'+(stop.travel?'<small>'+Number(stop.travel.durationMinutes||0)+' min transfer · '+esc(stop.travel.mode||ctx.input.transport)+'</small>':'')+'</article>';
  const options=ctx.discovery.places.filter(p=>!p.unavailable&&(p.id===stop.id||!ctx.stops.some(s=>s.id===p.id)));
  const missing=!options.some(p=>p.id===stop.id)?'<option value="'+esc(stop.id)+'" selected disabled>Unavailable place · choose a replacement</option>':'';
  return '<article class="pe-stop"><label>Place '+(index+1)+'<select data-ch="peReplace" data-stop="'+esc(stop.id)+'" aria-label="Replace '+esc(place.name||'place')+'">'+missing+options.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===stop.id?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label><div class="pe-stop-actions"><button data-act="peMove" data-a="'+esc(stop.id)+'" data-b="up"'+(!index?' disabled':'')+' aria-label="Move '+esc(place.name||'place')+' earlier">↑ Earlier</button><button data-act="peMove" data-a="'+esc(stop.id)+'" data-b="down"'+(index===dayRows.length-1?' disabled':'')+' aria-label="Move '+esc(place.name||'place')+' later">↓ Later</button><button data-act="peRemove" data-a="'+esc(stop.id)+'"'+(dayRows.length===1?' disabled':'')+'>Remove</button></div></article>';
 }).join('')+'</section>';}).join('');
 return {bar:bar({title:preview?'Review changes':'Edit itinerary',right:'<button class="btn-text" data-act="peCancel"'+(ctx.busy?' disabled':'')+'>Cancel</button>'}),tabs:true,body:'<main class="pe-page"><p class="pe-context">'+esc(ctx.input.city)+' · '+agDate(ctx.input.date)+'</p><p class="pe-booking-note">Existing reservations stay unchanged.</p>'+(ctx.error?'<p class="pd-error" role="alert">'+esc(ctx.error)+'</p>':'')+'<fieldset class="pe-fields"'+(ctx.busy?' disabled':'')+'>'+(!preview?pePreferencesHTML(ctx):peEstimateHTML(preview))+content+'</fieldset>'+(ctx.busy?'<div class="pe-pending" role="status">'+(ctx.phase==='apply'?'Saving your revision…':'Updating times, routes & costs…')+'</div>':'')+'<div class="pe-bottom"><button class="btn btn-primary btn-block" data-act="'+(preview?'peApply':'pePreview')+'"'+(ctx.busy?' disabled':'')+'>'+(preview?'Apply changes':'Preview changes')+'</button>'+(preview?'<button class="btn-text" data-act="peBack"'+(ctx.busy?' disabled':'')+'>Keep editing</button>':'')+'</div></main>'};
};
const pePlanView=V['place-plan'];
V['place-plan']=()=>{
 const view=pePlanView();if(!pd.plan)return view;const template=document.createElement('template');template.innerHTML=view.body;
 const title=template.content.querySelector('.tu-title');if(title&&!pd.sample&&pd.historyId){const edit=title.querySelector('.tu-edit');if(edit){edit.dataset.act='peStart';delete edit.dataset.a;edit.setAttribute('aria-label','Edit itinerary');edit.setAttribute('title','Edit itinerary');}}
 const estimate=peEstimateHTML(pd.plan);if(estimate)template.content.querySelector('.tu-title')?.insertAdjacentHTML('afterend',estimate);
 const visibleStops=pd.plan.stops.filter(s=>pd.day==='all'||s.dayIndex===pd.day);template.content.querySelectorAll('.pd-stop').forEach((el,index)=>{const stop=visibleStops[index],cost=pd.plan.estimate?.items?.find(item=>item.stopId===stop?.id);if(cost&&Number.isFinite(cost.totalMinor))el.insertAdjacentHTML('beforeend','<p class="pe-stop-cost">Illustrative group cost <strong>'+(cost.kind==='unavailable'?'Unavailable':peMoney(cost.totalMinor))+'</strong></p>');});
 view.body=template.innerHTML;return view;
};

