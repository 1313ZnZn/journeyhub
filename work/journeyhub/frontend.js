/* JourneyHub Supabase integration. All business writes go through checked RPCs. */
const jhConfig = window.JOURNEYHUB_CONFIG || {};
const sb = window.supabase.createClient(jhConfig.url, jhConfig.publishableKey);
let jhUser = null, jhLoading = false, jhPersonalReady = false, jhPersonalDirty = false;
let jhRevision = 0, jhReadVersion = 0, jhQueue = Promise.resolve(), jhPendingWrites = 0;
let jhPoll = null, jhLastError = '', jhRecovery = false, jhLastSnapshot = null;
let jhSnapshotPending=null,jhSnapshotEpoch=0,jhSnapshotRendered=null;
function jhInvalidateSnapshot(){jhSnapshotEpoch++;}
const jhHM = (value,tz=TZ) => value ? new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)) : null;
const jhISO = (value,tz=TZ) => value ? new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)) : null;
const jhRows = rows => Object.fromEntries(rows.map(row=>[row.id,row]));
const jhAllowed = ['cart','saved','planner','plan','address','passport','vatManual','expSel','method'];
const jhPersonal = () => Object.fromEntries(jhAllowed.map(key=>[key,state[key]]));
const jhError = e => String(e && e.message || 'Cannot reach Supabase. Please retry.');
const jhChannel = {app:'Journey Hub app',partner_site:'Partner site',partner_desk:'Partner desk',concierge:'Concierge desk',walk_in:'Walk-in'};
const docCount = () => Object.values(DBC).reduce((n,rows)=>n+Object.keys(rows).length,0);

