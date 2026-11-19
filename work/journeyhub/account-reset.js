/* Account-scoped reset using existing authorized, reversible calendar RPCs. */
let ar=null;
const arCurrent=ctx=>!!ctx&&ar===ctx&&ctx.owner===(jhUser?.id||null)&&ctx.revision===jhRevision;
const arBusy=()=>ui.busy||jhPendingWrites||pd?.loading||pd?.busy||jmCache.busy||cm.busy||dw.busy;
function arClearStorage(owner){
  for(const storage of [localStorage,sessionStorage]){
    for(const key of Object.keys(storage)){
      if(key.startsWith('jh-pip:'+owner+':')||key.startsWith('journeyhub-trip-chat-'+owner+'-')||key===jpPrefKey(owner))storage.removeItem(key);
    }
  }
}
A.arOpen=async()=>{
  if(!jhUser||!traveler()||(arCurrent(ar)&&ar?.busy))return;
  if(arBusy()){toast('Finish the current operation before resetting your account.');return;}
  const ctx=ar={owner:jhUser.id,revision:jhRevision,items:[],bookings:[],retained:[],walletRequest:crypto.randomUUID(),walletDone:false,busy:true,ready:false,error:'',done:0,memories:false,localDone:false,personalDone:false,finished:false};
  go('account-reset');
  try{
    await jhFlush();if(!arCurrent(ctx))return;
    const readiness=await agRPC('journeyhub_reset_virtual_wallet',{p_commit:false,p_request_id:ctx.walletRequest});
    if(!arCurrent(ctx))return;if(!readiness?.ready)throw Error('Account reset is not enabled on this server yet.');
    await jhRefresh();if(!arCurrent(ctx))return;
    ctx.retained=Array.isArray(readiness.retainedBookingIds)?readiness.retainedBookingIds:[];
    ctx.bookings=Object.values(DBC.bookings).filter(b=>isMine(b)&&b.demo&&b.status==='confirmed'&&!ctx.retained.includes(b.id)).map(b=>({id:b.id,requestId:crypto.randomUUID(),done:false,cancellable:cmCanCancel(b)}));
    if(ctx.bookings.some(b=>!b.cancellable))throw Error('Reservation details could not be verified. Refresh the account check; no records were changed.');
    cmScope();await cmLoad(true);if(!arCurrent(ctx))return;
    if(cm.error||!cm.loaded)throw Error(cm.error||'Calendar settings could not load.');
    thScope();const history=th,seen=new Set(),cursors=new Set();let cursor=null;
    const add=(kind,id)=>{const key=kind+':'+id;if(typeof id!=='string'||seen.has(key)||cmHidden(kind,id))return;seen.add(key);ctx.items.push({kind,id,requestId:crypto.randomUUID(),done:false});};
    do{
      const result=await thRequest({action:'history_list',limit:20,...(cursor?{cursor}:{})},history);
      if(!arCurrent(ctx))return;
      if(!Array.isArray(result.items))throw Error('History could not be listed. Nothing has been reset.');
      result.items.forEach(row=>add('history',row.id));cursor=result.nextCursor||null;
      if(cursor){const key=JSON.stringify(cursor);if(cursors.has(key))throw Error('History pagination did not finish. Nothing has been reset.');cursors.add(key);}
    }while(cursor);
    const runs=await agRPC('journeyhub_agent_list',{p_limit:50});if(!arCurrent(ctx))return;
    if(!Array.isArray(runs)||runs.length>=50)throw Error('Your full agent history cannot be listed safely. Reset is unavailable; no records were changed.');
    if(runs.some(row=>['planning','queued'].includes(row.status)))throw Error('An agent is still working. Wait for it to finish before resetting.');
    runs.forEach(row=>add('run',row.id));
    ctx.ready=true;
  }catch(e){if(arCurrent(ctx))ctx.error=/journeyhub_reset_virtual_wallet|PGRST202/.test(String(e?.message||e))?'Account reset is awaiting its server upgrade. No records were changed.':cmError(e);}
  finally{if(arCurrent(ctx)){ctx.busy=false;render();}}
};
A.arMemories=()=>{if(ar&&!ar.busy&&!ar.started)ar.memories=!ar.memories;render();};
A.arConfirm=async()=>{
  const ctx=ar;
  if(!ctx||!arCurrent(ctx)||ctx.busy||!ctx.ready||ctx.finished)return;
  if(document.getElementById('ar-confirm')?.value!=='RESET'){toast('Type RESET to confirm.');return;}
  ctx.started=true;ctx.busy=true;ctx.error='';render();
  try{
    await jhFlush();if(!arCurrent(ctx))return;
    const latest=await agRPC('journeyhub_reset_virtual_wallet',{p_commit:false,p_request_id:ctx.walletRequest});
    if(!arCurrent(ctx))return;
    ctx.retained=Array.isArray(latest?.retainedBookingIds)?latest.retainedBookingIds:ctx.retained;
    ctx.bookings=ctx.bookings.filter(b=>b.done||!ctx.retained.includes(b.id));
    for(const booking of ctx.bookings){
      if(!arCurrent(ctx))return;if(booking.done)continue;
      const result=await agRPC('journeyhub_calendar_manage',{p_kind:'booking',p_id:booking.id,p_action:'cancel',p_request_id:booking.requestId});
      if(!arCurrent(ctx))return;if(!result?.ok)throw Error('A reservation could not be cancelled.');booking.done=true;
    }
    if(!ctx.walletDone){
      const result=await agRPC('journeyhub_reset_virtual_wallet',{p_commit:true,p_request_id:ctx.walletRequest});
      if(!arCurrent(ctx))return;if(!result?.ok)throw Error('The virtual wallet could not be reset.');ctx.walletDone=true;
    }
    for(const item of ctx.items){
      if(!arCurrent(ctx))return;if(item.done)continue;
      const result=await agRPC('journeyhub_calendar_manage',{p_kind:item.kind,p_id:item.id,p_action:'remove',p_request_id:item.requestId});
      if(!arCurrent(ctx))return;
      if(!result?.ok)throw Error('A trip could not be reset.');
      cm.removed=cmRows(result);cm.loaded=true;cmRemovedPlan(cm,item);item.done=true;ctx.done++;render();
    }
    if(!ctx.personalDone){
      const d={...defaults(),cart:{}},body=Object.fromEntries(jhAllowed.map(key=>[key,d[key]]));
      await jhCommand('personal',{body},false);if(!arCurrent(ctx))return;
      jhAllowed.forEach(key=>state[key]=d[key]);lastPersonal=JSON.stringify(jhPersonal());jhPersonalDirty=false;ctx.personalDone=true;
    }
    if(ctx.memories&&!ctx.localDone){
      // Only this account, only this browser. Other accounts and guest data remain intact.
      const trips=await JM.listTrips(ctx.owner);if(!arCurrent(ctx))return;
      for(const trip of trips){if(!arCurrent(ctx))return;await JM.deleteTrip(ctx.owner,trip.id);}
      if(!arCurrent(ctx))return;ctx.localDone=true;jmRevoke();jmCache={owner:ctx.owner,loaded:false,loading:false,trips:[],photos:{},error:'',busy:false};
    }
    arClearStorage(ctx.owner);
    clearTimeout(pd.historyTimer);pd=pdFresh();thForgetHydration(th);th=thFresh(ctx.owner);
    ag.prefs=jpNormalize();jpSavePrefs();
    await jhRefresh();if(!arCurrent(ctx))return;
    ctx.finished=true;
  }catch(e){if(arCurrent(ctx))ctx.error=ctx.bookings.filter(b=>b.done).length+' of '+ctx.bookings.length+' reservations cancelled; '+ctx.done+' of '+ctx.items.length+' trip/search records reset. '+cmError(e)+' Retry to finish the remaining steps.';}
  finally{if(arCurrent(ctx)){ctx.busy=false;render();}}
};
A.arFinish=()=>{if(ar?.finished&&arCurrent(ar))location.reload();};
TAB_OF['account-reset']='me';
V['account-reset']=()=>{
  const ctx=ar;
  if(!ctx||!arCurrent(ctx))return {bar:bar({title:'Reset account content'}),tabs:true,body:'<div class="content"><p>Sign in to reset your own account content.</p></div>'};
  let body='<main class="content"><h2>Reset account content</h2><p>'+esc(jhUser.email||'Your account')+'</p>';
  if(ctx.finished)body+='<div role="status"><h3>Account content reset</h3><p>'+ctx.done+' trip/search records moved to Removed items. Favorites and personal preferences cleared.'+(ctx.memories?' Memories on this browser removed.':' Memories kept.')+'</p><p>'+ctx.bookings.length+' simulated reservations cancelled. '+ctx.retained.length+' started or checked-in reservations kept without refunds or seat changes. Virtual balance reset to zero. Your account, staff access, product orders and audit/payment records are kept.</p></div><button class="btn btn-primary" data-act="arFinish">Done · reload account</button>';
  else{
    body+='<p>Move all saved trips and searches to Removed items, pause linked trip support, and clear favorites, personal preferences and this browser’s Pip conversation cache. Trips and searches can be restored from Removed items.</p><p><strong>Cancel simulated reservations and reset virtual balance:</strong> cancel only future, unchecked reservations, release their seats and invalidate their tickets, refund virtual credits, then clear the remaining virtual balance. Cancelled bookings cannot be restored; booking again creates a new reservation.</p><p><strong>Keep:</strong> started or checked-in reservations (no refund or seat release), login account, staff permissions, product orders, non-simulated reservations and payment/audit history. No real payment is made.</p>';
    body+='<button class="btn btn-soft" data-act="go" data-a="memories"'+(ctx.busy?' disabled':'')+'>Open Travel Memories to export backups</button><p><label><input type="checkbox" data-act="arMemories"'+(ctx.memories?' checked':'')+(ctx.busy||ctx.started?' disabled':'')+'> Also permanently delete my Travel Memories and photos stored in this browser</label></p><p>Memories on other devices are not removed. Export any memories you want to keep before selecting this option.</p>';
    if(ctx.error)body+='<p class="cal-error" role="alert">'+esc(ctx.error)+'</p>';
    if(ctx.busy)body+='<p role="status">'+(ctx.started?'Resetting '+ctx.done+' of '+ctx.items.length+' trip/search records…':'Checking all account records…')+'</p>';
    if(ctx.ready)body+='<p>'+ctx.items.length+' trip/search records and '+ctx.bookings.length+' simulated reservations to cancel; '+ctx.retained.length+' started or checked-in reservations to keep.</p><label for="ar-confirm">Type RESET to confirm</label><input id="ar-confirm" autocomplete="off"'+(ctx.busy?' disabled':'')+'><button class="btn cm-danger" data-act="arConfirm"'+(ctx.busy?' disabled':'')+'>'+(ctx.error?'Retry remaining steps':'Reset my account content')+'</button>';
    else if(!ctx.busy)body+='<button class="btn btn-soft" data-act="arOpen">Retry account check</button>';
    body+='<button class="btn btn-soft" data-act="go" data-a="me"'+(ctx.busy?' disabled':'')+'>Back to Me</button>';
  }
  return {bar:bar({title:'Account content'}),tabs:!ctx.busy,body:body+'</main>'};
};
const arMe=V.me;
V.me=()=>{const view=arMe();if(jhUser&&traveler())view.body+='<div class="content"><button class="btn btn-soft" data-act="arOpen">Reset account content</button><p class="meta">Start fresh with your trips and preferences.</p></div>';return view;};
