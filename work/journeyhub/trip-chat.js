/* One conversational entry for an account-owned trip; changes require review. */
const tchEntries=new Map();let tchOwner=null;
// One lightweight guide character, shared by the entry, header and replies.
function tchAvatar(size=''){
  return '<span class="tch-avatar '+size+'" aria-hidden="true"><svg viewBox="0 0 80 80" fill="none" focusable="false"><circle cx="40" cy="40" r="36" fill="currentColor" opacity=".12"/><path d="M16 69c1-14 10-22 24-22s23 8 24 22" fill="currentColor"/><path d="M27 50l26 21" stroke="#223126" stroke-width="7"/><rect x="20" y="20" width="41" height="35" rx="17" fill="#F2EBDD"/><path d="M22 29c-1-16 32-22 37-2l-1 5c-12-6-24-6-36-3Z" fill="currentColor"/><path d="M20 29c12-5 27-5 41 3" stroke="#26342A" stroke-width="3" stroke-linecap="round"/><path d="m39 16 2 4 4 1-4 2-1 4-2-4-4-1 4-2Z" fill="#26342A"/><g class="tch-avatar-eyes" fill="#26342A"><ellipse cx="33" cy="38" rx="2.5" ry="3.5"/><ellipse cx="48" cy="38" rx="2.5" ry="3.5"/></g><path d="M35 45q6 5 12 0" stroke="#26342A" stroke-width="2.4" stroke-linecap="round"/><circle cx="26" cy="43" r="3" fill="#E7BBA4" opacity=".7"/><circle cx="54" cy="43" r="3" fill="#E7BBA4" opacity=".7"/><path d="M34 54l7 6 7-6" fill="#F2EBDD"/><g class="tch-avatar-hand"><path d="M58 63q11-4 10-19" stroke="currentColor" stroke-width="9" stroke-linecap="round"/><path d="M66 45l-1-7m4 7 1-9m-1 10 5-6" stroke="#F2EBDD" stroke-width="4" stroke-linecap="round"/></g><path d="m64 10 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#EFC46C"/></svg></span>';
}
function tchEntryIdentity(opening=false){return tchAvatar('tch-avatar-entry')+'<span class="tch-entry-copy"><strong>'+(opening?'Opening trip agent…':'Trip agent')+'</strong><span>Your personal travel assistant</span></span><span class="tch-entry-cta" aria-hidden="true"><span>Chat</span>'+ic('right',17)+'</span>';}
function tchHeader(trip,day){return '<header class="bar tch-header"><button class="icon-btn" data-act="back" aria-label="Back">'+ic('left',22)+'</button>'+tchAvatar('tch-avatar-header')+'<div class="bar-t"><span class="bar-title">Trip agent</span><span class="bar-sub">'+(trip?esc(trip.city)+(day?' · Day '+day:''):'Your travel companion')+'</span></div></header>';}
const tchKey=(owner,id,day)=>'journeyhub-trip-chat-'+owner+'-'+id+'-'+(day||'all');
const tchDay=value=>Number.isInteger(Number(value))&&Number(value)>0?Number(value):null;
function tchScope(){const owner=jhUser?.id||null;if(tchOwner!==owner){for(const ctx of tchEntries.values())clearTimeout(ctx.timer);tchEntries.clear();tchOwner=owner;}}
function tchContext(id,day){
  tchScope();if(!tchOwner||!id)return null;day=tchDay(day);const key=tchKey(tchOwner,id,day);if(tchEntries.has(key))return tchEntries.get(key);
  let saved={};try{saved=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
  const ctx={key,owner:tchOwner,id,day,draft:typeof saved.draft==='string'?saved.draft:'',retry:saved.retry||null,messages:[],pending:null,loading:false,loaded:false,busy:false,error:'',timer:null,failures:0,version:0,scrollTop:null,follow:true,forceBottom:false};tchEntries.set(key,ctx);return ctx;
}
const tchCurrent=ctx=>ctx&&ctx.owner===(jhUser?.id||null)&&tchEntries.get(ctx.key)===ctx;
const tchVisible=ctx=>tchCurrent(ctx)&&state.route==='trip-chat'&&state.params?.id===ctx.id&&tchDay(state.params?.day)===ctx.day;
const tchRunning=ctx=>ctx.pending&&['pending','queued','running'].includes(ctx.pending.status);
function tchSave(ctx){if(tchCurrent(ctx))try{sessionStorage.setItem(ctx.key,JSON.stringify({draft:ctx.draft,retry:ctx.retry}));}catch{}}
function tchTrip(ctx){tcScope();return tc.trips.find(t=>t.id===ctx?.id);}
function tchApplyResponse(ctx,result){
  if(!tchCurrent(ctx))return;if(result.trip?.id!==ctx.id||!Array.isArray(result.conversation?.messages))throw Error('This conversation could not be loaded. Please retry.');
  tcStore(tc,result.trip);ctx.messages=result.conversation.messages;ctx.pending=result.conversation.pending||null;ctx.loaded=true;ctx.error='';ctx.failures=0;
  if(ctx.pending?.status==='failed')ctx.error=ctx.pending.message||'The agent could not finish this request. Retry the saved message.';
  if(!ctx.pending){ctx.retry=null;tchSave(ctx);}else if(ctx.retry?.requestId!==ctx.pending.requestId){ctx.retry={action:'care_chat',id:ctx.id,requestId:ctx.pending.requestId,...(ctx.pending.dayIndex?{day:ctx.pending.dayIndex}:{}),message:ctx.messages.slice().reverse().find(m=>m.role==='user'&&(!ctx.pending.dayIndex||m.dayIndex===ctx.pending.dayIndex))?.text||''};tchSave(ctx);}
}
async function tchRequest(ctx,payload){tcScope();const care=tc;if(!tchCurrent(ctx)||care.owner!==ctx.owner)throw Error('Please sign in again to chat about this trip.');const result=await tcRequest(payload,care);if(!tchCurrent(ctx)||!tcCurrent(care))return null;return result;}
function tchSchedule(ctx){clearTimeout(ctx.timer);if(tchCurrent(ctx)&&tchRunning(ctx))ctx.timer=setTimeout(()=>{if(tchCurrent(ctx))void tchLoad(ctx);},2500);}
function tchPaint(ctx){
  if(!tchVisible(ctx))return;const editor=document.getElementById('tch-message'),history=document.querySelector('[data-tch-history]');
  // A poll never recreates the composer or scroll container, including during
  // IME composition or when the traveler is reading an earlier reply.
  if(editor&&history?.dataset.tchContext===ctx.key){const top=history.scrollTop,follow=ctx.forceBottom||history.scrollHeight-history.clientHeight-top<48,thread=document.querySelector('[data-tch-thread]'),priorities=document.querySelector('[data-tch-priorities]');if(thread){const html=tchThreadHTML(ctx);if(thread.innerHTML!==html)thread.innerHTML=html;}if(priorities){const html=tchPrioritiesHTML(ctx);if(priorities.innerHTML!==html)priorities.innerHTML=html;}const send=document.querySelector('[data-act="tchSend"]');if(send)send.disabled=ctx.busy||!!tchRunning(ctx)||!ctx.loaded;history.scrollTop=follow?history.scrollHeight:top;ctx.scrollTop=history.scrollTop;ctx.follow=follow;ctx.forceBottom=false;return;}
  render();
}
function tchResize(editor){if(!editor)return;editor.style.height='auto';editor.style.height=Math.min(72,Math.max(24,editor.scrollHeight))+'px';}
function tchAttach(ctx){const history=document.querySelector('[data-tch-history]');if(history){history.scrollTop=ctx.scrollTop===null?(ctx.messages.length?history.scrollHeight:0):ctx.scrollTop;}tchResize(document.getElementById('tch-message'));}
async function tchLoad(ctx){
  if(!tchCurrent(ctx)||ctx.loading||ctx.busy)return;ctx.loading=true;const version=++ctx.version;
  try{const result=await tchRequest(ctx,{action:'care_chat_history',id:ctx.id});if(!result||!tchCurrent(ctx)||version!==ctx.version)return;tchApplyResponse(ctx,result);}
  catch(e){if(tchCurrent(ctx)){ctx.error=agErrorText(e);ctx.failures++;}}
  finally{if(tchCurrent(ctx)){ctx.loading=false;tchPaint(ctx);if(ctx.failures<3)tchSchedule(ctx);}}
}
// The compact entry stays in the same Calendar position. Schedule cards and
// maps are untouched; the conversation replaces the former expanded panel.
const tchPreviousCard=taCard;
taCard=function(trip,options={}){
  if(!options.compact)return tchPreviousCard(trip,options);
  return '<section class="ta-card tch-entry" data-care-id="'+esc(trip.id)+'"><button data-act="tchOpen" data-a="'+esc(trip.id)+'" data-b="'+(options.day||'')+'" aria-label="Chat with your trip agent">'+tchEntryIdentity()+'</button></section>';
};
taStartHTML=event=>'<section class="ta-start tch-entry"><button data-act="tchStart" data-a="'+esc(event.manageKind)+'" data-b="'+esc(event.manageId)+'" data-c="'+(event.day||'')+'"'+(tc.busy?' disabled':'')+' aria-label="Chat with your trip agent">'+tchEntryIdentity(tc.busy)+'</button></section>';
A.tchOpen=(id,day)=>{tcScope();if(!tc.trips.some(t=>t.id===id)||!jhUser?.id)return;const ctx=tchContext(id,day);if(!ctx.busy){ctx.loaded=false;ctx.error='';}go('trip-chat',{id,day:ctx.day});};
A.tchStart=async(type,id,day)=>{
  if(day&&typeof day==='object')day=day.dataset?.c;
  if(!['history','run'].includes(type)||tc.busy||!jhUser?.id)return;const owner=jhUser.id,event=typeof calEvents==='function'?calEvents().find(e=>e.manageKind===type&&e.manageId===id&&!e.sample):null;
  if(!event&&!(type==='history'&&pd.owner===owner&&pd.historyId===id&&pd.plan&&!pd.sample))return;
  const trip=tcFor(type,id)||await tcChange({action:'care_confirm',[type==='history'?'historyId':'runId']:id},{silent:true});if(owner!==jhUser?.id||!trip)return;A.tchOpen(trip.id,day||event?.day);
};
function tchPrioritiesHTML(ctx){
  const trip=tchTrip(ctx);if(!trip)return '';const tasks=taTasks(trip,ctx.day).filter(t=>t.status!=='ready').sort((a,b)=>(a.status==='attention'?0:1)-(b.status==='attention'?0:1));
  const rows=tasks.length?tasks.slice(0,3).map(t=>({title:t.title||'Visit information to verify',detail:t.status==='attention'?'Needs attention':'To verify'})):(trip.stops||[]).filter(s=>!ctx.day||s.dayIndex===ctx.day).slice(0,3).map(s=>({title:tcName(s,trip),detail:s.start||'Planned visit'}));
  return rows.length?'<section class="tch-priorities"><h2>'+(tasks.length?'Worth a look':'Your day at a glance')+'</h2><ol>'+rows.map(r=>'<li><span>'+esc(r.title)+'</span><small>'+esc(r.detail)+'</small></li>').join('')+'</ol></section>':'';
}
function tchProposalHTML(ctx){
  const p=tchTrip(ctx)?.proposal;if(!p||(ctx.day&&(Array.isArray(p.affectedDays)&&p.affectedDays.length?!p.affectedDays.includes(ctx.day):p.dayIndex&&p.dayIndex!==ctx.day)))return '';const changes=Array.isArray(p.changes)?p.changes:[];if(!changes.length)return '';
  return '<section class="tch-proposal" aria-label="Review proposed changes"><h3>'+esc(p.title||'Suggested changes')+'</h3>'+(p.summary?'<p>'+esc(p.summary)+'</p>':'')+'<ol>'+changes.map(c=>'<li><strong>'+esc(c.name||'Planned visit')+'</strong><div><span><small>Before</small>'+esc(c.before||'Current plan')+'</span><span aria-hidden="true">→</span><span><small>After</small>'+esc(c.after||'Proposed plan')+'</span></div></li>').join('')+'</ol>'+(p.canApply?'<button class="btn btn-primary btn-block" data-act="tchApply" data-a="'+esc(p.id)+'"'+(ctx.busy||tchRunning(ctx)?' disabled':'')+'>Apply changes</button>':'<p class="tch-hold">Your plan is unchanged. Tell the agent what you would prefer.</p>')+'<p class="tch-protection">Existing reservations stay unchanged.</p></section>';
}
function tchItineraryHTML(message){
  const itinerary=message.itinerary,day=tchDay(itinerary?.dayIndex);if(message.role!=='assistant'||!day||!Number.isInteger(itinerary.revision)||!Array.isArray(itinerary.stops)||!itinerary.stops.length)return '';
  const stops=itinerary.stops;if(stops.some(s=>s.dayIndex!==day||typeof s.name!=='string'||!s.name.trim()||!/^\d{2}:\d{2}$/.test(s.start||'')||!/^\d{2}:\d{2}$/.test(s.end||'')))return '';
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(itinerary.date||'')&&Number.isFinite(Date.parse(itinerary.date+'T12:00:00Z')),date=validDate?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(itinerary.date+'T12:00:00Z')):'';
  return '<section class="tch-itinerary" data-itinerary-revision="'+itinerary.revision+'" aria-label="Updated itinerary for Day '+day+'"><header><strong>Updated itinerary · Day '+day+'</strong>'+(date?'<time datetime="'+esc(itinerary.date)+'">'+esc(date)+'</time>':'')+'</header><ol>'+stops.map(s=>{const theme=typeof calStopTheme==='function'?calStopTheme({kind:s.kind||s.category,categories:[s.category||'']}):/restaurant|cafe|café|food|dining|meal|tea/i.test((s.kind||'')+' '+(s.category||''))?{key:'dining',label:'Food & drink'}:{key:'sightseeing',label:'Visit'};return '<li class="tch-itinerary-stop '+(theme.key==='dining'?'is-dining':'is-visit')+'"><div><time>'+esc(s.start)+'–'+esc(s.end)+'</time><span>'+esc(theme.label)+'</span></div><h4>'+esc(s.name)+'</h4></li>';}).join('')+'</ol></section>';
}
function tchItinerariesHTML(message){if(!Array.isArray(message.itineraries))return tchItineraryHTML(message);const seen=new Set();return message.itineraries.map(itinerary=>{const key=itinerary?.dayIndex;if(seen.has(key))return '';seen.add(key);return tchItineraryHTML({...message,itinerary});}).join('');}
const tchMoney=value=>Number.isSafeInteger(value)&&value>=0?'CNY '+new Intl.NumberFormat('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100):'To confirm';
const tchQuoteStatuses=new Set(['ready','insufficient_funds','paid','expired','stale','not_eligible','no_payment_needed']);
function tchPaymentQuote(message){const q=message?.paymentAction;return message?.role==='assistant'&&q?.simulated===true&&q.currency==='CNY'&&typeof q.quoteId==='string'&&q.quoteId&&tchQuoteStatuses.has(q.status)&&Number.isSafeInteger(q.totalMinor)&&q.totalMinor>=0&&Number.isSafeInteger(q.balanceMinor)&&q.balanceMinor>=0&&Array.isArray(q.items)?q:null;}
const tchQuoteExpired=q=>q.status==='expired'||(Number.isFinite(Date.parse(q.expiresAt))&&Date.parse(q.expiresAt)<=Date.now());
const tchQuotePayable=q=>q&&q.status==='ready'&&!tchQuoteExpired(q)&&q.totalMinor>0&&q.balanceMinor>=q.totalMinor&&q.items.some(i=>i.status==='ready');
function tchPaymentHTML(ctx,message){
  const q=tchPaymentQuote(message);if(!q)return '';
  if(q.status==='paid')return '<p class="tch-paid-quote">'+ic('check',15)+' Virtual payment completed. Receipt saved in this conversation.</p>';
  const status=tchQuoteExpired(q)?'expired':q.status,labels={ready:'New reservation',already_reserved:'Already reserved',unavailable:'Not included · unavailable',free:'No virtual charge',paid:'Paid with credits',cancelled:'Cancelled'};
  const note={insufficient_funds:'Add virtual credits in Wallet, then return here to confirm.',expired:'This quote has expired. Ask the agent for a new quote.',stale:'Your plan has changed. Ask the agent for an updated quote.',not_eligible:'No eligible items can be paid from this quote.',no_payment_needed:'No new virtual payment is needed.'}[status]||'';
  return '<section class="tch-payment" data-payment-quote="'+esc(q.quoteId)+'" aria-label="Virtual payment review"><header><strong>Review virtual payment</strong><small>Virtual credits · No real payment</small></header><ol>'+q.items.map(i=>'<li class="'+(i.status==='ready'?'is-new':'')+'"><div><strong>'+esc(i.title||'Planned visit')+'</strong><small>'+esc(labels[i.status]||'Not included')+(Number.isInteger(i.quantity)&&i.quantity>0?' · '+i.quantity+' guest'+(i.quantity===1?'':'s'):'')+'</small></div><span>'+esc(['ready','paid'].includes(i.status)?tchMoney(i.totalMinor):i.status==='already_reserved'?'No new charge':i.status==='free'?'CNY 0.00':'—')+'</span></li>').join('')+'</ol><dl><div><dt>Total to pay</dt><dd>'+tchMoney(q.totalMinor)+'</dd></div><div><dt>Wallet balance</dt><dd>'+tchMoney(q.balanceMinor)+'</dd></div>'+(status==='insufficient_funds'?'<div class="tch-shortfall"><dt>More credits needed</dt><dd>'+tchMoney(Number.isSafeInteger(q.shortfallMinor)?q.shortfallMinor:Math.max(0,q.totalMinor-q.balanceMinor))+'</dd></div>':'')+'</dl>'+(note?'<p class="tch-payment-note">'+esc(note)+'</p>':'')+(tchQuotePayable(q)?'<button class="btn btn-primary btn-block" data-act="tchPay" data-a="'+esc(q.quoteId)+'"'+(ctx.busy||tchRunning(ctx)?' disabled':'')+'>Confirm & pay '+tchMoney(q.totalMinor)+'</button>':status==='insufficient_funds'?'<button class="btn btn-soft btn-block" data-act="tchWallet">Open Wallet '+ic('right',15)+'</button>':'')+'</section>';
}
function tchReceiptHTML(message){
  const receipt=message.paymentReceipt;if(message.role!=='assistant'||receipt?.simulated!==true||receipt.currency!=='CNY'||!Number.isSafeInteger(receipt.totalMinor)||receipt.totalMinor<0||!Array.isArray(receipt.bookingIds))return '';
  const ids=[...new Set(receipt.bookingIds.filter(id=>typeof id==='string'&&id))],lookup=String(message.id||'').endsWith(':assistant');
  return '<section class="tch-receipt" data-payment-receipt="'+esc(receipt.quoteId||'')+'" aria-label="Virtual payment receipt"><header>'+ic('check',18)+'<strong>'+(lookup?'Already paid':'Virtual payment receipt')+'</strong></header><dl><div><dt>Paid with credits</dt><dd>'+tchMoney(receipt.totalMinor)+'</dd></div>'+(Number.isSafeInteger(receipt.balanceMinor)&&receipt.balanceMinor>=0?'<div><dt>Balance after payment</dt><dd>'+tchMoney(receipt.balanceMinor)+'</dd></div>':'')+'</dl>'+(ids.length?'<h4>Booking IDs</h4><ul>'+ids.map(id=>'<li>'+esc(id)+'</li>').join(''):'<p>No new booking IDs were returned.</p>')+'<small>'+(lookup?'No additional credits deducted.':'Saved in Calendar and Wallet.')+' No real payment.</small></section>';
}
function tchMessageHTML(message,ctx){const itinerary=tchItinerariesHTML(message),receipt=tchReceiptHTML(message);return '<article class="tch-message tch-'+message.role+'" data-message-id="'+esc(message.id)+'"><span class="tch-speaker">'+(message.role==='user'?'You':tchAvatar('tch-avatar-message')+'Trip agent')+'</span><p>'+esc(itinerary?'Changes saved.':message.text||'')+'</p>'+itinerary+tchPaymentHTML(ctx,message)+receipt+'</article>';}
function tchThreadHTML(ctx){
  const messages=ctx.messages.filter(m=>!ctx.day||!m.dayIndex||m.dayIndex===ctx.day||m.paymentAction||m.paymentReceipt||m.itineraries?.some(i=>i.dayIndex===ctx.day)).filter(m=>['user','assistant'].includes(m.role));
  const local=ctx.retry?.action==='care_chat'&&ctx.retry.message&&(!ctx.day||!ctx.retry.day||ctx.retry.day===ctx.day)&&!messages.some(m=>m.role==='user'&&m.text===ctx.retry.message)?ctx.retry.message:null;
  const status=ctx.busy&&ctx.retry?.action==='care_chat_pay'?'Saving your virtual payment…':ctx.busy&&ctx.retry?.action==='care_chat_apply'?'Saving your changes…':ctx.pending?.dayIndex&&ctx.day&&ctx.pending.dayIndex!==ctx.day?'The agent is finishing your Day '+ctx.pending.dayIndex+' request…':ctx.pending?.message||(!ctx.loaded?'Opening your conversation…':'The agent is checking your request…');
  return tchClearHTML(ctx)+'<div class="tch-messages" role="log" aria-label="Conversation" aria-live="polite">'+messages.map(m=>tchMessageHTML(m,ctx)).join('')+(local?'<article class="tch-message tch-user"><span class="tch-speaker">You</span><p>'+esc(local)+'</p></article>':'')+(!messages.length&&!local&&!ctx.loading?'<p class="tch-welcome">What would make this day work better for you?</p>':'')+'</div>'+tchProposalHTML(ctx)+(ctx.busy||tchRunning(ctx)||ctx.loading&&!ctx.loaded?'<p class="tch-status" role="status"><span aria-hidden="true"></span>'+esc(status)+'</p>':'')+(ctx.error?'<div class="tch-error" role="alert"><p>'+esc(ctx.error)+'</p>'+(ctx.pending?.canRetry===false&&ctx.retry?.action==='care_chat'?'<p>Please send a new message.</p>':'<button class="btn-text" data-act="tchRetry">'+(ctx.retry?'Retry saved request':'Try again')+'</button>')+'</div>':'');
}
function tchClearHTML(ctx){
 const disabled=ctx.busy||ctx.loading||tchRunning(ctx)||!ctx.loaded;
 if(ctx.confirmClear)return '<section class="tch-clear-confirm" role="group" aria-label="Clear conversation confirmation"><strong>Clear this trip’s conversation?</strong><p>Messages for all days and unapplied suggestions will be removed. Saved trips, reservations and payment records stay unchanged.</p><button class="btn btn-outline btn-sm" data-act="tchClearCancel">Keep conversation</button> <button class="btn btn-primary btn-sm" data-act="tchClearConfirm"'+(disabled?' disabled':'')+'>Clear conversation</button></section>';
 return '<div class="tch-clear-tools"><button class="btn-text" data-act="tchClearAsk"'+(disabled?' disabled':'')+'>Clear conversation</button></div>';
}
A.tchClearAsk=()=>{const ctx=tchActive();if(!ctx||ctx.busy||ctx.loading||tchRunning(ctx)||!ctx.loaded)return;ctx.confirmClear=true;tchPaint(ctx);};
A.tchClearCancel=()=>{const ctx=tchActive();if(ctx&&!ctx.busy){ctx.confirmClear=false;tchPaint(ctx);}};
A.tchClearConfirm=async()=>{
 const ctx=tchActive();if(!ctx?.confirmClear||ctx.busy||ctx.loading||tchRunning(ctx))return;
 ctx.busy=true;ctx.error='';tchPaint(ctx);
 try{
  const result=await agRPC('journeyhub_clear_trip_chat',{p_care_id:ctx.id});
  if(!tchCurrent(ctx))return;if(!result?.ok)throw Error('Conversation could not be cleared. Please retry.');
  for(const entry of tchEntries.values())if(entry.owner===ctx.owner&&entry.id===ctx.id){clearTimeout(entry.timer);entry.version++;entry.messages=[];entry.pending=null;entry.retry=null;entry.draft='';entry.confirmClear=false;entry.error='';entry.scrollTop=0;entry.loaded=false;tchSave(entry);}
  const trip=tchTrip(ctx);if(trip)trip.proposal=null;
  const editor=document.getElementById('tch-message');if(editor){editor.value='';tchResize(editor);}
 }catch(e){if(tchCurrent(ctx))ctx.error=agErrorText(e);}
 finally{if(tchCurrent(ctx)){ctx.busy=false;tchPaint(ctx);if(!ctx.confirmClear)await tchLoad(ctx);}}
};
async function tchExecute(ctx,payload){
  if(!tchCurrent(ctx)||ctx.busy)return;ctx.busy=true;ctx.error='';ctx.retry=payload;tchSave(ctx);clearTimeout(ctx.timer);ctx.version++;tchPaint(ctx);
  try{const result=await tchRequest(ctx,payload);if(!result||!tchCurrent(ctx))return;tchApplyResponse(ctx,result);
    if(payload.action==='care_chat_apply'){tcSyncItinerary(result.trip);if(typeof thInvalidate==='function'&&result.trip.sourceType==='history')thInvalidate(result.trip.sourceId);if(typeof jhInvalidateSnapshot==='function')jhInvalidateSnapshot();if(typeof cal!=='undefined'&&cal.owner===ctx.owner){cal.details={};cal.detailVersion++;}}
    if(payload.action==='care_chat_pay'){if(typeof jhInvalidateSnapshot==='function')jhInvalidateSnapshot();tchPaint(ctx);const reads=[];if(typeof jhRefresh==='function')reads.push(jhRefresh());if(typeof dwLoad==='function')reads.push(dwLoad(true));void Promise.allSettled(reads);}
  }catch(e){if(tchCurrent(ctx))ctx.error=agErrorText(e);}
  finally{if(tchCurrent(ctx)){ctx.busy=false;tchPaint(ctx);tchSchedule(ctx);}}
}
function tchActive(){return state.route==='trip-chat'?tchContext(state.params?.id,state.params?.day):null;}
A.tchSend=()=>{const ctx=tchActive();if(!ctx||ctx.busy||tchRunning(ctx)||!ctx.loaded)return;const message=ctx.draft.trim();if(!message){ctx.error='Tell the agent what you would like to change.';tchPaint(ctx);return;}if(message.length>1800){ctx.error='Please keep your message under 1,800 characters.';tchPaint(ctx);return;}ctx.draft='';ctx.forceBottom=true;tchSave(ctx);const editor=document.getElementById('tch-message');if(editor){editor.value='';tchResize(editor);}return tchExecute(ctx,{action:'care_chat',id:ctx.id,requestId:crypto.randomUUID(),message,...(ctx.day?{day:ctx.day}:{})});};
A.tchApply=proposalId=>{const ctx=tchActive(),p=tchTrip(ctx)?.proposal;if(!ctx||ctx.busy||tchRunning(ctx)||!p?.canApply||p.id!==proposalId)return;return tchExecute(ctx,{action:'care_chat_apply',id:ctx.id,requestId:crypto.randomUUID(),proposalId});};
function tchPayRequestId(ctx,quoteId){const key=tchKey(ctx.owner,ctx.id,null)+'-pay-'+quoteId;let id;try{id=sessionStorage.getItem(key);}catch{}if(!/^[a-f\d-]{36}$/i.test(id||'')){id=crypto.randomUUID();try{sessionStorage.setItem(key,id);}catch{}}return id;}
A.tchPay=quoteId=>{const ctx=tchActive();if(!ctx||ctx.busy||tchRunning(ctx))return;const quote=ctx.messages.map(tchPaymentQuote).find(q=>q?.quoteId===quoteId);if(!tchQuotePayable(quote))return;return tchExecute(ctx,{action:'care_chat_pay',id:ctx.id,requestId:tchPayRequestId(ctx,quoteId),quoteId});};
A.tchWallet=()=>{const ctx=tchActive();if(!ctx||ctx.busy)return;ctx.loaded=false;ctx.error='';if(typeof dwScope==='function'){dwScope();dw.loaded=false;}if(typeof A.dwWallet==='function')A.dwWallet();};
A.tchRetry=()=>{const ctx=tchActive();if(!ctx||ctx.busy||ctx.pending?.canRetry===false&&ctx.retry?.action==='care_chat')return;return ctx.retry?tchExecute(ctx,ctx.retry):tchLoad(ctx);};
document.addEventListener('input',event=>{if(event.target.id!=='tch-message')return;const ctx=tchActive();if(ctx){ctx.draft=event.target.value;tchSave(ctx);tchResize(event.target);}});
document.addEventListener('scroll',event=>{if(!event.target.matches?.('[data-tch-history]'))return;const ctx=tchActive();if(ctx&&event.target.dataset.tchContext===ctx.key){ctx.scrollTop=event.target.scrollTop;ctx.follow=event.target.scrollHeight-event.target.clientHeight-ctx.scrollTop<48;}},true);
document.addEventListener('keydown',event=>{if(event.target.id==='tch-message'&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing){event.preventDefault();void A.tchSend();}});
TAB_OF['trip-chat']='orders';
V['trip-chat']=()=>{
  const ctx=tchActive(),trip=tchTrip(ctx),header=tchHeader(trip,ctx?.day);
  if(!ctx)return {bar:header,tabs:true,body:'<main class="tch-page"><p>Sign in to chat about your saved itinerary.</p><button class="btn btn-primary" data-act="calSignIn">Sign in</button></main>'};
  return {bar:header,tabs:true,body:'<main class="tch-page"><div class="tch-history" data-tch-history data-tch-context="'+esc(ctx.key)+'" tabindex="0" aria-label="Trip conversation history"><div data-tch-priorities>'+tchPrioritiesHTML(ctx)+'</div><div data-tch-thread>'+tchThreadHTML(ctx)+'</div></div><div class="tch-composer"><textarea id="tch-message" rows="1" maxlength="1800" aria-label="Message your trip agent" placeholder="Message your trip agent…">'+esc(ctx.draft)+'</textarea><button class="tch-send" data-act="tchSend" aria-label="Send message"'+(ctx.busy||tchRunning(ctx)||!ctx.loaded?' disabled':'')+'>'+ic('right',21)+'</button></div></main>',after:()=>{tchAttach(ctx);if(!ctx.loaded&&!ctx.loading&&!ctx.error)void tchLoad(ctx);}};
};
const tchPreviousRender=render;
render=function(){tchScope();const ctx=tchActive(),history=document.querySelector('[data-tch-history]');if(ctx&&history?.dataset.tchContext===ctx.key)ctx.scrollTop=history.scrollTop;tchPreviousRender();};
