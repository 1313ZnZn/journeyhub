/* Journey preference/progress contracts. Every RPC, AI and FX response is mocked. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),{webcrypto}=require('node:crypto');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase'),html=fs.readFileSync(path.join(out,'index.html'),'utf8');
assert(html.includes('function jpWatchPlanning'),'Build with journey-planning.js before running this test.');
const copy=x=>JSON.parse(JSON.stringify(x)),delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{for(let n=0;n<150&&!fn();n++)await delay(10);assert(fn(),label);};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const uid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),ownerA=uid(501),ownerB=uid(502);
const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10),day2=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const user=id=>({id,email:id===ownerA?'alice@example.test':'bob@example.test',email_confirmed_at:new Date().toISOString()});
const places=[
  {id:'ui-sh-walk',city:'Shanghai',name:'Shanghai riverside walk',price:450,venue:'Bund area',lat:31.238028,lng:121.486139},
  {id:'ui-sh-food',city:'Shanghai',name:'Old town food trail',price:550,venue:'Old Town area',lat:31.229167,lng:121.4875},
  {id:'ui-sh-tea',city:'Shanghai',name:'Tea traditions',price:350,venue:'Yuyuan area',lat:31.229167,lng:121.4875},
  {id:'ui-sg-walk',city:'Singapore',name:'Singapore bay walk',price:650,venue:'Marina Bay area',lat:1.284444,lng:103.855833},
];
const slot=(id,experience,date,from,to)=>({session_id:id,experience_id:experience,starts_at:date+'T'+from+':00Z',ends_at:date+'T'+to+':00Z',capacity:12,seats_held_other_channels:0,seats_taken:0,price_thb:places.find(p=>p.id===experience).price,status:'open'});
const snapshot={profile:null,personal:{},staff:null,bookings:[],orders:[],sessionPlans:[],metrics:[],
  stores:[{store_id:'rf',name:'Fixture shop',kind:'Craft',area:'Riverside',distance_km:1,opening_hours:'09:00–17:00',issues_vat_forms:false}],
  products:[{product_id:'tote',store_id:'rf',name:'Fixture tote',price_thb:250,description:'Offline UI fixture.',categories:['accessories'],made_to_order:false}],inventory:[{product_id:'tote',stock:10}],
  venues:places.map(p=>({venue_id:p.id+'-venue',name:p.venue,city:p.city,time_zone:p.city==='Singapore'?'Asia/Singapore':'Asia/Shanghai'})),
  experiences:places.map(p=>({experience_id:p.id,venue_id:p.id+'-venue',name:p.name,kind:p.id.includes('food')?'Food':'Culture',duration_min:90,price_thb:p.price,rating:null,review_count:0,host_name:'Fixture host',languages:['English'],details:{durationMinutes:90}})),
  sessions:[slot('s1','ui-sh-walk',date,'01:30','03:00'),slot('s2','ui-sh-tea',date,'05:00','06:30'),slot('s3','ui-sh-walk',day2,'02:00','03:30'),slot('sg1','ui-sg-walk',date,'02:00','03:30')],
};
function makeRun(n,{legacy=false,...overrides}={}){
  const rows=snapshot.sessions.slice(0,legacy?1:3),stops=rows.map(s=>{const p=places.find(x=>x.id===s.experience_id),localDate=s.session_id==='s3'?day2:date;return {sessionId:s.session_id,experienceId:p.id,title:p.name,city:p.city,venueId:p.id+'-venue',venue:p.venue,startsAt:s.starts_at,endsAt:s.ends_at,timeZone:'Asia/Shanghai',unitPriceThb:p.price,guests:2,totalThb:p.price*2,reason:'Matches your preferences.',...(legacy?{}:{date:localDate,dayIndex:localDate===date?1:2,lat:p.lat,lng:p.lng,coordinateAccuracy:'area',coordinateSource:'https://www.wikidata.org/wiki/Q125474'})};});
  const options=legacy?{}:{days:2,dayStart:'09:00',dayEnd:'18:00',transport:'walk',preferredExperienceIds:['ui-sh-walk'],excludedExperienceIds:['ui-sh-food']};
  return {id:uid(n),requestId:uid(n+1000),status:'awaiting_confirmation',version:1,planHash:'immutable-plan-'+n,input:{city:'Shanghai',date,guests:2,prompt:'Tea and culture',...options},
    plan:{city:'Shanghai',date,guests:2,currency:'THB',sampleCatalog:true,totalThb:stops.reduce((n,s)=>n+s.totalThb,0),summary:'A relaxed cultural trip.',tips:[],stops,...(legacy?{}:{days:2,endDate:day2,dayStart:'09:00',dayEnd:'18:00',transport:'walk',legs:[{fromSessionId:'s1',toSessionId:'s2',dayIndex:1,mode:'walk',distanceKm:1.3,durationMinutes:25,estimated:true}]})},
    createdAt:new Date(Date.now()+n).toISOString(),updatedAt:new Date(Date.now()+n).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),jobs:[],bookings:[],events:[],progress:[],...overrides};
}
const server={health:{ai:{ready:true,provider:'deepseek'},email:{ready:false},worker:{ready:true},booking:{sample:true}},runs:new Map([[ownerA,[makeRun(1),makeRun(2,{legacy:true})]],[ownerB,[]]]),posts:[],confirms:[],commands:[],listHook:null,postHook:null};
server.wallets=new Map();server.quotes=new Map();server.demoBooks=[];
function mockWallet(owner){if(!server.wallets.has(owner))server.wallets.set(owner,{currency:'CNY',balanceMinor:100000,ledger:[],bookings:[]});return server.wallets.get(owner);}
const windows=[];
async function boot(){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
  const dom=new JSDOM(html,{url:'http://localhost:4173/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;windows.push(w);
  Object.assign(w,{indexedDB:new IDBFactory(),Blob,Headers,Request,Response,TextEncoder,TextDecoder,AbortController,WebSocket});Object.defineProperty(w,'crypto',{value:webcrypto});
  w.URL.createObjectURL=()=> 'blob:journey-fixture-'+webcrypto.randomUUID();w.URL.revokeObjectURL=()=>{};w.fixtureUser=null;
  const timers=new Map();let timerId=0;w.setInterval=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;};w.clearInterval=id=>timers.delete(id);
  const tick=async ms=>{for(const timer of [...timers.values()].filter(t=>t.ms===ms))await timer.fn();await delay(10);};
  w.fetch=async(input,init={})=>{
    const url=String(input?.url||input);
    if(url.startsWith('https://api.frankfurter.dev/'))return new Response(JSON.stringify(['USD','CNY','SGD'].map((quote,i)=>({date:new Date().toISOString().slice(0,10),base:'THB',quote,rate:[.03,.2,.04][i]}))));
    assert(url.includes('/functions/v1/journeyhub-agent'),'Unexpected network transport: '+url);
    if(init.method!=='POST')return new Response(JSON.stringify(server.health));
    const payload=JSON.parse(init.body);server.posts.push(copy(payload));assert(init.headers.Authorization.startsWith('Bearer fixture-'));
    const owner=w.fixtureUser.id;
    if(payload.action==='care_status')return Response.json({trips:[]});
    if(payload.action==='demo_state')return Response.json({wallet:copy(mockWallet(owner))});
    if(payload.action==='demo_quote'){
      const run=(server.runs.get(owner)||[]).find(r=>r.id===payload.runId);assert(run?.plan,'quote uses the exact owned saved plan');
      const quote={id:uid(990),sourceType:'run',sourceId:run.id,status:'quoted',currency:'CNY',totalMinor:run.plan.totalThb*20,items:run.plan.stops.map(stop=>({stopId:stop.sessionId,sessionId:stop.sessionId,title:stop.title,date:stop.date||run.plan.date,start:stop.startsAt.slice(11,16),end:stop.endsAt.slice(11,16),kind:'ticket',quantity:stop.guests,unitMinor:stop.unitPriceThb*20,totalMinor:stop.totalThb*20,availableSeats:12}))};server.quotes.set(quote.id,quote);return Response.json({quote:copy(quote),wallet:copy(mockWallet(owner))});
    }
    if(payload.action==='demo_book'){
      server.demoBooks.push(copy(payload));assert.deepEqual(Object.keys(payload).sort(),['action','quoteId','requestId'],'only approved quote and idempotency key are submitted');const quote=server.quotes.get(payload.quoteId),wallet=mockWallet(owner);assert(quote);assert(payload.requestId);await delay(5);
      if(quote.status!=='booked'){
        quote.status='booked';wallet.balanceMinor-=quote.totalMinor;
        wallet.bookings=quote.items.map((item,i)=>({...item,id:uid(960+i),bookingId:'UI-BOOK-'+i,checkinCode:'UI-CODE-'+i,quoteId:quote.id,sourceType:quote.sourceType,sourceId:quote.sourceId,status:'simulated_confirmed',canonicalStatus:'confirmed',paymentStatus:'virtual_paid',amountMinor:item.totalMinor,reference:'DEMO-'+i}));
        wallet.ledger.push({id:uid(950),kind:'payment',amountMinor:-quote.totalMinor});
        for(const receipt of wallet.bookings){snapshot.bookings.push({booking_id:receipt.bookingId,session_id:receipt.sessionId,traveler_id:owner,guest_name:'Alice',guests:receipt.quantity,channel:'app',status:'confirmed',unit_price_thb:receipt.unitMinor/20,checkin_code:receipt.checkinCode,created_at:new Date().toISOString(),demo:true,source_type:'run',source_id:quote.sourceId,stop_id:receipt.stopId,payment_status:'virtual_paid',amount_cny_minor:receipt.amountMinor,unit_price_cny_minor:receipt.unitMinor});snapshot.sessions.find(s=>s.session_id===receipt.sessionId).seats_taken+=receipt.quantity;}
      }
      return Response.json({quote:copy(quote),bookings:copy(wallet.bookings),wallet:copy(wallet)});
    }
    if(server.postHook)return server.postHook(payload,w.fixtureUser.id);
    const run=makeRun(20+server.posts.length,{requestId:payload.requestId,input:copy(payload)});server.runs.set(w.fixtureUser.id,[run,...server.runs.get(w.fixtureUser.id)||[]]);return new Response(JSON.stringify({run}));
  };
  w.fixtureRPC=async(name,args={})=>{
    if(name==='journeyhub_calendar_state')return {data:{removed:[]},error:null};if(name==='journeyhub_snapshot')return {data:copy(snapshot),error:null};
    const owner=w.fixtureUser?.id;assert(owner,'Private RPC requires a fixture account');
    if(name==='journeyhub_agent_list')return {data:copy(server.listHook?await server.listHook(owner,args):server.runs.get(owner)||[]),error:null};
    if(name==='journeyhub_agent_get'){const run=(server.runs.get(owner)||[]).find(r=>r.id===args.p_run_id);assert(run,'fixture account owns the requested run');return {data:copy(run),error:null};}
    if(name==='journeyhub_command'){server.commands.push(copy(args));assert.equal(args.p_operation,'personal','UI interactions cannot book or email');return {data:{ok:true},error:null};}
    if(name==='journeyhub_agent_confirm'){
      server.confirms.push(copy(args));const runs=server.runs.get(owner),index=runs.findIndex(r=>r.id===args.p_run_id),run=runs[index];assert(run);assert.equal(args.p_hash,run.planHash);assert.equal(args.p_version,run.version);
      runs[index]={...run,status:'queued',updatedAt:new Date(Date.now()+3000).toISOString(),jobs:[{id:uid(900),kind:'booking',status:'pending'}]};return {data:copy(runs[index]),error:null};
    }
    throw Error('Unexpected RPC: '+name);
  };
  w.eval(fs.readFileSync(path.join(out,'vendor/supabase.js'),'utf8'));w.eval(fs.readFileSync(path.join(out,'config.js'),'utf8'));
  let code=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean).join('\n');
  code=code.replace('jhStart();',`sb.rpc=(name,args)=>window.fixtureRPC(name,args);sb.auth.getSession=async()=>({data:{session:window.fixtureUser?{user:window.fixtureUser,access_token:'fixture-'+window.fixtureUser.id}:null},error:null});sb.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}});window.JP_TEST={get ready(){return !jhLoading&&!!jhLastSnapshot&&jmCache.loaded},get ag(){return ag},get state(){return state},get db(){return DBC},get A(){return A},get draft(){return ixDraft},get memory(){return jmCache},get view(){return jpView},go,render,jhRefresh,jpWatchPlanning,jpProgressHTML,setOwner(u){window.fixtureUser=u;jhUser=u;jhRevision++;jhPersonalReady=false;render();}};jhStart();`);
  w.eval(code);const t=w.JP_TEST;await until(()=>t.ready,'mocked app bootstrap');await delay(20);
  const app=()=>w.document.querySelector('#app');
  const visit=(route,params={})=>{t.state.role='traveler';t.state.guestOk=true;t.go(route,params);assert(!app().textContent.includes('Something went wrong'),route+' renders');};
  const change=(name,value)=>{const el=app().querySelector('[data-ch="'+name+'"]');assert(el,name+' control exists');if(el.type==='checkbox')el.checked=value;else el.value=String(value);el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const click=(action,id)=>{const selector='[data-act="'+action+'"]'+(id===undefined?'':'[data-a="'+id+'"]');const el=app().querySelector(selector);assert(el,selector+' exists');el.click();};
  const setOwner=async id=>{t.setOwner(id?user(id):null);await until(()=>t.ag.owner===id&&!t.ag.loading&&(id?t.ag.loaded:true)&&t.memory.owner===(id||'guest')&&t.memory.loaded,'account settles');await delay(10);};
  return {dom,w,t,app,visit,change,click,setOwner,tick,errors,timers};
}
(async()=>{
  const h=await boot(),{w,t,app,visit,change,click,setOwner,tick}=h;
  visit('journey');assert(app().querySelector('.jl-composer #ag-prompt'),'home opens directly to the trip composer');
  assert(!app().querySelector('.jl-details').open,'trip settings start collapsed');
  assert(!app().textContent.includes('Draft trips'),'saved trip sections do not crowd the composer');
  const library=app().querySelector('[aria-label="Your trips and memories"]'),home=app().querySelector('.jl-home');
  assert(library,'Journey shows the personal trip cards');assert.equal(home.lastElementChild,library,'personal entries sit at the bottom after all homepage controls');
  for(const selector of ['.jl-composer','.jl-suggestions','.jl-details'])assert(home.querySelector(selector).compareDocumentPosition(library)&w.Node.DOCUMENT_POSITION_FOLLOWING,selector+' comes before the personal entries');
  const personalCards=library.querySelectorAll('.jl-library-card');assert.equal(personalCards.length,2,'the bottom library contains two separate rectangular entries');
  assert.equal(library.children.length,2);assert.equal(personalCards[0].nextElementSibling,personalCards[1],'each entry is a separate sibling in the vertical library');
  assert.equal(personalCards[0].dataset.a,'trip-history');assert.equal(personalCards[1].dataset.act,'jmMine','memories opens personal records, even after viewing sample memories');
  assert.equal(app().querySelectorAll('[data-a="trip-history"]').length,1);assert.equal(app().querySelectorAll('[data-act="jmMine"]').length,1,'Journey does not repeat either personal entry');
  click('go','trip-history');assert.equal(t.state.route,'trip-history');assert.equal(app().querySelector('.tab[aria-current="page"]').dataset.a,'journey','Trip history stays under Journey');
  assert(app().querySelector('[data-act="thSignIn"]'),'guest history offers account sign-in');click('back');assert.equal(t.state.route,'journey','history back returns to the composer');
  click('jlDetails');assert(app().querySelector('.jl-details').open,'context chip opens settings');
  change('agDate',date);assert(app().querySelector('.jl-context').textContent.includes(String(new Date(date+'T12:00:00Z').getUTCDate())),'date context follows changes');
  t.render();assert(app().querySelector('.jl-details').open,'background render keeps expanded settings');
  visit('home');assert(!app().querySelector('.jl-trip-library'),'Explore omits the removed travel-space section');
  assert(!app().querySelector('[aria-label="Your trips and memories"]'));assert(!app().querySelector('[data-a="trip-history"]'));assert(!app().querySelector('[data-act="jmMine"],[data-a="memories"]'),'Explore no longer duplicates Journey personal cards');
  t.A.jmDemo();click('jmView','sample-Shanghai');assert.equal(t.state.route,'memory-trip');assert.equal(app().querySelector('.tab[aria-current="page"]').dataset.a,'journey');
  click('jmPhoto');assert.equal(t.state.route,'memory-photo');assert.equal(app().querySelector('.tab[aria-current="page"]').dataset.a,'journey');
  for(const route of ['memory-badges','memory-poster']){visit(route);assert.equal(app().querySelector('.tab[aria-current="page"]').dataset.a,'journey',route+' stays under Journey');}
  t.A.jmNew();assert.equal(t.state.route,'memory-new');assert.equal(app().querySelector('.tab[aria-current="page"]').dataset.a,'journey');
  t.A.jmDemo();visit('journey');click('jmMine');assert.equal(t.state.route,'memories');assert.equal(app().querySelector('.tab[aria-current="page"]').dataset.a,'journey','memories stays under Journey');
  assert(!app().querySelector('.jm-storage-banner'),'the homepage card clears sample mode');click('back');assert.equal(t.state.route,'journey','memories back returns to the composer');assert.equal(t.ag.prefs.date,date,'opening personal cards preserves trip inputs');
  visit('ai');change('agCity','Shanghai');t.A.agPrompt('Culture and quiet walks');t.A.pdCatalog();assert.equal(t.state.route,'ai-picks');
  assert.equal(app().querySelector('.jp-swipe-card').dataset.pickId,'ui-sh-walk');
  app().querySelector('[data-act="jpPick"][data-b="want"]').click();assert.deepEqual(copy(t.ag.prefs.preferredExperienceIds),['ui-sh-walk']);
  app().querySelector('.jp-swipe-card').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));assert.deepEqual(copy(t.ag.prefs.excludedExperienceIds),['ui-sh-food']);
  click('jpUndo');assert.deepEqual(copy(t.ag.prefs.excludedExperienceIds),[]);assert.equal(app().querySelector('.jp-swipe-card').dataset.pickId,'ui-sh-food');
  t.A.jpPick('ui-sg-walk','want');assert(!t.ag.prefs.preferredExperienceIds.includes('ui-sg-walk'),'a different city cannot be voted into this shortlist');
  t.A.jpPick('ui-sh-walk','skip');assert(!t.ag.prefs.excludedExperienceIds.includes('ui-sh-walk'),'a decided card cannot enter both preference arrays');
  visit('ai');change('agCity','Singapore');assert.deepEqual(copy(t.ag.prefs.preferredExperienceIds),[]);assert.deepEqual(copy(t.ag.prefs.excludedExperienceIds),[]);t.A.jpPicks();click('jpUndo');assert.equal(t.ag.prefs.preferredExperienceIds.length,0,'city change clears undo history');
  const pointer=(target,type,x,y)=>{const event=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{pointerId:7,button:0,clientX:x,clientY:y});target.dispatchEvent(event);};
  let card=app().querySelector('.jp-swipe-card');pointer(card,'pointerdown',100,50);pointer(card,'pointermove',105,140);pointer(card,'pointerup',105,140);assert.equal(t.ag.prefs.preferredExperienceIds.length,0,'vertical scrolling is not a vote');
  pointer(card,'pointerdown',100,50);pointer(card,'pointermove',195,55);assert(card.style.transform.includes('translateX'));pointer(card,'pointerup',195,55);assert.deepEqual(copy(t.ag.prefs.preferredExperienceIds),['ui-sg-walk'],'rightward pointer gesture chooses the card');t.A.jpUndo();assert.equal(t.ag.prefs.preferredExperienceIds.length,0);
  await setOwner(ownerA);visit('ai');change('agCity','Shanghai');change('agDate',date);change('jpDays',2);change('jpStart','09:00');change('jpEnd','18:00');change('jpTransport','walk');t.A.jpPicks();t.A.jpPick('ui-sh-walk','want');t.A.jpPick('ui-sh-food','skip');visit('ai');
  // Real native typing remains stable when the server progress poll completes.
  const prompt=app().querySelector('#ag-prompt');prompt.focus();prompt.value='Tea, culture, and 上海';prompt.dispatchEvent(new w.InputEvent('input',{bubbles:true,data:'上海'}));prompt.setSelectionRange(5,12,'backward');
  prompt.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true,data:'上海'}));
  const ctx=t.ag,progressId=uid(300),staleProgress=makeRun(301,{requestId:uid(999),status:'planning',plan:null,progress:[{stage:'validating',at:new Date().toISOString()}]}),correctProgress=makeRun(302,{requestId:progressId,status:'planning',plan:null,progress:[{stage:'receiving',at:new Date().toISOString()},{stage:'checking_catalog',at:new Date().toISOString()}]});
  ctx.planningRequestId=progressId;server.listHook=()=>[staleProgress,correctProgress];const stop=t.jpWatchPlanning(ctx,progressId);await until(()=>ctx.progressRunId===correctProgress.id,'matching saved progress arrives');
  assert.strictEqual(app().querySelector('#ag-prompt'),prompt,'progress preserves the native editor node');assert.strictEqual(w.document.activeElement,prompt);assert.deepEqual([prompt.selectionStart,prompt.selectionEnd,prompt.selectionDirection],[5,12,'backward']);
  assert(!ctx.runs.some(r=>r.id===staleProgress.id),'unrelated progress is ignored');stop();server.listHook=null;ctx.planningRequestId=null;prompt.dispatchEvent(new w.CompositionEvent('compositionend',{bubbles:true,data:'上海'}));prompt.blur();await delay(10);
  // Retrying an identical request reuses its ID even when display currency changes.
  server.postHook=()=>new Response(JSON.stringify({error:{message:'Fixture transient error'}}),{status:503});
  await t.A.agGenerate();const initial=copy(server.posts.at(-1));assert.deepEqual({days:initial.days,dayStart:initial.dayStart,dayEnd:initial.dayEnd,transport:initial.transport},{days:2,dayStart:'09:00',dayEnd:'18:00',transport:'walk'});assert.deepEqual(initial.preferredExperienceIds,['ui-sh-walk']);assert.deepEqual(initial.excludedExperienceIds,['ui-sh-food']);
  t.A.fxCurrency('USD');await t.A.agGenerate();assert.equal(server.posts.at(-1).requestId,initial.requestId,'display currency is excluded from the request fingerprint');assert(!('currency' in server.posts.at(-1)));
  server.postHook=()=>{throw new TypeError('Fixture network connection interrupted');};await t.A.agGenerate();assert.equal(server.posts.at(-1).requestId,initial.requestId,'an ambiguous network failure keeps the request ID');
  assert.equal(JSON.parse(w.sessionStorage.getItem('journeyhub-agent-pending-'+ownerA)).requestId,initial.requestId,'no failed server record means a retry must keep its idempotency key');
  // A saved terminal failure must replace stale Planning and release the failed request key.
  const failureResponse=deferred();let failedPayload,failedRun;
  server.postHook=payload=>{failedPayload=copy(payload);failedRun=makeRun(350,{requestId:payload.requestId,input:copy(payload),status:'planning',plan:null,progress:[{stage:'receiving'},{stage:'checking_catalog'},{stage:'planning'}]});server.runs.set(ownerA,[failedRun,...server.runs.get(ownerA)]);return failureResponse.promise;};
  const failureRequest=t.A.agGenerate();await until(()=>failedPayload,'failure fixture request starts');await tick(1800);assert.equal(t.ag.runs.find(r=>r.id===failedRun.id).status,'planning');
  failedRun={...failedRun,status:'failed',errorCode:'AI_INVALID_RESPONSE',updatedAt:new Date(Date.now()+2000).toISOString()};server.runs.set(ownerA,server.runs.get(ownerA).map(r=>r.id===failedRun.id?failedRun:r));
  failureResponse.resolve(new Response(JSON.stringify({error:{code:'AI_INVALID_RESPONSE',message:'The AI response could not be read. Please retry.'}}),{status:502}));await failureRequest;
  assert.equal(t.ag.runs.find(r=>r.id===failedRun.id).status,'failed','terminal status refresh replaces the stale Planning record');assert.equal(w.sessionStorage.getItem('journeyhub-agent-pending-'+ownerA),null,'verified terminal failure releases its request key');
  visit('ai-history');assert(app().querySelector('[data-act="agOpen"][data-a="'+failedRun.id+'"]').textContent.includes('Needs attention'),'history immediately shows terminal failure');
  visit('ai');server.postHook=()=>{throw new TypeError('Fixture ambiguous retry failure');};await t.A.agGenerate();const retryId=server.posts.at(-1).requestId;assert.notEqual(retryId,failedPayload.requestId,'retry after a verified failed run starts a new request');await t.A.agGenerate();assert.equal(server.posts.at(-1).requestId,retryId,'the subsequent ambiguous error still preserves the new key');
  // A cached HTTP success may contain a failed run with no itinerary; it is never a design preview.
  const cachedFailure=makeRun(351,{requestId:retryId,input:copy(t.ag.prefs),status:'failed',plan:null,errorCode:'AI_INVALID_RESPONSE',progress:[{stage:'receiving'},{stage:'checking_catalog'},{stage:'planning'}]});
  server.runs.set(ownerA,[cachedFailure,...server.runs.get(ownerA)]);server.postHook=()=>new Response(JSON.stringify({run:cachedFailure}));await t.A.agGenerate();assert.equal(t.state.route,'ai-plan');assert.equal(t.ag.activeId,cachedFailure.id);assert.equal(t.ag.preview,false);assert(!app().textContent.includes('Design preview'),'failed server runs do not become preview itineraries');
  assert(app().querySelector('.jp-progress-steps .failed'),'failed run keeps actual stopped progress visible');assert(app().querySelector('[data-act="agEdit"]'),'failed/no-plan screen offers a new-plan action');assert(!app().querySelector('[data-act="agReview"]'),'there is no approval action without an executable plan');assert.equal(server.confirms.length,0);click('agEdit');assert.equal(t.state.route,'journey');
  server.postHook=()=>new Response(JSON.stringify({error:{message:'Fixture transient error'}}),{status:503});
  visit('ai');change('jpDays',3);await t.A.agGenerate();assert.notEqual(server.posts.at(-1).requestId,initial.requestId,'trip changes get a new request ID');
  change('jpDays',2);change('jpStart','18:00');change('jpEnd','09:00');const postCount=server.posts.length;await t.A.agGenerate();assert.equal(server.posts.length,postCount,'invalid activity window never contacts the agent');assert(app().textContent.includes('end time after'));change('jpStart','09:00');change('jpEnd','18:00');
  // Progress shown during generation comes from this exact saved run, never a timer percentage.
  const planned=deferred();let submitted;
  server.postHook=payload=>{submitted=copy(payload);return planned.promise;};
  visit('journey');assert(app().querySelector('#ag-prompt'),'home exposes the real planner form');assert(!app().querySelector('.jh-home-options').open,'home hides advanced settings initially');
  const generation=t.A.agGenerate();await until(()=>submitted&&t.ag.busy,'mock AI request from home in flight');assert.equal(t.state.route,'journey','generation starts directly on the homepage');assert(app().textContent.includes('Waiting for saved server activity'));assert.equal(app().querySelectorAll('.jp-progress-steps .done').length,0);
  const activePlanning=makeRun(400,{requestId:submitted.requestId,status:'planning',plan:null,progress:[{stage:'receiving',at:new Date().toISOString()},{stage:'checking_catalog',at:new Date().toISOString()}]});
  server.listHook=()=>[staleProgress,activePlanning];await tick(1800);assert.equal(t.ag.progressRunId,activePlanning.id);assert(app().querySelector('.jp-progress-steps .current').textContent.includes('Checking available sessions'));assert.equal(server.confirms.length,0,'no reservation is authorized by planning');
  activePlanning.progress.push({stage:'planning',at:new Date().toISOString()});activePlanning.updatedAt=new Date(Date.now()+2000).toISOString();await tick(1800);assert(app().querySelector('.jp-progress-steps .current').textContent.includes('Building your route'));
  const completed=makeRun(400,{requestId:submitted.requestId,input:submitted,updatedAt:new Date(Date.now()+4000).toISOString(),progress:[...activePlanning.progress,{stage:'validating',at:new Date().toISOString()}]});server.runs.set(ownerA,[completed,...server.runs.get(ownerA)]);server.listHook=null;planned.resolve(new Response(JSON.stringify({run:completed})));await generation;server.postHook=null;
  assert.equal(t.state.route,'ai-plan');assert.equal(t.ag.activeId,completed.id);assert.equal(server.confirms.length,0);assert.equal([...h.timers.values()].filter(t=>t.ms===1800).length,0,'progress watcher stops after the response');
  const saved=JSON.stringify(t.ag.runs.find(r=>r.id===completed.id));assert.equal(t.draft.days,2);assert.equal(t.draft.endDate,day2);assert.deepEqual(copy(t.draft.planSnapshot),completed.plan);
  assert.equal(app().querySelectorAll('.jp-day-section').length,2);assert(app().textContent.includes('Estimated'));assert(app().textContent.includes('Area locations'));assert(app().textContent.includes('not road routes'));
  click('jrDay','2');assert.equal(app().querySelectorAll('.jp-day-section').length,1);assert(app().querySelector('.jp-day-heading').textContent.includes('Day 2'));assert.equal(app().querySelectorAll('[data-route-stop]').length,1);
  click('jrDay','all');click('jrStop','s2');assert.equal(t.view.day,1);assert.equal(t.view.stop,'s2');assert(app().querySelector('[data-route-stop="s2"]').classList.contains('selected'));
  t.A.fxCurrency('SGD');assert.equal(JSON.stringify(t.ag.runs.find(r=>r.id===completed.id)),saved,'map and currency interactions do not modify canonical approval data');
  // The local journal can use the saved plan even if live catalog sessions vanish.
  delete t.db.sessions.s3;await t.A.jmStartFromPlan();assert.equal(t.state.route,'memory-trip');const journal=t.memory.trips.find(x=>x.city==='Shanghai'&&x.stops.length===3);assert(journal);assert.equal(journal.date,date);assert(journal.title.includes('2 days'));assert(journal.stops.find(s=>s.id==='s3').time.includes('Day 2'));
  await t.A.agOpen(completed.id);t.A.agRemove('s2');assert.equal(t.ag.prefs.days,2);assert.equal(t.ag.prefs.transport,'walk');assert.equal(t.ag.prefs.dayEnd,'18:00');assert(t.ag.prefs.excludedExperienceIds.includes('ui-sh-tea'));assert.equal(JSON.stringify(t.ag.runs.find(r=>r.id===completed.id)),saved,'editing never mutates an approved candidate');
  await t.A.agOpen(completed.id);await t.A.agReview();assert.equal(t.state.route,'demo-booking');await until(()=>app().querySelector('[data-act="dwBook"]'),'current canonical quote ready');assert(app().textContent.includes('CNY 500.00'));assert(app().textContent.includes(date));assert.equal(app().querySelectorAll('.dw-quote-items li').length,3);assert(!app().querySelector('[data-act="dwBook"]').disabled);assert(!app().querySelector('[data-ch="agEmail"]'));assert.equal(server.demoBooks.length,0,'opening budget review is read-only');assert.equal(server.confirms.length,0,'legacy queue cannot bypass virtual payment');
  const beforeBalance=mockWallet(ownerA).balanceMinor;await Promise.all([t.A.dwBook(),t.A.dwBook()]);assert.equal(server.demoBooks.length,1,'only explicit confirmation books, duplicate click is suppressed');assert.equal(mockWallet(ownerA).balanceMinor,beforeBalance-50000);assert.equal(app().querySelectorAll('.dw-reservation').length,3);assert(app().textContent.includes('UI-BOOK-0'),'saved receipt includes the canonical Booking ID');assert.equal(t.db.bookings['UI-BOOK-0'].paymentStatus,'virtual_paid');assert.equal(t.db.sessions.s1.taken,2,'canonical booking updates live seats');
  const failedBooking={...completed,status:'failed',confirmedAt:new Date().toISOString(),jobs:[{kind:'booking',status:'failed'}],progress:[{stage:'receiving'},{stage:'checking_catalog'},{stage:'planning'},{stage:'validating'}]},progressDOM=w.document.createElement('div');
  progressDOM.innerHTML=t.jpProgressHTML(failedBooking,{expanded:true});const failedSteps=progressDOM.querySelectorAll('li');assert(failedSteps[4].classList.contains('done'),'booking failure preserves the recorded approval step');assert(failedSteps[5].classList.contains('failed'),'booking failure points to reservations, not itinerary validation');
  // Older one-day plans remain readable and can become a local travel journal.
  await t.A.agOpen(uid(2));assert.equal(t.state.route,'ai-plan');assert(app().textContent.includes('Day 1'));assert.equal(app().querySelectorAll('.jp-day-section').length,1);await t.A.jmStartFromPlan();assert.equal(t.state.route,'memory-trip');assert(t.memory.trips.some(x=>x.stops.length===1&&x.title==='A day in Shanghai'));
  // Late status updates cannot enter a new owner scope, including A -> B -> A.
  visit('ai');const originalContext=t.ag,rememberedPrefs=copy(t.ag.prefs),late=deferred(),lateId=uid(700);originalContext.planningRequestId=lateId;server.listHook=owner=>owner===ownerA?late.promise:server.runs.get(owner)||[];const stopLate=t.jpWatchPlanning(originalContext,lateId);await setOwner(ownerB);assert.equal(t.ag.prefs.preferredExperienceIds.length,0,'account B cannot inherit account A picks');assert.equal(t.ag.prefs.excludedExperienceIds.length,0);await setOwner(null);server.listHook=null;await setOwner(ownerA);assert.deepEqual(copy(t.ag.prefs),rememberedPrefs,'returning to an account restores only that account preferences');const currentIds=t.ag.runs.map(r=>r.id).join(',');late.resolve([makeRun(701,{requestId:lateId,status:'planning',plan:null,progress:[{stage:'validating',at:new Date().toISOString()}]})]);await delay(20);stopLate();assert.equal(t.ag.runs.map(r=>r.id).join(','),currentIds);assert.notStrictEqual(t.ag,originalContext);
  // A late model response after sign-out must not navigate or restore another account's plan.
  visit('ai');t.A.agPrompt('A calm trip');const finalResponse=deferred();server.postHook=()=>finalResponse.promise;const inFlight=t.A.agGenerate();await until(()=>t.ag.busy,'last generation begins');await setOwner(null);visit('journey');finalResponse.resolve(new Response(JSON.stringify({run:makeRun(800)})));await inFlight;server.postHook=null;assert.equal(t.state.route,'journey');assert.equal(t.ag.runs.length,0);assert.equal(t.ag.activeId,null);
  // Live search is explicit, never a disguised local-catalog fallback.
  await setOwner(ownerA);visit('journey');t.ag.prefs.days=1;t.A.agPrompt('Quiet gardens');
  await t.A.jpRequirements();assert.equal(t.state.route,'place-search');assert(app().textContent.includes('needs setup'));assert(!app().querySelector('.jp-swipe-card'));
  t.A.pdCatalog();assert.equal(t.state.route,'ai-picks');assert(app().querySelector('[data-act="jpFinish"]'),'original inventory workflow stays available explicitly');
  server.health.discovery={ready:true};
  const places=['place_a','place_b'].map(id=>({id,name:'Verified '+id,address:'Map provider address',kind:'park',lat:31.23,lng:121.48,reason:'Quiet gardens',sourceURL:'https://www.google.com/maps/search/?api=1&query_place_id='+id,attributions:[],openingHours:[],bookable:false}));
  let discoveryPayload;
  server.postHook=payload=>{if(['discover','discover_plan'].includes(payload.action))discoveryPayload=copy(payload);return Response.json(payload.action==='discover'?{places,token:'fixture-signed-token',expires:Date.now()+3600000}:{plan:{city:'Shanghai',date,days:1,summary:'A calm visit',stops:[{...places[0],dayIndex:1,start:'09:00',end:'10:00'}],notice:'No reservations have been made.'}});};
  visit('journey');await t.A.jpRequirements();assert.equal(t.state.route,'ai-picks');assert.equal(discoveryPayload.action,'discover');assert(app().textContent.includes('Verified place_a'));assert(!app().textContent.includes('/ guest · sample'));
  app().querySelector('.jp-swipe-card').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert(app().textContent.includes('Verified place_b'));
  app().querySelector('.jp-swipe-card').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
  await t.A.pdFinish();assert.equal(t.state.route,'place-plan');assert.equal(discoveryPayload.action,'discover_plan');assert.deepEqual(discoveryPayload.wanted,['place_a']);assert.deepEqual(discoveryPayload.skipped,['place_b']);assert(app().textContent.includes('09:00–10:00'));assert(!app().querySelector('[data-act="agConfirm"]'));
  assert(app().querySelector('.tu-sheet'),'map-first itinerary sheet is present');
  const mapHost=app().querySelector('[data-pm-map]');
  t.A.tuTab('itinerary');assert(app().querySelector('.tu-expanded'));assert.equal(app().querySelector('[data-pm-map]'),mapHost,'sheet toggle does not replace map or trigger another load');
  t.A.tuTab('overview');assert(!app().querySelector('.tu-expanded'));
  t.A.pmSelect('place_a');assert(!app().querySelector('.tu-expanded'),'Show on map keeps the map visible in the natural-scroll layout');assert.equal(app().querySelector('.tu-trip').dataset.view,'overview');assert(app().querySelector('[data-pm-stop="place_a"].pm-selected'),'map selection highlights the corresponding itinerary stop');
  assert(app().querySelector('.tu-stop-address').textContent.includes('Map provider address'),'the place address is visible without expanding details');
  await setOwner(ownerB);visit('journey');assert(!app().textContent.includes('Continue live trip'),'other accounts never see a previous live itinerary');
  const delayedDiscovery=deferred();server.postHook=()=>delayedDiscovery.promise; t.A.agPrompt('Parks');const pendingSearch=t.A.jpRequirements();await until(()=>t.state.route==='place-search','search started');await delay(10);await setOwner(null);visit('journey');delayedDiscovery.resolve(Response.json({places,token:'late',expires:Date.now()+3600000}));await pendingSearch;assert.equal(t.state.route,'journey');assert(!app().textContent.includes('Continue live trip'));
  server.postHook=null;
  assert.equal(server.demoBooks.length,1,'only the explicit budget confirmation requested a booking');assert.equal(server.confirms.length,0,'superseded confirmation RPC is never called');assert(server.commands.every(x=>x.p_operation==='personal'));assert.deepEqual(h.errors,[]);w.close();
  console.log('PASS: mocked Journey swipe/keyboard/undo/city scoping, trip payload validation and currency-invariant retries, failed-run refresh/new-key retry versus ambiguous-network key reuse, failed/no-plan recovery without preview, matching saved progress, stable IME editor, 2-day map/list selection, immutable review hash, exact explicit confirmation, missing-catalog and legacy journals, and late owner/model race isolation. No real network, AI, bookings or emails.');
})().catch(async error=>{console.error(error);await delay(20);windows.forEach(w=>w.close());process.exitCode=1;});