function jhApply(data,loadPersonal=false) {
  jhLastSnapshot=data;
  const venues=Object.fromEntries((data.venues||[]).map(v=>[v.venue_id,v]));
  const next={};
  next.stores=jhRows(data.stores.map(s=>Object.assign({},SEED.stores[s.store_id]||{img:IMG.rf},{id:s.store_id,name:s.name,kind:s.kind,area:s.area,dist:s.distance_km+' km',hours:s.opening_hours,vatForms:s.issues_vat_forms})));
  next.products=jhRows(data.products.map(p=>Object.assign({},SEED.products[p.product_id]||{img:IMG.tote,alt:p.name},{id:p.product_id,name:p.name,store:p.store_id,price:p.price_thb,desc:p.description,cats:p.categories,mto:p.made_to_order,stock:0})));
  next.experiences=jhRows(data.experiences.map(e=>Object.assign({cats:[e.kind==='Food'?'food':'workshops'],does:[],img:IMG.craft,thumb:IMG.tcraft,alt:e.name,hostLine:'Local host',venueDist:''},SEED.experiences[e.experience_id]||{},
    {id:e.experience_id,name:e.name,kind:e.kind,price:e.price_thb,dur:(e.duration_min/60)+' h',rating:e.rating,reviews:e.review_count,host:e.host_name,lang:e.languages,venue:venues[e.venue_id]?.name||'Venue to be confirmed',city:venues[e.venue_id]?.city||'Bangkok',timeZone:venues[e.venue_id]?.time_zone||TZ,lat:venues[e.venue_id]?.lat??null,lng:venues[e.venue_id]?.lng??null,coordinateAccuracy:venues[e.venue_id]?.coordinate_accuracy||null,details:e.details||{}},
    e.details?.sample?{cats:e.details.cats||[],does:e.details.does||[],img:e.details.img,thumb:e.details.img,alt:e.details.en||e.name}:{})));
  next.inventory=jhRows(data.inventory.map(i=>({id:i.product_id,stock:i.stock})));
  next.sessions=jhRows(data.sessions.map(s=>{const tz=next.experiences[s.experience_id]?.timeZone||TZ;return {id:s.session_id,exp:s.experience_id,date:jhISO(s.starts_at,tz),day:offsetOf(jhISO(s.starts_at,tz)),time:jhHM(s.starts_at,tz)+' – '+jhHM(s.ends_at,tz),start:jhHM(s.starts_at,tz),startsAt:s.starts_at,endsAt:s.ends_at,status:s.status,timeZone:tz,cap:s.capacity,held:s.seats_held_other_channels,taken:s.seats_taken,price:s.price_thb,closed:s.status!=='open'||new Date(s.starts_at)<=new Date(),extra:!SEED.sessions[s.session_id]};}));
  next.bookings=jhRows(data.bookings.map(b=>({id:b.booking_id,slot:b.session_id,exp:next.sessions[b.session_id]?.exp,traveler:b.traveler_id,name:b.guest_name,guests:b.guests,via:jhChannel[b.channel]||b.channel,status:b.status,unitPrice:b.unit_price_thb,code:b.checkin_code,checkedIn:!!b.checked_in_at,checkedInAt:jhHM(b.checked_in_at),createdAt:Date.parse(b.created_at),at:jhHM(b.created_at)})));
  next.orders=jhRows(data.orders.map(o=>{
    const intl=o.delivery_method==='international';
    const fees=[{k:'delivery',label:intl?'International shipping':'Hotel delivery',amount:o.delivery_fee_thb}];
    if(o.split_fee_thb) fees.push({k:'split',label:'Second delivery (split)',amount:o.split_fee_thb});
    const waiting=o.items.filter(i=>i.made_to_order&&!i.received_at_hub_at);
    return {id:o.order_id,traveler:o.traveler_id,guest:o.guest_name,method:intl?'intl':'hotel',dest:o.destination,status:o.status==='out_for_delivery'?'out':o.status,
      items:o.items.map(i=>({pid:i.product_id,name:i.name,qty:i.qty,price:i.unit_price_thb})),fees,subtotal:o.items_thb,total:o.total_thb,
      address:intl?{name:o.recipient_name,line1:o.address_line1,city:o.city,postcode:o.postcode,country:o.country,phone:o.phone}:{hotel:o.destination,room:o.hotel_room,guest:o.recipient_name},
      scarfAtHub:!waiting.length,readyOn:waiting.length?jhISO(waiting.map(i=>i.ready_by).filter(Boolean).sort().at(-1)):null,
      importCheck:o.import_check==='cleared'?'ok':o.import_check==='pending'?'pending':null,choice:o.split_choice,choiceAt:jhHM(o.choice_at),placedAt:jhHM(o.placed_at),placedOn:jhISO(o.placed_at),
      deliveredAt:jhHM(o.delivered_at),cancelledAt:jhHM(o.cancelled_at),createdAt:Date.parse(o.placed_at),log:o.events.map(e=>({t:jhHM(e.at),m:e.message}))};
  }));
  next.sessionPlans=jhRows(data.sessionPlans.map(p=>({id:p.plan_id,exp:p.experience_id,date:p.session_date,startTime:p.start_time,day:offsetOf(p.session_date),time:p.start_time<'12:00'?'am':'pm',cap:p.capacity,price:p.price_thb,promo:p.promo_budget_thb,reason:p.reason,status:p.status,submittedBy:p.submitted_by,approvedBy:p.approved_by,createdSessionId:p.created_session_id,createdAt:p.created_at,updatedAt:p.updated_at,version:p.version,log:(p.events||[]).map(e=>({t:jhHM(e.at),m:e.message}))})));
  next.staff=data.staff?{[data.staff.id]:data.staff}:{};
  const activities={};
  (data.metrics||[]).filter(s=>s.month==='2026-09-01').sort((a,b)=>a.week-b.week).forEach(s=>{
    const e=next.experiences[s.experience_id];
    if(!activities[s.experience_id]) activities[s.experience_id]={name:e.name,price:s.price,seatsPer:s.seats_offered,cost:s.cost,b:[],c:[],a:[],img:e.thumb};
    const m=activities[s.experience_id];m.b.push(s.booked);m.c.push(s.cancelled);m.a.push(s.attended);
  });
  next.metrics={'sept-2026':{id:'sept-2026',month:'September 2026',activities}};
  // Preserve an unsaved draft while a periodic read is in flight.
  if(jhPlanDirty&&DBC.sessionPlans[PLAN_ID]&&next.sessionPlans[PLAN_ID]?.status==='draft') next.sessionPlans[PLAN_ID]=DBC.sessionPlans[PLAN_ID];
  DBC=next; syncAliases();
  state.auth={traveler:data.profile||null,staff:data.staff||null};
  state.travId=data.profile?.id||'guest'; ME=jhUser?.id||'guest'; CAN_EDIT=false;
  if(loadPersonal) {
    const personal=data.personal||{};
    jhAllowed.forEach(k=>{if(personal[k]!==undefined) state[k]=personal[k];});
    normalizeState();
    if(data.profile){state.address.guest=state.address.guest||data.profile.name;state.address.name=state.address.name||data.profile.name;}
    lastPersonal=JSON.stringify(jhPersonal());jhPersonalDirty=false;
  } else if(jhPersonalReady&&!jhPersonalDirty&&!ui.busy&&!jhPendingWrites) {
    // Accept remote preferences only while the local tab has no edits to save.
    Object.entries(data.personal||{}).forEach(([k,v])=>{if(jhAllowed.includes(k))state[k]=v;});
    lastPersonal=JSON.stringify(jhPersonal());
  }
  Object.keys(COLLS).forEach(k=>{ready[k]=true;definitive[k]=true;});
  MODE.kind='live'; MODE.note='Supabase connected'; jhLastError='';
}
function jhRefresh(loadPersonal=false) {
  const revision=jhRevision,owner=jhUser?.id||null,epoch=jhSnapshotEpoch,pending=jhSnapshotPending;
  // Share reads only within this account and write generation. A post-write read
  // must never reuse a snapshot that began before the committed mutation.
  if(pending&&pending.revision===revision&&pending.owner===owner&&pending.epoch===epoch){pending.loadPersonal ||= loadPersonal;return pending.promise;}
  const request={revision,owner,epoch,loadPersonal,readVersion:++jhReadVersion,promise:null};
  jhSnapshotPending=request;
  request.promise=(async()=>{
    const {data,error}=await sb.rpc('journeyhub_snapshot');
    if(error)throw error;
    if(revision!==jhRevision||owner!==(jhUser?.id||null)||epoch!==jhSnapshotEpoch||request.readVersion!==jhReadVersion)return;
    // serverTime changes on every read. Keep minute-sensitive availability fresh,
    // but do not recreate an identical screen on each background poll.
    const {serverTime,...content}=data;
    const signature=JSON.stringify([revision,owner,Math.floor(Date.now()/60000),content]);
    const changed=request.loadPersonal||signature!==jhSnapshotRendered||MODE.kind!=='live';
    jhApply(data,request.loadPersonal);jhSnapshotRendered=signature;
    if(changed)render();else jhDrawStatus();
  })().finally(()=>{if(jhSnapshotPending===request)jhSnapshotPending=null;});
  return request.promise;
}
async function jhRaw(operation,payload,requestId=crypto.randomUUID()) {
  const revision=jhRevision;jhInvalidateSnapshot();
  const {data,error}=await sb.rpc('journeyhub_command',{p_operation:operation,p_payload:payload,p_request_id:requestId});
  if(revision===jhRevision)jhInvalidateSnapshot();
  if(error) throw error; return data;
}
async function jhCommand(operation,payload,refresh=true) {
  if(!jhUser) throw new Error('Please sign in first.');
  const uid=jhUser.id, revision=jhRevision;
  const fingerprint=JSON.stringify([uid,operation,payload]);
  const storageKey='journeyhub-pending-'+uid+'-'+operation;
  let pending; try{pending=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
  const requestId=pending?.fingerprint===fingerprint?pending.requestId:crypto.randomUUID();
  try{sessionStorage.setItem(storageKey,JSON.stringify({fingerprint,requestId}));}catch{}
  jhPendingWrites++;
  try {
    const result=await jhRaw(operation,payload,requestId);
    try{sessionStorage.removeItem(storageKey);}catch{}
    if(revision!==jhRevision) return result;
    if(refresh) {
      try{await jhRefresh();}catch(e){jhLastError='Saved to Supabase; refresh failed. Retry loading to see the latest data.';render();}
    }
    return result;
  }catch(e){
    // Known database errors rolled back. Keep only uncertain transport requests for retry.
    if(e.code&&/^[0-9A-Z]{5}$/.test(e.code))try{sessionStorage.removeItem(storageKey);}catch{}
    throw e;
  }finally{jhPendingWrites--;}
}
function jhShowError(e){jhLastError=jhError(e);toast('Not saved: '+jhLastError);render();}
async function jhAction(fn,msg){if(ui.busy)return;ui.busy=true;render();try{await fn();if(msg)toast(msg);}catch(e){jhShowError(e);}finally{ui.busy=false;render();}}

save = function(){
  // Auth sessions are managed by Supabase. Never trust locally cached account objects.
  if(!jhPersonalReady||!jhUser||jhLoading)return;
  const body=JSON.stringify(jhPersonal());
  if(body===lastPersonal)return;
  jhPersonalDirty=true;clearTimeout(personalTimer);
  const revision=jhRevision;
  personalTimer=setTimeout(()=>{
    jhQueue=jhQueue.catch(()=>{}).then(async()=>{
      if(revision!==jhRevision||!jhUser)return;
      try{await jhCommand('personal',{body:JSON.parse(body)},false);if(revision!==jhRevision)return;lastPersonal=body;jhPersonalDirty=JSON.stringify(jhPersonal())!==body;}
      catch(e){jhLastError='Preferences were not saved: '+jhError(e);}
      jhDrawStatus();
    });
  },700);
};
async function jhFlush(){clearTimeout(personalTimer);await jhQueue.catch(()=>{});if(jhUser&&jhPersonalReady&&JSON.stringify(jhPersonal())!==lastPersonal){const body=JSON.stringify(jhPersonal());await jhCommand('personal',{body:JSON.parse(body)},false);lastPersonal=body;jhPersonalDirty=false;}}
reserveSeats=async function(expId,slotId,guests){await jhFlush();const result=await jhCommand('book',{sessionId:slotId,guests});return DBC.bookings[result.id]||{id:result.id};};
submitOrder=async function(lines){await jhFlush();const result=await jhCommand('order',{items:lines.map(l=>({pid:l.pid,qty:l.qty})),method:state.method,address:clone(state.address)});return DBC.orders[result.id]||{id:result.id};};
cancelOrderDb=async function(id){await jhCommand('cancelOrder',{id});};
bookingError=(e,name)=>name+': '+jhError(e);
goOffline=function(){jhLastError='Offline writes are disabled. Reconnect to save changes.';jhDrawStatus();};
seedAll=resetShared=function(){toast('Starter data is managed in Supabase.');};
writeDoc=removeDoc=function(){throw new Error('Use the authorized Supabase operation.');};
let jhPlanDirty=false;
patchDoc=function(coll,id,patch){if(coll!=='sessionPlans')throw new Error('Unsupported direct write');if(!me())return;if(planDoc().status!=='draft'){toast('Only drafts can be edited');return;}DBC.sessionPlans[id]=Object.assign({},DBC.sessionPlans[id]||planDoc(),patch);jhPlanDirty=true;};

const jhOriginalRender=render;
render=function(){
  if(me()?.role==='host'&&['s-orders','s-order','s-insights','s-compare','s-plan'].includes(state.route))state.route='s-session';
  jhOriginalRender();jhDrawStatus();
};
function jhDrawStatus(){
  let el=document.getElementById('jh-status');
  if(!el){el=document.createElement('div');el.id='jh-status';el.className='notice warn';el.style.cssText='position:absolute;left:8px;right:8px;top:4px;z-index:100;font-size:12px;box-shadow:0 2px 10px #0002';app.appendChild(el);}
  if(!jhLastError){el.hidden=true;el.style.display='none';return;}
  el.hidden=false;el.style.display='flex';el.textContent=jhLastError+' ';
  const btn=document.createElement('button');btn.className='btn-text';btn.textContent='Retry';btn.onclick=()=>jhRefresh().catch(jhShowError);el.appendChild(btn);
}
connectingView=()=>'<div class="screen"><div class="empty" style="min-height:100%;justify-content:center">'+mark(48)+'<h1 class="h2">Connecting to Supabase</h1><p class="lead">Loading your online database.</p><button class="btn btn-soft" data-act="retryCloud">Retry connection</button></div></div>';
emptyDbView=()=>'<div class="screen"><div class="empty"><h1 class="h2">Catalog is empty</h1><p>Load the JourneyHub schema and catalog in Supabase.</p></div></div>';
guideView=()=>'<div class="g-brand">'+mark(36)+'<span class="wordmark">Journey Hub</span><span class="mode live">Supabase</span></div><div class="g-card"><h1 class="g-title">Your journey, saved online</h1><p class="g-text">Bookings, orders and staff updates are stored in Supabase. This page checks for updates every 10 seconds.</p><span class="label">'+esc(jhUser?.email||'Browsing as guest')+'</span><div class="seg"><button data-act="role" data-a="traveler">Traveler app</button><button data-act="role" data-a="staff">Staff workspace</button></div><button class="btn btn-outline" data-act="retryCloud">Refresh data</button></div><div class="g-card">'+guideList(false)+'</div><p class="g-sub">Sample catalog and prices. Payments, courier services and outbound reminders are not connected.</p>';
resetNote=()=> 'Resets your preferences only. Orders and bookings stay in Supabase.';
V.login=()=>{
  const P=state.params||{},mode=P.mode==='staff'?'staff':'traveler',view=P.view||'signin';
  if(!ui.loginDraft)ui.loginDraft=blankLogin();
  const signup=view==='signup'&&mode!=='staff',reset=view==='reset',recovery=jhRecovery;
  const title=recovery?'Set a new password':reset?'Reset your password':signup?'Create your account':mode==='staff'?'Staff sign in':'Sign in';
  let body='<div class="brandrow">'+mark(36)+'<span class="wordmark">Journey Hub</span></div><h1 class="h1">'+title+'</h1>'+loginError();
  body+='<form class="stack-12" data-form="login" data-a="'+(recovery?'recover':reset?'reset':signup?'signup':mode+'-signin')+'" novalidate>';
  if(signup)body+=loginField('lg-name','name','Full name',{ac:'name',max:60});
  if(!recovery)body+=loginField('lg-email','email','Email',{type:'email',ac:'username',icon:'mail'});
  if(!reset||recovery)body+=loginField('lg-pw','password',recovery?'New password':'Password',{type:'password',ac:signup||recovery?'new-password':'current-password',icon:'lock',hint:signup||recovery?'At least 8 characters, with a letter and a number.':''});
  if(signup)body+=loginField('lg-country','country','Home country',{select:COUNTRIES});
  body+=loginSubmit(recovery?'Save password':reset?'Send reset email':signup?'Create account':'Sign in','Please wait…',mode)+'</form>';
  if(!recovery)body+='<button class="btn-text" data-act="loginView" data-a="'+(reset||signup?'signin':'reset')+'">'+(reset||signup?'Back to sign in':'Forgot password?')+'</button>';
  if(mode==='traveler'&&!recovery&&!reset)body+='<button class="btn btn-outline" data-act="loginView" data-a="'+(signup?'signin':'signup')+'">'+(signup?'Already have an account?':'Create an account')+'</button><button class="btn-text" data-act="guest">Continue as guest</button>';
  body+='<button class="btn-text" data-act="'+(mode==='staff'?'staffTraveler':'staffEntry')+'">'+(mode==='staff'?'Back to traveler app':'Staff sign in')+'</button>';
  body+='<p class="fine">'+(mode==='staff'?'Use your assigned staff email and password. Staff access is checked securely after sign-in.':'Your bookings and orders stay with your account.')+'</p>';
  return {bar:bar({title:'Journey Hub'}),body:'<div class="content login">'+body+'</div>'};
};
async function jhLoadUser(user,loadPersonal=true){
  jhRevision++;jhLoading=true;jhPersonalReady=false;ui.busy=false;clearTimeout(personalTimer);jhUser=user;
  state=defaults();state.cart={};state.auth={traveler:null,staff:null};state.guestOk=true;state.role='traveler';state.route='journey';state.accounts={};state.acctData={};jhPlanDirty=false;
  try{if(user)await jhRaw('profile',{});await jhRefresh(loadPersonal);jhPersonalReady=!!user;if(typeof snRestoreWorkspace==='function')snRestoreWorkspace();}
  finally{jhLoading=false;}
}
doLogin=async function(kind){
  if(ui.loginBusy)return;
  const draft=ui.loginDraft||{},email=normEmail(draft.email),pw=draft.password||'',staffMode=state.params?.mode==='staff',next=state.params?.next;
  const guestData=!jhUser?clone(jhPersonal()):null;
  ui.loginErr=null;ui.loginBusy=true;render();
  try{
    if(kind==='recover'){
      if(!jhRecovery||!PW_RE.test(pw))throw new Error('Use at least 8 characters, with a letter and a number.');
      const {error}=await sb.auth.updateUser({password:pw});if(error)throw error;
      jhRecovery=false;history.replaceState(null,'',location.pathname);state.route='journey';toast('Password updated');return;
    }
    if(!EMAIL_RE.test(email))throw new Error('Enter a valid email address.');
    if(kind==='reset'){
      const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;
      toast('If this account exists, check your email for a reset link.');return;
    }
    if(kind==='signup'){
      if(!PW_RE.test(pw))throw new Error('Use at least 8 characters, with a letter and a number.');
      if(String(draft.name||'').trim().length<2)throw new Error('Enter your full name.');
      const {data,error}=await sb.auth.signUp({email,password:pw,options:{emailRedirectTo:location.origin+location.pathname,data:{display_name:draft.name.trim(),home_country:draft.country}}});if(error)throw error;
      if(!data.session){ui.loginDraft=Object.assign(blankLogin(),{email});state.params.view='signin';toast('Check your email to confirm your account.');return;}
      await jhLoadUser(data.user);
    }else{
      if(!pw)throw new Error('Enter your password.');
      await jhFlush();
      const {data,error}=await sb.auth.signInWithPassword({email,password:pw});if(error)throw error;
      await jhLoadUser(data.user);
    }
    if(guestData&&!Object.keys(jhLastSnapshot?.personal||{}).length){jhAllowed.forEach(k=>state[k]=guestData[k]);normalizeState();if(traveler()){state.address.guest=state.address.guest||traveler().name;state.address.name=state.address.name||traveler().name;}await jhFlush();}
    if(staffMode&&!me())throw new Error('Signed in as a traveler. This account has no staff role.');
    const staff=!!me(),validNext=next?.route&&typeof V[next.route]==='function'&&next.route.startsWith('s-')===staff;
    state.role=staff?'staff':'traveler';state.route=validNext?next.route:staff?(me().role==='host'?'s-session':'s-today'):'journey';state.params=validNext?(next.params||{}):{};ui.loginDraft=null;if(typeof snRememberWorkspace==='function')snRememberWorkspace();toast('Signed in');
  }catch(e){ui.loginErr=jhError(e);if(state.route!=='login'&&staffMode){state.role='staff';state.route='login';state.params={mode:'staff'};}}
  finally{ui.loginBusy=false;render();}
};
signOut=async function(){await jhAction(async()=>{await jhFlush();jhLoading=true;try{const{error}=await sb.auth.signOut();if(error)throw error;await jhLoadUser(null);state.role=null;state.route='welcome';}finally{jhLoading=false;}},'Signed out');};
A.signOut=()=>signOut();
A.retryCloud=()=>jhRefresh().catch(jhShowError);
A.useDemo=A.demoSignIn=()=>openLogin('traveler');
A.goLocal=()=>jhShowError(new Error('Online mode requires a Supabase connection.'));
A.seedDb=()=>toast('Manage catalog data in Supabase.');
A.reset=()=>jhAction(async()=>{const d=defaults();jhAllowed.forEach(k=>state[k]=d[k]);state.cart={};await jhFlush();},'Preferences reset');
A.choose=(id,choice)=>jhAction(()=>jhCommand('orderChoice',{id,choice}),'Delivery choice saved');
A.unchoose=id=>jhAction(()=>jhCommand('orderChoice',{id,choice:null}),'Delivery choice reopened');
A.orderStep=(id,step)=>jhAction(()=>jhCommand('orderStep',{id,step}),'Order updated');
A.remind=()=>toast('Outbound messages are not connected. No reminder was sent.');
A.checkIn=id=>jhAction(()=>jhCommand('checkin',{id,checked:true}),'Checked in');
A.undoCheckIn=id=>jhAction(()=>jhCommand('checkin',{id,checked:false}),'Check-in undone');
A.checkInCode=()=>{
  const raw=String(ui.codeText||'').trim().toUpperCase(),parts=raw.split('|'),code=parts.length>=3?parts[2]:raw;
  const b=bookingsList().find(b=>b.code===code&&(parts.length<3||b.id===parts[1]));
  if(!b){ui.codeMsg={ok:false,text:'No matching booking. Refresh data and check the code.'};render();return;}
  return jhAction(async()=>{await jhCommand('checkin',{id:b.id,checked:true});ui.codeMsg={ok:true,text:'Checked in '+b.name};ui.codeText='';});
};
async function jhSavePlan(){const p=planDoc();if(!jhPlanDirty)return;await jhCommand('plan',{id:p.id,action:'save',time:p.time,cap:p.cap,price:p.price,promo:p.promo,reason:p.reason},false);jhPlanDirty=false;}
function jhPlanAction(action){return jhAction(async()=>{if(action==='save'||action==='submit')await jhSavePlan();if(action!=='save')await jhCommand('plan',{id:PLAN_ID,action});else await jhRefresh();},'Session plan saved');}
A.splanSave=()=>jhPlanAction('save');A.splanSubmit=()=>jhPlanAction('submit');A.splanWithdraw=()=>jhPlanAction('withdraw');A.splanApprove=()=>jhPlanAction('approve');A.splanNew=()=>jhPlanAction('new');
A.viewSlot=()=>{const id=planDoc().createdSessionId;if(!id){toast('Approve a session first');return;}state.role='traveler';state.route='exp';state.params={id:planDoc().exp};state.expSel[planDoc().exp]={slot:id};render();};
// Database inspection in the app shows only the current user's authorized snapshot.
const originalDb=V.db;
V.db=()=>{const v=originalDb();v.body=v.body.replace(/ref\/v1\//g,'catalog/');return v;};
async function jhStart(){
  jhRecovery=new URLSearchParams(location.hash.slice(1)).get('type')==='recovery';
  try{
    const{data,error}=await sb.auth.getSession();if(error)throw error;
    await jhLoadUser(data.session?.user||null);
    if(jhRecovery){state.route='login';state.params={mode:'traveler',view:'recover'};}
    render();
  }catch(e){jhLastError=jhError(e);MODE.kind='connecting';render();}
  AI=null;AI_STATE='off';
  sb.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){jhRecovery=true;state.route='login';state.params={mode:'traveler',view:'recover'};render();}
    // Defer work outside the Auth callback to avoid holding the auth lock.
    if(!ui.loginBusy&&!jhLoading&&(event==='SIGNED_OUT'||(event==='SIGNED_IN'&&session?.user.id!==jhUser?.id)))
      setTimeout(()=>jhLoadUser(session?.user||null).catch(jhShowError),0);
  });
  jhPoll=setInterval(()=>{if(document.visibilityState==='visible'&&!jhLoading&&!ui.busy&&!jhPendingWrites)jhRefresh().catch(e=>{jhLastError='Connection interrupted: '+jhError(e);jhDrawStatus();});},10000);
  window.addEventListener('online',()=>jhRefresh().catch(jhShowError));
  window.addEventListener('beforeunload',e=>{if(jhPersonalDirty||jhPlanDirty||jhPendingWrites){e.preventDefault();e.returnValue='';}});
}
jhStart();
