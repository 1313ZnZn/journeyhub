/* Source-level account, restoration and persistence tests. No paid provider calls. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),{webcrypto}=require('node:crypto');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8'),copy=x=>JSON.parse(JSON.stringify(x));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{for(let n=0;n<100&&!fn();n++)await delay(5);assert(fn(),label);};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
const input={city:'Singapore',date:'2025-01-02',days:2,guests:2,prompt:'Quiet gardens and coffee <script>unsafe</script>',dayStart:'09:00',dayEnd:'18:00',transport:'walk'};
const places=['one','two','three'].map(id=>({id,name:'Provider '+id,address:'Fresh provider address',sourceURL:'https://maps.google.com/?q='+id,attributions:[],openingHours:[],reason:'Garden stop',lat:1,lng:103}));
const plan={city:input.city,date:input.date,days:2,summary:'Original saved plan',notice:'Check before visiting',transport:'walk',stops:places.slice(0,2).map((p,i)=>({...p,dayIndex:i+1,start:'10:00',end:'11:30'}))};
const row=(id,status='search')=>({id,input,status,placeCount:3,stopCount:2,createdAt:'2026-10-28T08:00:00Z',updatedAt:'2026-10-28T08:00:00Z'});
const server={posts:[],hook:null,list:{items:[row('search-1'),row('plan-1','itinerary')],nextCursor:{id:'search-1',createdAt:'2026-10-28T08:00:00Z'}},open:{historyId:'plan-1',input,places,token:'fresh-token',expires:Date.now()+3600000,plan,wanted:['one'],skipped:['three'],unavailablePlaceIds:[]}};
const dom=new JSDOM('<div id="app"></div>',{url:'https://fixture.example/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
Object.assign(w,{Response,AbortController});Object.defineProperty(w,'crypto',{value:webcrypto});
w.fixtureOwner=null;
w.fetch=async(url,init={})=>{
  assert(String(url).includes('/functions/v1/journeyhub-agent'));
  if(init.method!=='POST')return new Response(JSON.stringify({discovery:{ready:true}}));
  const payload=JSON.parse(init.body),owner=w.fixtureOwner;server.posts.push({owner,...copy(payload)});
  assert.equal(init.headers.Authorization,'Bearer fixture-'+owner);
  if(server.hook){const response=await server.hook(payload,owner);if(response)return response;}
  const results={history_list:server.list,history_open:server.open,history_choices:{historyId:payload.id},history_import:{historyId:'import-1'},discover:{historyId:'new-search',places,token:'search-token',expires:Date.now()+3600000},discover_plan:{historyId:'new-plan',plan}};
  assert(payload.action in results,'Unexpected action '+payload.action);return new Response(JSON.stringify(results[payload.action]));
};
const setup=`
const A={jpRequirements(){},jpPick(){}},V={journey:()=>({body:'Home'}),'ai-picks':()=>({body:'Catalog'})},TAB_OF={},app=document.querySelector('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),ic=()=>'',bar=()=>'',agDate=s=>s||'',agErrorText=e=>String(e.message||e),jpDeckBacks=()=>'<div>',jpChoiceMotion=()=>{},jpPayload=()=>true;
const dayISO=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
let jhUser=null,ag={owner:null,busy:false,prefs:${JSON.stringify(input)}},state={route:'journey'},login=null;
const jhConfig={url:'https://supabase.fixture',publishableKey:'public-key'},jpSavePrefs=()=>{},jpNormalize=p=>JSON.parse(JSON.stringify(p)),toast=()=>{};
// Calendar management has its own full-bundle tests; this source harness has no removed records.
const cmHidden=()=>false,cmActionButton=()=>'';
const sb={auth:{getSession:async()=>({data:{session:jhUser?{user:jhUser,access_token:'fixture-'+jhUser.id}:null}})}};
function render(){const view=V[state.route]?.();app.innerHTML=(view?.body||'')+(view?.foot||'');view?.after?.();}
function go(route){state.route=route;render();}
function openLogin(kind,returnTo){login={kind,returnTo};}
let doLogin=async()=>{},signOut=async()=>{};
`;
w.eval(setup+read('place-discovery.js')+`
const fixturePlan=V['place-plan'];V['place-plan']=()=>{const view=fixturePlan();if(window.fixtureSheet){const template=document.createElement('template');template.innerHTML=view.body;view.body='<div class="pd-plan"><div class="tu-sheet"><div class="tu-title"><h1>Sample city</h1></div><div class="tu-sheet-scroll">'+template.content.querySelector('.pd-plan').innerHTML+'<details class="tu-trip-details"></details></div></div></div>';}return view;};
`+read('trip-history.js')+`
window.fixture={A,go,render,get pd(){return pd},get th(){return th},get state(){return state},get login(){return login},get ag(){return ag},flush:thFlushChoices,save:thSaveCurrent,badge:thBadge,
setOwner(id){window.fixtureOwner=id;jhUser=id?{id}:null;ag={...ag,owner:id};render();},
live(opts={}){pd={...pdFresh(),mode:true,input:${JSON.stringify(input)},places:${JSON.stringify(places)},token:'live-token',expires:Date.now()+3600000,...opts};return pd;}};`);
const t=w.fixture,app=()=>w.document.querySelector('#app');
(async()=>{
  t.go('trip-history');assert(app().textContent.includes('Sign in'));assert.equal(server.posts.length,0);t.A.thSignIn();assert.equal(t.login.returnTo.route,'trip-history');
  t.setOwner('alice');await until(()=>t.th.loaded,'owner history loads');assert.equal(t.th.items.length,2);assert(app().querySelector('[data-a="journey-drafts"]'));assert(app().querySelector('[data-a="reserved-trips"]'));assert.equal(app().querySelectorAll('script').length,0,'prompt is escaped');
  server.list={items:[row('plan-1','itinerary'),row('older')],nextCursor:null};await t.A.thMore();assert.deepEqual(copy(t.th.items.map(x=>x.id)),['search-1','plan-1','older']);assert(server.posts.at(-1).cursor);
  await t.A.thOpen('plan-1');assert.equal(t.state.route,'place-plan');assert.equal(t.pd.plan.date,'2025-01-02');assert.equal(t.pd.plan.stops[1].start,'10:00');assert.equal(t.pd.plan.stops[1].dayIndex,2);assert.deepEqual(copy(t.pd.wanted),['one']);assert.equal(t.pd.token,'fresh-token');assert(app().textContent.includes('Saved to Trip history'));assert.equal(server.posts.filter(p=>['discover','discover_plan','confirm'].includes(p.action)).length,0,'reopening never regenerates or books');
  const baseline=server.posts.length;t.go('ai-picks');t.A.jpPick('two','want');await t.flush(t.pd);assert.deepEqual(copy(server.posts.at(-1).wanted),['one','two']);assert.equal(server.posts.at(-1).action,'history_choices');assert.equal(t.pd.plan,null);assert.equal(t.pd.historyRevision,t.pd.historySavedRevision);assert.equal(server.posts.length,baseline+1);
  const first=deferred();let choiceCalls=0;server.hook=async payload=>{if(payload.action==='history_choices'&&++choiceCalls===1)return first.promise;};
  t.A.pdReset();const ctx=t.pd,pending=t.flush(ctx);await until(()=>choiceCalls===1,'first choices saving');t.A.jpPick('one','want');const also=t.flush(ctx);assert.equal(choiceCalls,1,'requests serialize');first.resolve(new Response(JSON.stringify({historyId:ctx.historyId})));await Promise.all([pending,also]);assert.equal(choiceCalls,2);assert.deepEqual(copy(server.posts.at(-1).wanted),['one']);assert.equal(ctx.historyRevision,ctx.historySavedRevision);
  server.hook=async payload=>payload.action==='history_choices'?new Response(JSON.stringify({error:{message:'Offline fixture'}}),{status:503}):undefined;
  t.A.jpPick('two','skip');await t.flush(ctx);assert(ctx.historyError.includes('Offline'));assert(app().textContent.includes('Changes not saved'));server.hook=null;await t.A.thSave();assert.equal(ctx.historyError,'');assert.equal(ctx.historyRevision,ctx.historySavedRevision);
  const importCtx=t.live({plan:copy(plan)});await t.save(importCtx);const imported=server.posts.find(p=>p.action==='history_import');assert(imported);assert.deepEqual(Object.keys(imported.plan.stops[0]).sort(),['dayIndex','end','id','reason','start']);assert(!JSON.stringify(imported).includes('Fresh provider address'));assert(!JSON.stringify(imported).includes('Provider one'));assert.equal(importCtx.historyId,'import-1');assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
  server.hook=async payload=>payload.action==='discover'?new Response(JSON.stringify({places,token:'partial',expires:Date.now()+3600000,historyId:null,historyError:'Save unavailable'})):undefined;
  t.go('journey');await t.A.jpRequirements();assert.equal(t.state.route,'ai-picks');assert.equal(t.pd.places.length,3);assert.equal(t.pd.historyId,null);assert(app().textContent.includes('Not saved yet'));assert.match(server.posts.findLast(p=>p.action==='discover').requestId,/^[0-9a-f-]{36}$/);server.hook=null;await t.A.thSave();assert.equal(t.pd.historyId,'import-1');
  await t.A.pdFinish();assert.equal(t.pd.historyId,'new-plan');assert.equal(t.state.route,'place-plan');assert.equal(server.posts.at(-1).action,'discover_plan');
  // Changing accounts twice must not resurrect Alice's old response in a new Alice session.
  t.go('journey');const delayed=deferred();server.hook=async payload=>payload.action==='history_list'?delayed.promise:undefined;const load=t.A.thRefresh();await delay(0);const oldTH=t.th;t.setOwner('bob');t.setOwner('alice');assert.notEqual(t.th,oldTH);delayed.resolve(new Response(JSON.stringify({items:[row('private-old')],nextCursor:null})));await load;assert(!t.th.items.some(x=>x.id==='private-old'));server.hook=null;
  server.list={items:[row('plan-1','itinerary')],nextCursor:null};t.go('trip-history');await until(()=>t.th.loaded,'new Alice loads');const opening=deferred();server.hook=async payload=>payload.action==='history_open'?opening.promise:undefined;const open=t.A.thOpen('plan-1');await delay(0);t.go('journey');t.go('trip-history');opening.resolve(new Response(JSON.stringify(server.open)));await open;assert.equal(t.state.route,'trip-history','leaving and returning cancels pending navigation');
  const oldOpen=deferred();server.hook=async payload=>payload.action==='history_open'?oldOpen.promise:undefined;const accountOpen=t.A.thOpen('plan-1');await delay(0);t.go('journey');t.setOwner('bob');t.setOwner('alice');oldOpen.resolve(new Response(JSON.stringify(server.open)));await accountOpen;assert.equal(t.pd.token,null,'old owner response cannot restore private trip');
  server.hook=null;server.open={...server.open,unavailablePlaceIds:['one'],places:places.map(p=>p.id==='one'?{...p,name:'Place details unavailable',lat:null,lng:null}:p),plan:{...plan,stops:plan.stops.map(p=>p.id==='one'?{...p,name:'Place details unavailable',lat:null,lng:null}:p)}};t.go('trip-history');await until(()=>t.th.loaded,'list for unavailable place');await t.A.thOpen('plan-1');assert(app().textContent.includes('original itinerary and visit times are preserved'));
  const sampleInput={...input,prompt:'[Sample] Gardens and a riverside walk'},samplePlaces=places.map(p=>({...p,sample:true,source:'JourneyHub sample catalog',sourceURL:p.id==='two'?'https://www.google.com/maps/search/?api=1&query=Garden':'https://venue.example/garden'}));
  server.list={items:[{...row('sample-plan','itinerary'),input:sampleInput}],nextCursor:null};server.open={...server.open,historyId:'sample-plan',sample:true,input:sampleInput,places:samplePlaces,unavailablePlaceIds:[],plan:{...plan,sample:true,stops:plan.stops.map(s=>({...s,...samplePlaces.find(p=>p.id===s.id)}))}};
  t.go('trip-history');await t.A.thRefresh();assert.equal(app().querySelector('.th-state.sample').textContent,'Sample itinerary','sample histories are visibly distinct');
  w.fixtureSheet=true;await t.A.thOpen('sample-plan');assert.equal(t.pd.sample,true);assert(app().querySelector('[aria-label="Sample trip"]'));assert(app().textContent.includes('JourneyHub sample catalog'));assert(!app().textContent.includes('Place data: Google Maps'),'catalog fixtures never claim Google provenance');assert(app().querySelector('a[href="https://venue.example/garden"]').textContent.includes('View place details'),'venue link has an honest label');
  assert(!app().querySelector('.tu-sheet>.th-sample'),'the sample explanation cannot enlarge the fixed sheet header');const sampleNotice=app().querySelector('.tu-sheet-scroll>.th-sample');assert(sampleNotice,'sample explanation and new-trip action scroll with the content');assert(app().querySelector('.tu-sheet>.th-save-status').textContent.includes('Sample · Saved'),'the compact fixed status still identifies sample data');assert(app().querySelector('.tu-sheet-scroll>section').compareDocumentPosition(sampleNotice)&w.Node.DOCUMENT_POSITION_FOLLOWING,'timeline cards come before sample explanatory text');
  t.go('ai-picks');assert(app().textContent.includes('JourneyHub sample catalog'));assert(app().textContent.includes('Open in Google Maps'),'Google text-search links retain a clear label');assert(app().querySelector('[data-act="pdNewSearch"]'));assert(!app().querySelector('[data-act="pdFinish"]'),'sample shortlist offers a fresh search instead of generation');
  const beforeSamplePlan=server.posts.length;await t.A.pdFinish();assert.equal(server.posts.length,beforeSamplePlan,'programmatic sample generation also makes no provider request');assert(t.pd.error.includes('read-only'));t.A.jpPick('two','want');await t.flush(t.pd);assert.equal(server.posts.at(-1).action,'history_choices','sample choices may persist without generating an itinerary');
  t.A.pdNewSearch();assert.equal(t.state.route,'journey');assert.equal(t.ag.prefs.prompt,'Gardens and a riverside walk','a personal search drops the explicit sample marker');assert.equal(t.ag.prefs.date,new Date(Date.now()+86400000).toISOString().slice(0,10),'an expired sample date becomes tomorrow for a new personal search');assert.equal(t.pd.input.date,input.date,'the saved sample keeps its original travel date');
  const futureDate=new Date(Date.now()+14*86400000).toISOString().slice(0,10);t.ag.prefs.date=futureDate;t.A.pdNewSearch();assert.equal(t.ag.prefs.date,futureDate,'a valid future travel date is preserved');await t.A.jpRequirements();assert.equal(t.pd.sample,false,'a new real search does not inherit sample mode');assert(!app().querySelector('[aria-label="Sample trip"]'));assert(app().textContent.includes('Google Maps'));
  assert(server.posts.every(p=>['history_list','history_open','history_choices','history_import','discover','discover_plan'].includes(p.action)));assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
  console.log('PASS: history paging, sign-in, safe rendering, exact restore, no AI on reopen, serialized choices, retry/import, owner isolation, stale navigation, unavailable places, explicit sample provenance, read-only sample generation, and fresh-search mode reset.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>w.close());
