/* UI contract tests only: every network/RPC response is mocked. No AI, booking or email side effects. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),{webcrypto}=require('node:crypto');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase'),html=fs.readFileSync(path.join(out,'index.html'),'utf8');
assert(html.includes('journeyhub_agent_confirm'),'Build the app with agent-ui.js before running this test.');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{for(let i=0;i<150&&!fn();i++)await delay(10);assert(fn(),label);};
const copy=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const uuid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10),startsAt=date+'T01:30:00Z',endsAt=date+'T03:00:00Z';
const ownerA=uuid(501),ownerB=uuid(502);
const user=id=>({id,email:id===ownerA?'alice@example.test':'bob@example.test',email_confirmed_at:new Date().toISOString()});
const snapshot={profile:null,personal:{},staff:null,bookings:[],orders:[],sessionPlans:[],metrics:[],
  stores:[{store_id:'rf',name:'Fixture craft shop',kind:'Craft',area:'Riverside',distance_km:1,opening_hours:'09:00–17:00',issues_vat_forms:false}],
  products:[{product_id:'tote',store_id:'rf',name:'Fixture tote',price_thb:250,description:'A local UI fixture.',categories:['accessories'],made_to_order:false}],inventory:[{product_id:'tote',stock:10}],
  venues:[{venue_id:'ui-sh-venue',name:'Riverside meeting point',city:'Shanghai',time_zone:'Asia/Shanghai'}],
  experiences:[{experience_id:'ui-sh-walk',name:'Shanghai riverside walk',kind:'Culture',duration_min:90,price_thb:450,rating:null,review_count:0,host_name:'Local host',languages:['English'],venue_id:'ui-sh-venue',details:{durationMinutes:90}}],
  sessions:[{session_id:'ui-sh-session',experience_id:'ui-sh-walk',starts_at:startsAt,ends_at:endsAt,capacity:12,seats_held_other_channels:0,seats_taken:0,price_thb:450,status:'open'}]};
function makeRun(n,overrides={}){return {id:uuid(n),status:'awaiting_confirmation',version:1,planHash:'immutable-hash-'+n,
  input:{city:'Shanghai',date,guests:2,prompt:'Culture first'},
  plan:{city:'Shanghai',date,guests:2,currency:'THB',sampleCatalog:true,totalThb:900,summary:'A relaxed cultural morning.',tips:[],stops:[{sessionId:'ui-sh-session',experienceId:'ui-sh-walk',title:'Shanghai riverside walk',city:'Shanghai',venue:'Riverside meeting point',startsAt,endsAt,timeZone:'Asia/Shanghai',unitPriceThb:450,guests:2,totalThb:900,reason:'Matches your interest in local culture.'}]},
  createdAt:new Date(Date.now()+n).toISOString(),updatedAt:new Date(Date.now()+n).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),confirmedAt:null,errorCode:null,jobs:[],bookings:[],events:[],...overrides};}
const server={health:{ai:{ready:false,provider:'deepseek',model:'deepseek-chat'},email:{ready:false,provider:''},worker:{ready:true},booking:{mode:'journeyhub_catalog',sample:true}},
  runs:new Map([[ownerA,[makeRun(1)]],[ownerB,[makeRun(2,{input:{city:'Singapore',date,guests:1,prompt:'A private second account trip'},plan:null,status:'planning'})]]]),posts:[],confirms:[],listHook:null,getHook:null,planHook:null};
const windows=[];
async function boot(){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
  const dom=new JSDOM(html,{url:'http://localhost:4173/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;windows.push(w);
  Object.assign(w,{indexedDB:new IDBFactory(),Blob,Headers,Request,Response,TextEncoder,TextDecoder,AbortController,WebSocket});Object.defineProperty(w,'crypto',{value:webcrypto});
  w.URL.createObjectURL=()=> 'blob:fixture-'+webcrypto.randomUUID();w.URL.revokeObjectURL=()=>{};w.fixtureUser=null;
  w.fetch=async(input,init={})=>{
    const url=String(input?.url||input);assert(url.includes('/functions/v1/journeyhub-agent'),'Unexpected network call: '+url);
    if(init.method==='POST'){
      const payload=JSON.parse(init.body);server.posts.push(copy(payload));assert(init.headers.Authorization?.startsWith('Bearer fixture-'),'only fixture credentials reach the mocked edge transport');
      if(server.planHook)return server.planHook(payload,w.fixtureUser?.id);
      const run=makeRun(10+server.posts.length,{input:{city:payload.city,date:payload.date,guests:payload.guests,prompt:payload.prompt}});server.runs.set(w.fixtureUser.id,[run,...server.runs.get(w.fixtureUser.id)||[]]);return new Response(JSON.stringify({run}));
    }
    return new Response(JSON.stringify(server.health));
  };
  w.fixtureRPC=async(name,args={})=>{
    if(name==='journeyhub_calendar_state')return {data:{removed:[]},error:null};if(name==='journeyhub_snapshot')return {data:copy(snapshot),error:null};
    const owner=w.fixtureUser?.id;assert(owner,'agent RPC requires a fixture account');
    if(name==='journeyhub_agent_list'){if(server.listHook)return {data:await server.listHook(owner,args),error:null};return {data:copy(server.runs.get(owner)||[]),error:null};}
    if(name==='journeyhub_agent_get'){if(server.getHook){const override=server.getHook(owner,args.p_run_id);if(override)return {data:await override,error:null};}const run=(server.runs.get(owner)||[]).find(r=>r.id===args.p_run_id);return run?{data:copy(run),error:null}:{data:null,error:{message:'Run not found'}};}
    if(name==='journeyhub_agent_confirm'){
      server.confirms.push(copy(args));const list=server.runs.get(owner)||[],index=list.findIndex(r=>r.id===args.p_run_id);assert(index>=0);
      const run=list[index];assert.equal(args.p_hash,run.planHash);assert.equal(args.p_version,run.version);
      const queued={...run,status:'queued',updatedAt:new Date(Date.now()+1000).toISOString(),confirmedAt:new Date().toISOString(),jobs:[{id:uuid(900),kind:'booking',status:'pending',attempts:0,maxAttempts:3,runAt:new Date().toISOString(),lastError:null}]};list[index]=queued;return {data:copy(queued),error:null};
    }
    throw Error('Unexpected RPC: '+name);
  };
  w.eval(fs.readFileSync(path.join(out,'vendor/supabase.js'),'utf8'));w.eval(fs.readFileSync(path.join(out,'config.js'),'utf8'));
  let code=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean).join('\n');
  code=code.replace('jhStart();',`sb.rpc=(name,args)=>window.fixtureRPC(name,args);sb.auth.getSession=async()=>({data:{session:window.fixtureUser?{user:window.fixtureUser,access_token:'fixture-'+window.fixtureUser.id}:null},error:null});sb.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}});window.AG_TEST={get ready(){return !jhLoading&&!!jhLastSnapshot},get journalSettled(){return !jmCache.loading&&jmCache.loaded&&jmCache.owner===jmOwner()},get ag(){return ag},get state(){return state},get db(){return DBC},get A(){return A},get draft(){return ixDraft},get errors(){return jhLastError},go,render,setOwner(u){window.fixtureUser=u;jhUser=u;jhPersonalReady=false;render();}};jhStart();`);
  w.eval(code);const t=w.AG_TEST;await until(()=>t.ready,'offline catalog bootstrap');await delay(30);const app=()=>w.document.querySelector('#app');
  const visit=(route,params={})=>{t.state.role='traveler';t.state.guestOk=true;t.go(route,params);assert(!app().textContent.includes('Something went wrong'),route);};
  const change=(name,value)=>{const el=app().querySelector('[data-ch="'+name+'"]');assert(el,name+' exists');if(el.type==='checkbox')el.checked=value;else el.value=String(value);el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const setOwner=async owner=>{t.setOwner(owner?user(owner):null);await until(()=>t.ag.owner===owner&&!t.ag.loading&&(owner?t.ag.loaded:true)&&t.journalSettled,'owner scope and journal settle');};
  // IndexedDB completion can outlive mocked fetch/RPC promises; wait for its final render before disposing the document.
  const close=async()=>{await until(()=>t.journalSettled&&!t.ag.loading&&!t.ag.healthLoading&&!t.ag.busy,'async UI work settles before window.close');w.close();};
  return {dom,w,t,app,visit,change,setOwner,close,errors};
}
(async()=>{
  let h=await boot(),{t,w,app,visit,change,setOwner}=h;
  visit('ai');assert(app().querySelector('[data-act="jpRequirements"]'),app().textContent+' | '+h.errors.join(';'));await t.A.agGenerate();assert.equal(t.state.route,'login');assert.equal(server.posts.length,0,'guest generation does not contact AI');
  visit('ai');change('agCity','Shanghai');change('agDate',date);change('agGuests',2);t.A.agPrompt('Culture first');t.A.agPreview();assert.equal(t.state.route,'ai-plan');assert.equal(t.draft.preview,true);assert(app().textContent.includes('Design preview'));assert.equal(server.posts.length,0,'sample preview never calls the AI provider');
  await setOwner(ownerA);visit('ai-plan');assert.equal(t.ag.activeId,uuid(1));assert.equal(t.draft.date,date,'server date stays absolute');assert(app().querySelector('[data-act="jmStartFromPlan"]'),'journal continuation remains available');
  visit('ai');await t.A.agHealth();assert(!app().querySelector('[data-act="jpRequirements"]' ).disabled,'place selection remains available before AI configuration');assert(app().querySelector('[data-act="agPreview"]'),'sample option stays separate');
  server.health.ai.ready=true;await t.A.agHealth();assert(!app().querySelector('[data-act="jpRequirements"]').disabled);
  visit('ai-plan');const immutable=JSON.stringify(t.ag.runs[0]);t.A.agRemove('ui-sh-session');assert.equal(t.state.route,'journey');assert(t.ag.prefs.excludedExperienceIds.includes(t.ag.runs[0].plan.stops[0].experienceId));assert.equal(JSON.stringify(t.ag.runs[0]),immutable,'removal cannot mutate the server plan');
  await t.A.agGenerate();assert.equal(t.state.route,'ai-plan');assert.notEqual(t.ag.activeId,uuid(1),'edited preferences produce a new run');assert.equal(server.posts.at(-1).date,date);assert.equal(server.posts.at(-1).guests,2);
  const runId=t.ag.activeId;await t.A.agReview();assert.equal(t.state.route,'ai-review');assert(app().textContent.includes('No charge'));assert(app().textContent.includes('900 THB'));assert(app().textContent.includes('Asia/Shanghai'));
  assert(app().querySelector('[data-act="agConfirm"]').disabled,'approval checkbox is required');assert(app().querySelector('[data-ch="agEmail"]').disabled,'mail remains off without a service');assert.equal(t.ag.emailReminders,false);
  change('agConsent',true);t.A.agPrompt('Changed preferences');assert.equal(t.ag.confirmChecked,false,'changing preferences invalidates review consent');
  // Optional future email configuration still requires a verified account address.
  await until(()=>!t.ag.healthLoading,'review health check settles');server.health.email.ready=true;w.fixtureUser.email_confirmed_at=null;t.setOwner(w.fixtureUser);await t.A.agHealth();assert.equal(t.ag.health.email.ready,true);visit('ai-review');assert(app().querySelector('[data-ch="agEmail"]').disabled,'unverified email cannot opt in');
  w.fixtureUser.email_confirmed_at=new Date().toISOString();t.setOwner(w.fixtureUser);visit('ai-review');assert(!app().querySelector('[data-ch="agEmail"]').disabled);change('agEmail',true);assert.equal(t.ag.confirmChecked,false);change('agConsent',true);
  const awaiting=copy(t.ag.runs.find(r=>r.id===runId));await t.A.agConfirm();assert.equal(t.state.route,'ai-tasks');assert.equal(server.confirms.length,1);assert.equal(server.confirms[0].p_hash,awaiting.planHash);assert.equal(server.confirms[0].p_version,awaiting.version);assert.equal(server.confirms[0].p_email_reminders,true);assert(!('recipient' in server.confirms[0]),'the browser cannot choose an email recipient');assert(app().textContent.includes('Reservations queued'));
  server.getHook=(_,id)=>id===runId?Promise.resolve(copy(awaiting)):null;await t.A.agRefreshRun();assert.equal(t.ag.runs.find(r=>r.id===runId).status,'queued','stale get cannot roll a confirmed run back');server.getHook=null;
  const queued=server.runs.get(ownerA).find(r=>r.id===runId);Object.assign(queued,{status:'booked',updatedAt:new Date(Date.now()+2000).toISOString(),jobs:[{id:uuid(901),kind:'booking_confirmation',status:'accepted',runAt:new Date().toISOString()}]});await t.A.agRefreshRun();assert(app().textContent.includes('Delivery has not been confirmed'),'provider acceptance never becomes a delivery claim');
  // Last selected run wins even when earlier requests arrive later.
  const extra=makeRun(99);server.runs.get(ownerA).push(extra);await t.A.agRefreshRuns();const earlier=deferred();server.getHook=(_,id)=>id===runId?earlier.promise:null;
  const firstOpen=t.A.agOpen(runId);await t.A.agOpen(extra.id);earlier.resolve(copy(queued));await firstOpen;assert.equal(t.ag.activeId,extra.id,'late earlier selection cannot replace the latest selection');server.getHook=null;
  // A delayed old-account read cannot leak into a newer scope, including A -> B -> A.
  await setOwner(ownerB);const late=deferred(),entered=deferred();server.listHook=async owner=>{if(owner===ownerA){entered.resolve();return late.promise;}return copy(server.runs.get(owner)||[]);};
  t.setOwner(user(ownerA));await entered.promise;t.setOwner(user(ownerB));await until(()=>t.ag.loaded&&!t.ag.loading,'new account list loaded');server.listHook=null;
  await setOwner(ownerA);const ids=t.ag.runs.map(r=>r.id).join(',');late.resolve([makeRun(777)]);await delay(30);assert.equal(t.ag.runs.map(r=>r.id).join(','),ids,'old scope is invalid even after returning to the same account');
  // A plan request resolving after sign-out cannot navigate or populate the guest UI.
  const generation=deferred();server.planHook=()=>generation.promise;visit('ai');t.A.agPrompt('An unhurried day');const inFlight=t.A.agGenerate();await until(()=>t.ag.busy,'generation started');await setOwner(null);visit('journey');generation.resolve(new Response(JSON.stringify({run:makeRun(888)})));await inFlight;assert.equal(t.state.route,'journey');assert.equal(t.ag.runs.length,0);assert.equal(t.ag.activeId,null);server.planHook=null;
  await h.close();assert.deepEqual(h.errors,[]);
  // Fresh runtime loads the persisted server history rather than relying on ixDraft memory.
  h=await boot();({t,w,app,visit,change,setOwner}=h);await setOwner(ownerA);visit('ai');assert(app().querySelectorAll('.ag-run').length>0);await t.A.agOpen(runId);assert.equal(t.state.route,'ai-plan');assert.equal(t.ag.runs.find(r=>r.id===runId).status,'booked');assert.equal(t.draft.date,date);visit('ai-tasks');assert(app().textContent.includes('Delivery has not been confirmed'));
  visit('journey');assert(!app().querySelector('[data-act="agOpen"][data-a="'+runId+'"]'),'booked run is not in the Journey draft list');
  visit('home');assert(app().querySelector('[data-a="reserved-trips"]'),'Explore exposes reservations');
  visit('reserved-trips');assert(app().querySelector('[data-act="agOpen"][data-a="'+runId+'"]'),'booked itinerary appears under Explore');
  assert(!app().querySelector('[data-act="agOpen"][data-a="'+extra.id+'"]'),'unconfirmed draft does not appear as reserved');
  await setOwner(ownerB);visit('reserved-trips');assert(!app().querySelector('[data-act="agOpen"][data-a="'+runId+'"]'),'reservations stay account-scoped');visit('ai-history');assert(!t.ag.runs.some(r=>r.id===runId),'account B cannot view account A history');assert(!app().textContent.includes('Shanghai riverside walk'));
  await h.close();assert.deepEqual(h.errors,[]);
  console.log('PASS: offline agent UI auth/config gates, explicit sample, immutable server plan edits, absolute dates, consent and verified-email rules, exact confirmation, accepted-not-delivered copy, saved history/reload, stale-response and account-change races. All RPC/AI responses mocked; no real network requests or side effects.');
})().catch(async error=>{console.error(error);await delay(30);windows.forEach(w=>w.close());process.exitCode=1;});
