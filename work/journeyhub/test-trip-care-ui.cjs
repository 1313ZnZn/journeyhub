const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<main id="app"></main>',{url:'https://fixture.example',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
Object.assign(w,{Response,AbortController});
const trip={id:'care-a',sourceId:'plan-a',sourceType:'history',city:'Singapore',date:'2026-11-03',status:'active',checkedAt:'2026-11-01T00:00:00Z',nextStop:{id:'place-a',name:'Garden <script>bad</script>',start:'09:00',dayIndex:1,directionsURL:'javascript:alert(1)'},bookings:[{id:'b-a',name:'Garden',status:'needs_action',detail:'Book with venue'}],alerts:[],proposal:null};
const posts=[];let deferred=null;
w.fixtureOwner='alice';w.fetch=async(_,init)=>{const p=JSON.parse(init.body);posts.push(p);assert.equal(init.headers.Authorization,'Bearer '+w.fixtureOwner);if(deferred&&p.action==='care_status')return deferred;if(p.action==='care_status')return Response.json({trips:[trip]});return Response.json({trip:p.action==='care_event'?{...trip,proposal:{id:'proposal-a',title:'Move later',summary:'A revised visit time',changes:[{name:'Garden',before:'09:00',after:'09:30'}],canApply:true}}:trip});};
w.eval(`const A={agConfirm:async()=>{ag.runs[0].status='queued';}},V={journey:()=>({body:'<main class="jl-home"><textarea id="prompt">untouched</textarea><section class="jl-home-library">Saved</section></main>'}),'place-plan':()=>({body:'<div class="pd-plan"><div class="tu-sheet-scroll"><article>Original itinerary</article></div></div>'}),'ai-plan':()=>({body:'Catalog plan'}),'ai-tasks':()=>({body:'Tasks'}),orders:()=>({body:'<section class="orders-fixture">Purchases</section>'})};
let jhUser={id:'alice'},pd={owner:'alice',sample:false,busy:false,historyId:'plan-a',plan:{stops:[]},places:[]},ag={runs:[{id:'run-a',status:'awaiting_confirmation'}]},state={route:'journey'};
const agRun=()=>ag.runs[0],agErrorText=e=>e.message,ic=()=>'',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jhConfig={url:'https://fixture.supabase.co',publishableKey:'public'},sb={auth:{getSession:async()=>({data:{session:{user:{id:jhUser?.id},access_token:jhUser?.id}}})}};
let renders=0;function render(){renders++;document.querySelector('#app').innerHTML=V[state.route]().body;}
`+fs.readFileSync(path.join(__dirname,'trip-care.js'),'utf8')+`
window.fixture={A,V,dateContext:tcDateContext,get tc(){return tc},get pd(){return pd},get renders(){return renders},load:tcLoad,render,setOwner(owner){jhUser=owner?{id:owner}:null;window.fixtureOwner=owner;tcScope();},go(route){state.route=route;render();}};`);
const f=w.fixture;
(async()=>{
  assert.equal(f.dateContext(trip,new Date('2026-11-01T00:00:00Z')).heading,'UPCOMING');assert.equal(f.dateContext(trip,new Date('2026-11-02T18:00:00Z')).heading,'TODAY','destination date rather than UTC determines today');assert.equal(f.dateContext({...trip,status:'paused'}).heading,'PAUSED');
  f.render();await new Promise(r=>setTimeout(r,10));assert(f.tc.loaded);
  assert(!w.document.querySelector('.tc-card'),'Journey stays focused on planning even with an active confirmed trip');
  assert.equal(w.document.querySelector('#prompt')?.value,'untouched','Journey keeps the AI composer');
  assert(w.document.querySelector('.jl-home-library'),'Journey keeps history and memories');
  assert.equal(f.tc.trips[0].id,trip.id,'Moving follow-up leaves confirmed-trip data intact');
  f.go('orders');assert(!w.document.querySelector('.tc-card'),'Calendar is not prefixed by unrelated active-trip support cards');assert(w.document.querySelector('.orders-fixture'),'Trip support does not replace the existing purchases renderer');
  assert.equal(f.tc.trips[0].id,trip.id,'Calendar relocation preserves the account support data');
  f.go('place-plan');assert(w.document.querySelector('.tc-card'),'Full follow-up remains in the matching itinerary reached from Calendar');
  assert(!w.document.querySelector('.tc-card script'));assert(!w.document.querySelector('.tc-card a'),'unsafe provider links omitted');
  const originalBookings=trip.bookings;
  trip.bookings=[{id:'place-a',name:'Old provider name',status:'needs_action',detail:'Related Fliggy products found',supplier:{status:'ready',offers:[{title:'Unrelated concert',url:'https://www.fliggy.com/item/1'}]}}];
  f.tc.trips[0]=trip;f.render();assert(!w.document.querySelector('.tc-bookings').textContent.includes('Unrelated concert'),'legacy unvalidated supplier items are hidden');assert(!w.document.querySelector('.tc-bookings').textContent.includes('Related Fliggy products found'),'legacy success copy is not retained');
  trip.bookings[0].supplier.relevance={version:1,placeId:'other-place',category:'dining'};f.render();assert(!w.document.querySelector('.tc-bookings a'),'supplier result for another stop is hidden');
  trip.bookings[0].supplier={status:'ready',relevance:{version:1,placeId:'place-a',category:'dining'},offers:[{title:'Matching venue dining voucher',url:'https://www.fliggy.com/item/2',price:120}]};f.render();assert(w.document.querySelector('.tc-bookings').textContent.includes('Matching venue dining voucher'),'vetted matching listings remain visible');
  trip.bookings=originalBookings;f.render();
  const buildPath=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase/index.html');
  if(fs.existsSync(buildPath)){
    const css=[...fs.readFileSync(buildPath,'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n')+'\n'+fs.readFileSync(path.join(__dirname,'trip-care.css'),'utf8');
    const card=w.document.querySelector('.tc-card').outerHTML.replace('Garden &lt;script&gt;bad&lt;/script&gt;','Singapore Botanic Gardens');
    const preview='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JourneyHub · Trip support preview fixture</title><style>'+css+'\nhtml,body{margin:0;min-height:100vh;background:var(--ground);color:var(--ink)}body{display:block}.preview-shell{width:min(100%,450px);margin:auto;padding:20px 0 60px}.preview-shell>header{padding:0 20px}.preview-shell h1{font-size:28px}.preview-shell header p{font-size:12px;color:var(--ink-3)}.preview-composer{margin:20px;border:1px solid var(--line);background:var(--surface);border-radius:22px;padding:20px;color:var(--ink-3);font-size:16px;min-height:90px}.preview-composer strong{color:var(--forest);display:block;margin-bottom:10px}</style></head><body><main class="preview-shell"><header><small>PREVIEW FIXTURE · NO LIVE REQUESTS</small><h1>Your itinerary</h1><p>Confirmed trip support, using existing app styles.</p></header>'+card+'<div style="padding:0 20px;color:var(--ink-3);font-size:12px">Open “booking items to review” to inspect the compact agent controls.</div></main></body></html>';
    fs.writeFileSync(path.resolve(__dirname,'../../outputs/Trip-Care-Preview.html'),preview);
  }
  f.go('place-plan');assert(w.document.querySelector('.tc-card'));assert(!w.document.querySelector('[data-act="tcConfirm"]'),'confirmed trip offers status rather than duplicate activation');
  f.tc.trips=[];f.render();assert(w.document.querySelector('[data-act="tcConfirm"]'));await f.A.tcConfirm();assert.equal(posts.at(-1).action,'care_confirm');assert.equal(posts.at(-1).historyId,'plan-a');
  f.pd.sample=true;f.render();assert(!w.document.querySelector('[data-act="tcConfirm"]'));const before=posts.length;await f.A.tcConfirm();assert.equal(posts.length,before,'sample cannot activate live support');f.pd.sample=false;
  await f.A.tcEvent('care-a','delay');assert.equal(posts.at(-1).minutes,30);assert(w.document.querySelector('[data-act="tcAccept"]'));await f.A.tcAccept('care-a','wrong');assert.equal(posts.at(-1).action,'care_event','only current proposal can be accepted');await f.A.tcAccept('care-a','proposal-a');assert.equal(posts.at(-1).action,'care_accept');
  f.pd.places=[{id:'place-a',name:'Fresh garden name',address:'Live address'},{id:'place-b',name:'Second stop'}];f.pd.plan={days:1,stops:[{...f.pd.places[0],dayIndex:1,start:'09:00',end:'10:00'},{...f.pd.places[1],dayIndex:1,start:'11:00',end:'12:00'}],roadRoutes:[{day:1,status:'ready',encodedPolyline:'old-route'}]};
  f.tc.trips[0].stops=[{id:'place-a',name:'Stop 1',dayIndex:1,start:'09:30',end:'10:30'}];f.render();assert.equal(f.pd.plan.stops.length,1);assert.equal(f.pd.plan.stops[0].name,'Fresh garden name');assert.equal(f.pd.plan.stops[0].start,'09:30');assert.equal(f.pd.plan.roadRoutes[0].status,'unavailable','removed stops cannot keep stale route geometry');assert(w.document.querySelector('.tc-adjusted'));
  await f.A.agConfirm();assert.equal(posts.at(-1).runId,'run-a','existing catalog confirmation enrolls automatically');
  f.go('journey');const input=w.document.querySelector('textarea');input.focus();input.setSelectionRange(2,2);const count=f.renders;await f.load(true);assert.equal(f.renders,count,'background status does not rerender active typing');assert.equal(input.selectionStart,2);
  let resolve;deferred=new Promise(r=>resolve=r);const pending=f.load(true);await new Promise(r=>setTimeout(r,0));f.setOwner('bob');f.setOwner('alice');resolve(Response.json({trips:[{...trip,id:'private-stale'}]}));await pending;assert(!f.tc.trips.some(t=>t.id==='private-stale'),'old response cannot leak after logout and back');deferred=null;
  f.setOwner(null);await f.load();assert.equal(f.tc.trips.length,0);console.log('PASS: clean Journey composer and Calendar, itinerary trip support, confirmation, sample guards, catalog auto-enrollment, proposal actions, safe rendering, active input stability and owner isolation.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>w.close());
