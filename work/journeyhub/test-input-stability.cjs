/* Native-node/caret/IME regression tests. All transport is mocked; no account or catalog writes. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),{webcrypto}=require('node:crypto');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase'),html=fs.readFileSync(path.join(out,'index.html'),'utf8');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{for(let i=0;i<150&&!fn();i++)await delay(10);assert(fn(),label);};
const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
const snapshot={profile:null,personal:{},staff:null,bookings:[],orders:[],sessionPlans:[],metrics:[],
  stores:[{store_id:'rf',name:'Fixture shop',kind:'Craft',area:'Riverside',distance_km:1,opening_hours:'09:00–17:00',issues_vat_forms:false}],
  products:[{product_id:'tote',store_id:'rf',name:'Fixture tote',price_thb:250,description:'Offline fixture.',categories:['accessories'],made_to_order:false}],inventory:[{product_id:'tote',stock:10}],
  venues:[{venue_id:'test-shanghai',name:'Riverside',city:'Shanghai',time_zone:'Asia/Shanghai'}],
  experiences:[{experience_id:'test-walk',name:'Shanghai riverwalk',kind:'Culture',duration_min:90,price_thb:450,rating:null,review_count:0,host_name:'Local host',languages:['English'],venue_id:'test-shanghai',details:{durationMinutes:90}}],
  sessions:[{session_id:'test-session',experience_id:'test-walk',starts_at:date+'T01:30:00Z',ends_at:date+'T03:00:00Z',capacity:12,seats_held_other_channels:0,seats_taken:0,price_thb:450,status:'open'}]};
const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
const dom=new JSDOM(html,{url:'http://localhost:4173/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
Object.assign(w,{indexedDB:new IDBFactory(),Blob,Headers,Request,Response,TextEncoder,TextDecoder,AbortController,WebSocket});Object.defineProperty(w,'crypto',{value:webcrypto});
w.URL.createObjectURL=()=> 'blob:input-fixture-'+webcrypto.randomUUID();w.URL.revokeObjectURL=()=>{};
let snapshots=0;
w.fetch=async(input,init={})=>{assert(String(input?.url||input).includes('/functions/v1/journeyhub-agent'),'unexpected network call');assert.notEqual(init.method,'POST','typing cannot generate an AI plan');return new Response(JSON.stringify({ai:{ready:false,provider:'deepseek',model:'deepseek-chat'},email:{ready:false},worker:{ready:false},booking:{mode:'journeyhub_catalog',sample:true}}));};
w.fixtureRPC=async name=>{await delay(5);if(name==='journeyhub_calendar_state')return {data:{removed:[]},error:null};if(name==='journeyhub_snapshot'){snapshots++;return {data:JSON.parse(JSON.stringify(snapshot)),error:null};}if(name==='journeyhub_agent_list')return {data:[],error:null};throw Error('Unexpected RPC: '+name);};
w.eval(fs.readFileSync(path.join(out,'vendor/supabase.js'),'utf8'));w.eval(fs.readFileSync(path.join(out,'config.js'),'utf8'));
let script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean).join('\n');
if(!script.includes('const inputStablePreviousRender')){
  assert(process.argv.includes('--source'),'Build with input-stability.js before running this test (or use --source while developing).');
  script=script.replace('jhStart();',fs.readFileSync(path.join(__dirname,'input-stability.js'),'utf8')+'\njhStart();');
}
script=script.replace('jhStart();',`sb.rpc=name=>window.fixtureRPC(name);sb.auth.getSession=async()=>({data:{session:null},error:null});sb.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}});window.IS_TEST={get ready(){return !jhLoading&&!!jhLastSnapshot&&jmCache.loaded},get state(){return state},get A(){return A},get ui(){return ui},get ag(){return ag},get cache(){return jmCache},get draft(){return jmNew},go,render,jhRefresh,jmLoad,replaceLogin(fn){const old=doLogin;doLogin=fn;return old;},setOwner(id){jhUser=id?{id,email:'fixture@example.test',email_confirmed_at:'2026-01-01T00:00:00Z'}:null;jhRevision++;jhPersonalReady=false;render();}};jhStart();`);
w.eval(script);
(async()=>{
  const t=w.IS_TEST;await until(()=>t.ready,'offline app bootstrap');await delay(20);
  const app=()=>w.document.querySelector('#app');
  const visit=(route,params={})=>{t.state.role='traveler';t.state.guestOk=true;t.go(route,params);assert(!app().textContent.includes('Something went wrong'),route);};
  const type=(el,value,{start=value.length,end=start,direction='none',composing=false}={})=>{assert(el,'editable field exists');el.focus();el.value=value;el.dispatchEvent(new w.InputEvent('input',{bubbles:true,inputType:'insertText',data:value,isComposing:composing}));try{el.setSelectionRange(start,end,direction);}catch{}return el;};
  const selection=el=>[el.selectionStart,el.selectionEnd,el.selectionDirection];
  const stable=(el,selector,before,label)=>{assert.strictEqual(app().querySelector(selector),el,label+' keeps the exact DOM node');assert.strictEqual(w.document.activeElement,el,label+' keeps focus');if(before)assert.deepEqual(selection(el),before,label+' keeps the selection');};
  const refresh=async()=>{const before=snapshots;await t.jhRefresh();assert(snapshots>before,'actual async snapshot/render path ran');};

  // Typed search keeps updating its result region without replacing the search box.
  t.A.destination('Shanghai');let search=type(app().querySelector('#home-q'),'river',{start:1,end:4,direction:'backward'}),caret=selection(search);
  assert(app().querySelector('[data-region="homeResults"]').textContent.includes('Shanghai riverwalk'),'search results update while focused');
  snapshot.experiences[0].name='Updated Shanghai riverwalk';await refresh();stable(search,'#home-q',caret,'catalog refresh');
  assert(!app().querySelector('[data-region="homeResults"]').textContent.includes('Updated'),'full background redraw waits for editing exit');
  search.blur();await delay(20);assert(app().textContent.includes('Updated Shanghai riverwalk'),'latest data appears after blur');
  assert.strictEqual(w.document.activeElement,w.document.body,'background flush does not reopen the keyboard');

  // Passwords and a move between fields retain their native control, not a replacement clone.
  visit('login',{mode:'traveler',view:'signin'});const password=type(app().querySelector('#lg-pw'),'fixture-password-123',{start:3,end:9,direction:'backward'});caret=selection(password);
  await refresh();stable(password,'#lg-pw',caret,'password refresh');assert.equal(t.ui.loginDraft.password,'fixture-password-123');
  const email=type(app().querySelector('#lg-email'),'alice@example.test');await delay(10);await refresh();stable(email,'#lg-email',null,'switching between login fields');assert.strictEqual(app().querySelector('#lg-pw'),password,'tabbing within a form does not flush pending redraws');
  // An IME commit must not submit a form even on browsers whose Enter lacks isComposing.
  let submits=0;const oldLogin=t.replaceLogin(()=>{submits++;});email.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true,data:''}));
  const submit=new w.Event('submit',{bubbles:true,cancelable:true});app().querySelector('[data-form="login"]').dispatchEvent(submit);assert(submit.defaultPrevented);assert.equal(submits,0);
  email.dispatchEvent(new w.CompositionEvent('compositionend',{bubbles:true,data:'上海'}));t.replaceLogin(oldLogin);

  // Delivery sheets keep native editing nodes, and blur cannot trigger the old sheet autofocus.
  visit('checkout');t.A.addr('intl');await delay(40);const address=type(app().querySelector('#ad-line1'),'88 Riverside Road',{start:3,end:12});caret=selection(address);
  await refresh();stable(address,'#ad-line1',caret,'address refresh');address.blur();await delay(20);assert.strictEqual(w.document.activeElement,w.document.body,'sheet keyboard stays dismissed');assert.strictEqual(app().querySelector('#ad-line1'),address,'open sheet stays stable after keyboard dismissal');
  app().querySelector('[data-act="closeSheet"]').click();assert(!app().querySelector('.sheet'),'explicit modal close is immediate');
  visit('me');t.A.passport();await delay(40);const passport=type(app().querySelector('#pp-no'),'K1234567',{start:2,end:5});caret=selection(passport);await refresh();stable(passport,'#pp-no',caret,'passport refresh');app().querySelector('[data-act="closeSheet"]').click();

  // Journal fields have no IDs: the previous focus-by-ID workaround could not protect them.
  t.A.jmNew();const title=type(app().querySelector('#jm-new-form [name="title"]'),'Shanghai weekend',{start:2,end:8,direction:'backward'});assert.equal(title.id,'');caret=selection(title);
  await t.jmLoad();stable(title,'#jm-new-form [name="title"]',caret,'journal cache reload');await refresh();stable(title,'#jm-new-form [name="title"]',caret,'journal cloud refresh');assert.equal(t.draft.title,'Shanghai weekend');
  title.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true,data:''}));type(title,'上海旅行',{start:4,composing:true});caret=selection(title);await refresh();await t.jmLoad();stable(title,'#jm-new-form [name="title"]',caret,'Chinese composition');
  title.dispatchEvent(new w.CompositionEvent('compositionend',{bubbles:true,data:'上海旅行'}));title.dispatchEvent(new w.InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'上海旅行',isComposing:false}));await delay(20);stable(title,'#jm-new-form [name="title"]',caret,'composition completion');assert.equal(t.draft.title,'上海旅行');

  // AI availability and catalog checks can complete independently without dropping the textarea.
  visit('ai');const prompt=type(app().querySelector('#ag-prompt'),'Tea, art, and a slow afternoon',{start:5,end:13,direction:'backward'});caret=selection(prompt);
  await until(()=>!t.ag.healthLoading,'initial health settled');await t.A.agHealth();stable(prompt,'#ag-prompt',caret,'AI readiness response');await refresh();stable(prompt,'#ag-prompt',caret,'AI catalog refresh');
  w.dispatchEvent(new w.Event('resize'));await Promise.resolve();t.render();stable(prompt,'#ag-prompt',caret,'viewport/background render');
  const dateInput=app().querySelector('[data-ch="agDate"]');dateInput.focus();await delay(10);await refresh();stable(dateInput,'[data-ch="agDate"]',null,'native date control');assert.strictEqual(app().querySelector('#ag-prompt'),prompt,'moving to the date control preserves the form');
  app().querySelector('[data-act="tab"][data-a="journey"]').click();assert.equal(t.state.route,'journey');assert(!prompt.isConnected,'explicit navigation redraws immediately');

  // The legacy Enter shortcut must distinguish IME candidate commit from command submission.
  visit('planner');t.A.buildPlan();const replanner=type(app().querySelector('#rp-q'),'少走路',{start:3});let replans=0;const oldReplan=t.A.replan;t.A.replan=()=>{replans++;};
  replanner.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true}));const enter=new w.KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true,cancelable:true});replanner.dispatchEvent(enter);
  assert.equal(replans,0,'IME Enter does not invoke replan');assert.equal(enter.defaultPrevented,false,'native IME commit is not cancelled');await refresh();stable(replanner,'#rp-q',selection(replanner),'legacy planner composition');
  replanner.dispatchEvent(new w.CompositionEvent('compositionend',{bubbles:true,data:'少走路'}));replanner.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(replans,1,'ordinary Enter still invokes its command');t.A.replan=oldReplan;

  // Security-driven updates bypass the guard even during composition on the same route.
  visit('ai');const oldOwnerField=type(app().querySelector('#ag-prompt'),'Private draft');oldOwnerField.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true}));t.setOwner('new-fixture-owner');assert(!oldOwnerField.isConnected,'account change removes the old editor immediately');assert.notEqual(app().querySelector('#ag-prompt').value,'Private draft');
  await until(()=>!t.ag.loading&&!t.cache.loading,'new owner async state settles');const current=type(app().querySelector('#ag-prompt'),'Another draft');t.state.auth.staff={id:'staff-fixture',role:'coordinator'};t.render();assert(!current.isConnected,'authorization changes are never deferred');
  visit('login',{mode:'traveler',view:'signin'});const invalid=type(app().querySelector('#lg-pw'),'fixture');t.ui.loginErr='Sign-in expired. Please try again.';t.render();assert(app().textContent.includes('Sign-in expired. Please try again.'),'auth failure is immediately visible');assert(!invalid.isConnected);
  assert.deepEqual(errors,[]);await delay(30);dom.window.close();
  console.log('PASS: native input identity, caret/selection, password/address/passport/journal/AI/date controls, live search, Chinese IME, legacy Enter, blur/keyboard dismissal, explicit navigation and immediate auth/account changes. All transport mocked; no remote mutations.');
})().catch(async error=>{console.error(error,errors);await delay(30);dom.window.close();process.exitCode=1;});
