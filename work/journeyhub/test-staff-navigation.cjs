/* Staff navigation regression: bundle code, mocked Auth/RPC, no remote login or writes. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {JSDOM, VirtualConsole} = require('jsdom'), {IDBFactory} = require('fake-indexeddb'), {webcrypto} = require('node:crypto');
const out = path.resolve(__dirname, '../../outputs/JourneyHub-Supabase');
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
assert(html.includes('function snRestoreWorkspace()'), 'Build with staff-navigation.js before running this test.');
const copy = value => JSON.parse(JSON.stringify(value));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { for (let i=0; i<250 && !fn(); i++) await delay(10); assert(fn(), label); };
const uuid = n => '35000000-0000-4000-8000-' + String(n).padStart(12, '0');
const people = {
  coordinator: {id:uuid(1), email:'navigation-coordinator@example.invalid', staff:{id:'NAV-COORD', name:'Navigation Coordinator', role:'coordinator'}},
  manager: {id:uuid(2), email:'navigation-manager@example.invalid', staff:{id:'NAV-MANAGER', name:'Navigation Manager', role:'duty_manager'}},
  traveler: {id:uuid(3), email:'navigation-traveler@example.invalid', staff:null},
  host: {id:uuid(4), email:'navigation-host@example.invalid', staff:{id:'NAV-HOST', name:'Navigation Host', role:'host'}}
};
const authUser = person => person ? {id:person.id, email:person.email, email_confirmed_at:'2026-01-01T00:00:00Z'} : null;
const future = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const activities = ['craft','silk','herbal'];
const fixture = {
  personal:{}, stores:[{store_id:'rf',name:'Navigation shop',kind:'Craft',area:'Silom',distance_km:1,opening_hours:'09:00–17:00',issues_vat_forms:false}],
  products:[{product_id:'tote',store_id:'rf',name:'Navigation tote',price_thb:250,description:'Offline fixture.',categories:['accessories'],made_to_order:false}],inventory:[{product_id:'tote',stock:10}],
  venues:[{venue_id:'navigation-venue',name:'Navigation venue',city:'Bangkok',time_zone:'Asia/Bangkok'}],
  experiences:activities.map((id,i)=>({experience_id:id,name:['Thai Craft Lab','Silk Workshop','Herbal Workshop'][i],kind:'Craft',duration_min:150,price_thb:1400,rating:4.5,review_count:5,host_name:'Navigation host',languages:['English'],venue_id:'navigation-venue',details:{}})),
  sessions:activities.map((id,i)=>({session_id:['c18','s18','h18'][i],experience_id:id,starts_at:future+'T03:00:00Z',ends_at:future+'T05:30:00Z',capacity:30,seats_held_other_channels:0,seats_taken:0,price_thb:1400,status:'open'})),
  bookings:[],orders:[],liveMetrics:[],
  sessionPlans:[
    {plan_id:'PLAN-NAV-OTHER',experience_id:'craft',session_date:future,start_time:'10:00:00',capacity:30,price_thb:1400,promo_budget_thb:0,reason:'An unrelated draft must not replace the selected plan.',status:'draft',version:1,events:[]},
    {plan_id:'PLAN-NAV-TARGET',experience_id:'craft',session_date:future,start_time:'14:00:00',capacity:25,price_thb:1500,promo_budget_thb:1000,reason:'The exact submitted plan to review.',status:'draft',submitted_by:'NAV-COORD',version:4,events:[]}
  ],
  metrics:activities.flatMap(id=>[1,2,3,4].map(week=>({experience_id:id,month:'2026-09-01',week,seats_offered:30,booked:25,cancelled:2,attended:21,price:1400,cost:250})))
};
fixture.staffWorkflowVersion=1;fixture.planningSettings=Object.fromEntries(activities.map(id=>[id,{timeZone:'Asia/Bangkok',duration:150,maxCapacity:40,price:1400,hostRate:.5,materialCost:250}]));
for(const p of fixture.sessionPlans)Object.assign(p,{created_by:'NAV-COORD',startsAt:p.session_date+'T03:00:00Z',assumptions:{bookingRate:.8,cancellationRate:.1,attendanceRate:.9,hostRate:.5,materialCost:250,basis:'Navigation fixture assumptions'}});
const windows = [], personal = new Map();
async function boot({person=null,storage={}}={}) {
  const errors=[], posts=[], commands=[], logins=[], authEvents=[], localFixture=copy(fixture), vc=new VirtualConsole();
  vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
  const dom=new JSDOM(html,{url:'http://localhost:4173/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}), w=dom.window;
  windows.push(w);Object.assign(w,{indexedDB:new IDBFactory(),Blob,Headers,Request,Response,TextEncoder,TextDecoder,AbortController,WebSocket});Object.defineProperty(w,'crypto',{value:webcrypto});
  w.URL.createObjectURL=()=> 'blob:navigation-'+webcrypto.randomUUID();w.URL.revokeObjectURL=()=>{};
  Object.entries(storage).forEach(([key,value])=>w.sessionStorage.setItem(key,value));
  let signedIn=person;
  w.fixtureSession=()=>signedIn?{user:authUser(signedIn),access_token:'mock-navigation-'+signedIn.id}:null;
  w.fixtureLogin=async ({email,password})=>{
    logins.push(email);const found=Object.values(people).find(p=>p.email===email);
    if(!found||password!=='OnlyMockCredentials123')return {data:{user:null,session:null},error:{message:'Invalid login credentials'}};
    signedIn=found;return {data:{user:authUser(found),session:w.fixtureSession()},error:null};
  };
  w.fixtureSaveDelay=0;
  w.fixtureSignOut=async()=>{authEvents.push({event:'signOut',commandCount:commands.length});signedIn=null;return {error:null};};
  w.fixtureRPC=async (name,args={})=>{
    if(name==='journeyhub_calendar_state')return {data:{removed:[]},error:null};if(name==='journeyhub_snapshot')return {data:{...copy(localFixture),profile:signedIn?{id:signedIn.id,email:signedIn.email,name:'Navigation QA',country:'Singapore'}:null,staff:copy(signedIn?.staff||null),personal:copy(personal.get(signedIn?.id)||{}),sessionPlans:signedIn?.staff&&signedIn.staff.role!=='host'?copy(localFixture.sessionPlans):[],metrics:signedIn?.staff&&signedIn.staff.role!=='host'?copy(localFixture.metrics):[]},error:null};
    if(name==='journeyhub_agent_list')return {data:[],error:null};
    if(name==='journeyhub_command'){
      assert(signedIn,'mock business command requires auth');commands.push(copy(args));
      assert(['profile','personal','checkin','plan'].includes(args.p_operation),'Navigation test must not create bookings, session plans or orders.');
      if(args.p_operation==='personal')personal.set(signedIn.id,copy(args.p_payload.body));
      if(args.p_operation==='plan'){
        assert(signedIn.staff,'Only mock staff can save');const p=args.p_payload;
        assert.equal(p.action,'save','Navigation test only saves an existing fixture draft');
        const record=localFixture.sessionPlans.find(r=>r.plan_id===p.id);assert(record&&record.status==='draft','Existing fixture draft');assert.equal(p.version,record.version,'Draft revision is current');
        await delay(w.fixtureSaveDelay);
        Object.assign(record,{session_date:p.date,start_time:p.startTime,capacity:p.cap,price_thb:p.price,promo_budget_thb:p.promo,reason:p.reason,version:record.version+1});
        return {data:{id:record.plan_id,status:record.status,version:record.version},error:null};
      }
      if(args.p_operation==='checkin'){
        assert(signedIn.staff,'Only the mock staff can check in');
        const booking=localFixture.bookings.find(b=>b.booking_id===args.p_payload.id&&b.status==='confirmed');assert(booking,'Mock confirmed booking exists');
        booking.checked_in_at=args.p_payload.checked?new Date().toISOString():null;
      }
      return {data:{},error:null};
    }
    throw Error('Unexpected mocked RPC: '+name);
  };
  w.fetch=async(input,init={})=>{
    assert(String(input?.url||input).includes('/functions/v1/journeyhub-agent'),'All external traffic must be mocked.');
    if(init.method==='POST'){
      const payload=JSON.parse(init.body);posts.push(payload);
      assert(['care_status','history_list'].includes(payload.action),'Navigation must not perform real agent actions.');
      return Response.json(payload.action==='care_status'?{trips:[]}:{items:[],hasMore:false});
    }
    return Response.json({ai:{ready:false,provider:'deepseek'},email:{ready:false},worker:{ready:false},booking:{mode:'journeyhub_catalog',sample:true}});
  };
  w.eval(fs.readFileSync(path.join(out,'vendor/supabase.js'),'utf8'));w.eval(fs.readFileSync(path.join(out,'config.js'),'utf8'));
  let code=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean).join('\n');
  assert.equal((code.match(/jhStart\(\);/g)||[]).length,1,'Single startup injection target');
  code=code.replace('jhStart();',`sb.rpc=(name,args)=>window.fixtureRPC(name,args);sb.auth.getSession=async()=>({data:{session:window.fixtureSession()},error:null});sb.auth.getUser=async()=>({data:{user:window.fixtureSession()?.user||null},error:null});sb.auth.signInWithPassword=args=>window.fixtureLogin(args);sb.auth.signOut=()=>window.fixtureSignOut();sb.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}});window.NAV_TEST={get ready(){return !jhLoading&&!!jhLastSnapshot},get settled(){return !jmCache.loading&&!ag.loading&&!ag.healthLoading},get state(){return state},get ui(){return ui},get A(){return A},get staff(){return me()},get plan(){return sfPlan()},get authError(){return jhLastError},get db(){return DBC},get sessionStats(){return soStats(soSession())},go,render,doLogin,signOut,jhRefresh};jhStart();`);
  w.eval(code);const t=w.NAV_TEST;await until(()=>t.ready&&t.settled,'mock app and journal bootstrap');await delay(20);
  const app=()=>w.document.querySelector('#app');
  const screen=label=>{assert(!app().textContent.includes('Something went wrong'),label+' renders');assert.equal(t.authError,'',label+' has no connection error');};
  const login=async(who,kind='staff-signin')=>{t.ui.loginDraft={email:people[who].email,password:'OnlyMockCredentials123'};await t.doLogin(kind);await until(()=>t.settled,'login async state settles');screen('login');};
  const exportStorage=()=>Object.fromEntries(Array.from({length:w.sessionStorage.length},(_,i)=>{const key=w.sessionStorage.key(i);return [key,w.sessionStorage.getItem(key)];}));
  const close=async()=>{await until(()=>t.settled,'async work settles before closing');await delay(20);assert.deepEqual(errors,[],'No browser errors');w.close();};
  return {w,t,app,screen,login,close,exportStorage,logins,commands,posts,authEvents,readPlan:id=>copy(localFixture.sessionPlans.find(p=>p.plan_id===id))};
}
(async()=>{
  let h=await boot(),{t,app}=h;
  assert.equal(t.state.route,'journey');
  for(const route of ['journey','home','shop','orders','me']){
    t.state.role='traveler';t.go(route);h.screen(route);
    const entry=app().querySelector('[data-act="staffEntry"]');assert(entry,'Guest sees staff entry on '+route);assert.equal(entry.textContent.trim(),'Staff sign in');
  }
  app().querySelector('[data-act="staffEntry"]').click();assert.equal(t.state.route,'login');assert.equal(t.state.params.mode,'staff');assert(app().textContent.includes('Staff sign in'));
  await h.login('coordinator');assert.equal(t.staff.role,'coordinator');assert.equal(t.state.role,'staff');assert.equal(t.state.route,'s-today');assert.equal(h.logins.length,1,'Actual doLogin called mocked Auth');
  assert(app().querySelector('nav[aria-label="Staff"]'),'Staff navigation is shown');assert(app().querySelector('[data-act="staffMenu"]'),'Staff account menu is available');

  // Multiple plans deliberately exist: switching approvers must retain this exact plan.
  t.go('s-plan',{id:'PLAN-NAV-TARGET'});assert.equal(t.plan.id,'PLAN-NAV-TARGET');await t.A.switchToManager();
  assert.equal(t.state.params.next.route,'s-plan');assert.equal(t.state.params.next.params.id,'PLAN-NAV-TARGET');
  await h.login('manager');assert.equal(t.state.route,'s-plan');assert.equal(t.state.params.id,'PLAN-NAV-TARGET');assert.equal(t.plan.id,'PLAN-NAV-TARGET');assert(app().querySelector('[data-act="splanPublish"]'),'Staff sees direct publication control');
  let saved=h.exportStorage();await h.close();

  h=await boot({person:people.manager,storage:saved});t=h.t;app=h.app;
  assert.equal(t.state.role,'staff');assert.equal(t.state.route,'s-plan','Authenticated reload restores staff route');assert.equal(t.state.params.id,'PLAN-NAV-TARGET');assert.equal(t.plan.id,'PLAN-NAV-TARGET');
  await t.A.staffTraveler();assert.equal(t.state.role,'traveler');assert.equal(t.state.route,'journey');assert.equal(app().querySelector('[data-act="staffEntry"]').textContent.trim(),'Staff workspace');
  saved=h.exportStorage();await h.close();

  h=await boot({person:people.manager,storage:saved});assert.equal(h.t.state.role,'traveler','Explicit traveler workspace survives reload');assert.equal(h.t.state.route,'journey');h.app().querySelector('[data-act="staffEntry"]').click();await until(()=>h.t.state.role==='staff','Workspace switch waits for pending draft save');assert.equal(h.t.state.route,'s-today');await h.close();
  const foreignPrefs=Object.fromEntries(Object.entries(saved).filter(([key])=>key.includes(people.manager.id)));
  h=await boot({person:people.coordinator,storage:foreignPrefs});assert.equal(h.t.state.role,'staff','Another account cannot inherit traveler workspace preference');assert.equal(h.t.state.route,'s-today');await h.close();

  h=await boot({person:people.host});assert.equal(h.t.state.role,'staff');assert.equal(h.t.state.route,'s-today','Host default is the operational dashboard');h.screen('Host workspace');await h.close();

  h=await boot();t=h.t;t.go('login',{mode:'traveler',view:'signin'});await h.login('coordinator','traveler-signin');assert.equal(t.state.role,'traveler','Traveler sign-in must not be overridden by staff membership');assert.equal(t.state.route,'journey');assert.equal(t.staff.role,'coordinator','Staff access is retained');t.A.staffEntry();await until(()=>t.state.role==='staff'&&t.settled,'explicit staff workspace switch');assert.equal(t.state.role,'staff');assert.equal(t.state.route,'s-today');await h.close();

  h=await boot();t=h.t;t.A.staffEntry();await h.login('traveler');
  assert.equal(t.staff,null,'Traveler never gains a staff role');assert.equal(t.state.route,'login','Unauthorized account remains on sign-in');assert.equal(t.state.params.mode,'staff');assert(t.ui.loginErr.includes('no staff role'));assert(!h.app().querySelector('nav[aria-label="Staff"]'),'Unauthorized user does not see staff tabs');assert.deepEqual(Object.keys(t.db.sessionPlans),[],'No internal plan snapshot leaked');
  await h.close();
  const forged={['journeyhub-workspace-'+people.traveler.id]:JSON.stringify({mode:'staff',route:'s-plan',params:{id:'PLAN-NAV-TARGET'}})};
  h=await boot({person:people.traveler,storage:forged});assert.equal(h.t.state.role,'traveler','Storage preference cannot authorize a traveler');assert.equal(h.t.state.route,'journey');await h.t.signOut();assert.equal(h.t.staff,null);assert.equal(h.t.state.route,'welcome');await h.close();

  // Logging out immediately after typing must flush the staff draft before Auth loses its session.
  h=await boot({person:people.coordinator});t=h.t;t.go('s-plan',{id:'PLAN-NAV-OTHER'});
  const reason=h.app().querySelector('#sf-reason'),changedReason='Saved even when signing out before the debounce runs.';
  assert(reason&&!reason.disabled);reason.focus();reason.value=changedReason;reason.dispatchEvent(new h.w.InputEvent('input',{bubbles:true,inputType:'insertText',data:changedReason}));
  h.w.fixtureSaveDelay=60;const logout=t.A.signOut();await delay(10);assert.equal(h.authEvents.length,0,'Auth sign-out waits for the pending staff save');assert(t.staff,'Staff session remains available for the save');
  await logout;assert.equal(h.readPlan('PLAN-NAV-OTHER').reason,changedReason);assert.equal(h.readPlan('PLAN-NAV-OTHER').version,2);assert.equal(h.commands.filter(c=>c.p_operation==='plan').length,1,'Immediate logout saves the draft once');assert.equal(h.authEvents.length,1);assert.equal(t.staff,null);assert.equal(t.state.route,'welcome');await h.close();

  // Operational cards use real booking quantities/prices and the selected session, not prototype constants.
  const booking=(id,slot,guests,unit,status,code,checked=false)=>({booking_id:id,session_id:slot,traveler_id:uuid(90),guest_name:id==='NAV-B1'?'<img class="injected-guest" src=x onerror=alert(1)>':'Navigation guest',guests,unit_price_thb:unit,status,channel:'app',checkin_code:code,checked_in_at:checked?new Date().toISOString():null,created_at:new Date().toISOString()});
  fixture.bookings=[booking('NAV-B1','c18',2,1600,'confirmed','CRAFT1'),booking('NAV-B2','c18',1,1400,'confirmed','CRAFT2',true),booking('NAV-B3','c18',4,900,'cancelled','CANCEL'),booking('NAV-B4','c18',1,900,'no_show','NOSHOW',true),booking('NAV-B5','s18',5,1800,'confirmed','OTHER1')];
  fixture.sessions[0].seats_held_other_channels=3;fixture.sessions[0].seats_taken=6;fixture.sessions[1].seats_taken=5;
  h=await boot({person:people.coordinator});t=h.t;app=h.app;t.A.go('s-session','c18');h.screen('Selected session');
  let stats=t.sessionStats;assert.equal(stats.confirmed,3);assert.equal(stats.checked,1);assert.equal(stats.cancelled,4);assert.equal(stats.value,4600,'Stored booking prices determine value');assert.equal(stats.left,24,'Other-channel holds are subtracted once');
  assert(!app().querySelector('.injected-guest'),'Guest names are escaped');assert(app().textContent.includes('3 confirmed')||app().textContent.includes('Confirmed guests3'),'Session displays current guests');
  const before=h.commands.length;t.ui.codeText='OTHER1';await t.A.checkInCode();assert.equal(h.commands.length,before,'Wrong-session code never reaches command API');assert.equal(t.ui.codeMsg.ok,false);
  t.ui.codeText='CRAFT1';await t.A.checkInCode();assert.equal(h.commands.at(-1).p_operation,'checkin');assert.equal(h.commands.at(-1).p_payload.id,'NAV-B1');assert.equal(t.sessionStats.checked,3,'Correct code refreshes selected-session attendance');
  t.A.go('s-session','s18');assert.equal(t.sessionStats.confirmed,5,'Another session has its own roster');assert.equal(t.sessionStats.value,9000);assert.equal(t.sessionStats.checked,0);await h.close();
  console.log('PASS: staff entry/auth routing, exact approval plan across account switch/reload, scoped workspace preferences, host/traveler modes, unauthorized denial, draft flush before logout, selected-session counts/prices/holds, safe guest rendering and session-scoped check-in. All transport mocked; no remote requests or credentials.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>windows.forEach(w=>{try{w.close();}catch{}}));
