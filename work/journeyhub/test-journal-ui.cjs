const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),{webcrypto}=require('node:crypto');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase'),html=fs.readFileSync(path.join(out,'index.html'),'utf8'),indexedDB=new IDBFactory();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let commands=0;const windows=[];
async function boot(){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
  const dom=new JSDOM(html,{url:'http://localhost:4173/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
  windows.push(w);
  Object.assign(w,{indexedDB,Blob,Headers,Request,Response,TextEncoder,TextDecoder,AbortController,WebSocket});
  Object.defineProperty(w,'crypto',{value:webcrypto});
  w.URL.createObjectURL=()=> 'blob:journal-test-'+webcrypto.randomUUID();w.URL.revokeObjectURL=()=>{};
  w.fetch=async(input,init={})=>{const url=String(input?.url||input);if(url.includes('/journeyhub_command')||url.includes('/journeyhub_agent_confirm')){commands++;throw Error('Journal tests must never invoke backend writes.');}if(url.includes('/functions/v1/journeyhub-agent')){assert.notEqual(init.method,'POST','journal checks must never generate a real AI plan');return new Response(JSON.stringify({ai:{ready:false,provider:'deepseek',model:'deepseek-chat'},email:{ready:false},worker:{ready:false},booking:{mode:'journeyhub_catalog',sample:true}}));}if(url.includes('/journeyhub_agent_list'))return new Response('[]',{headers:{'Content-Type':'application/json'}});return fetch(input,init);};
  w.eval(fs.readFileSync(path.join(out,'vendor/supabase.js'),'utf8'));w.eval(fs.readFileSync(path.join(out,'config.js'),'utf8'));
  let script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean).join('\n');
  script=script.replace('jhStart();','window.JH_TEST={get state(){return state},get DBC(){return DBC},get A(){return A},get V(){return V},get ui(){return ui},get cache(){return jmCache},get JM(){return JM},get error(){return jhLastError},get live(){return MODE.kind===\'live\'&&!jhLoading},get drafts(){return jmNoteDrafts},go,render,jmLoad,jmRun,replaceLoad(fn){const old=jmLoad;jmLoad=fn;return old;},setOwner(id){jhUser=id?{id}:null;jhPersonalReady=false;jhLoading=true;render();}};jhStart();');
  w.eval(script);const t=w.JH_TEST;
  for(let i=0;i<100&&(!t.live||!t.cache.loaded);i++)await delay(100);
  assert.equal(t.error,'');assert(t.live,'live catalog bootstrap completes');assert(t.cache.loaded,'local journal bootstrap completes');
  const app=()=>w.document.querySelector('#app');
  const visit=(route,params={})=>{assert.equal(typeof t.V[route],'function');t.state.role='traveler';t.state.guestOk=true;t.go(route,params);assert(!app().textContent.includes('Something went wrong'),route);};
  const settled=async()=>{for(let i=0;i<100&&(t.cache.busy||t.cache.loading||!t.cache.loaded);i++)await delay(10);assert(!t.cache.busy&&!t.cache.loading&&t.cache.loaded,'local journal operation settles');};
  return {dom,w,t,app,visit,settled,errors};
}
(async()=>{
  let h=await boot(),{t,w,app,visit,settled}=h;
  visit('journey');assert(app().querySelector('[data-a="memories"]'),'Journey has a travel-memory entry');
  visit('memories');assert(app().textContent.includes('Your first chapter starts here'));
  for(const route of ['memory-photo','memory-trip'])visit(route,{id:'missing'});
  for(const route of ['memory-badges','memory-poster','memory-new'])visit(route);
  t.A.destination('Shanghai');t.A.addQuick('tote');
  t.state.plan.savedStops=[{ref:'free:keep',kind:'free',title:'Original walking plan',time:'10:00',cat:'Culture',slot:null}];
  t.state.plan.savedMeta={day:1,T:2,total:0};
  const candidate=Object.values(t.DBC.sessions).find(s=>t.DBC.experiences[s.exp]?.city==='Shanghai'&&s.day>=0&&s.day<=6&&!s.closed&&s.cap-s.taken>=2);assert(candidate,'live Shanghai preview has an available session');
  const candidateDate=new Intl.DateTimeFormat('en-CA',{timeZone:candidate.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(candidate.startsAt));
  t.A.ixStart();
  for(const [key,value] of [['agDate',candidateDate],['agGuests',2]]){const el=app().querySelector('[data-ch="'+key+'"]');el.value=String(value);el.dispatchEvent(new w.Event('change',{bubbles:true}));}
  t.A.agPrompt('Culture first');t.A.agPreview();t.A.ixSave();visit('ai-plan');assert(app().querySelector('[data-act="jmStartFromPlan"]'),'sample itinerary opens post-plan journal');
  const before=JSON.stringify({cart:t.state.cart,plan:t.state.plan,bookings:t.DBC.bookings,orders:t.DBC.orders});
  await t.A.jmStartFromPlan();await settled();assert.equal(t.state.route,'memory-trip');
  const tripId=t.state.params.id,trip=await t.JM.getTrip('guest',tripId);assert(trip.stops.length);assert.equal(trip.city,'Shanghai');assert(trip.stops.every(s=>!s.visited));
  assert.equal(JSON.stringify({cart:t.state.cart,plan:t.state.plan,bookings:t.DBC.bookings,orders:t.DBC.orders}),before,'starting a journal preserves AI/original plans, cart, orders and bookings');
  await t.A.jmStartFromPlan();await settled();assert.equal((await t.JM.listTrips('guest')).length,1,'starting the same itinerary resumes its journal');
  const stopId=trip.stops[0].id;t.A.jmTab('timeline');
  const note=app().querySelector('[data-in="jmNote"]');note.value='The skyline at sunset was wonderful.';note.dispatchEvent(new w.Event('input',{bubbles:true}));
  t.render();assert.equal(app().querySelector('[data-in="jmNote"]').value,note.value,'note survives refresh render before saving');
  t.A.jmSaveNote(stopId);await settled();assert.equal((await t.JM.getTrip('guest',tripId)).stops[0].note,note.value);
  t.A.jmVisited(stopId);await settled();assert.equal((await t.JM.getTrip('guest',tripId)).stops[0].visited,true);
  assert.equal(JSON.stringify({cart:t.state.cart,plan:t.state.plan,bookings:t.DBC.bookings,orders:t.DBC.orders}),before,'notes and visited marks do not alter business state');
  const repeated=await t.JM.saveTrip('guest',{...trip,id:webcrypto.randomUUID(),title:'Another trip with the same stops'});await t.jmLoad();
  const unsaved=app().querySelector('[data-in="jmNote"]');unsaved.value='Private unsaved note for the first trip';unsaved.dispatchEvent(new w.Event('input',{bubbles:true}));
  visit('memory-trip',{id:repeated.id});t.A.jmTab('timeline');assert.notEqual(app().querySelector('[data-in="jmNote"]').value,unsaved.value,'note drafts are scoped by trip as well as stop');
  await t.JM.deleteTrip('guest',repeated.id);await t.jmLoad();visit('memory-trip',{id:tripId});t.A.jmTab('timeline');
  app().querySelector('[data-in="jmNote"]').value=note.value;app().querySelector('[data-in="jmNote"]').dispatchEvent(new w.Event('input',{bubbles:true}));
  t.A.jmTab('map');assert(app().textContent.includes('0 of 0 photos have a location'),'empty photo map renders without inventing GPS');
  // Deterministic local photo fixture; actual browser decoding/import/export is exercised separately.
  w.createImageBitmap=async()=>({width:800,height:600,close(){}});
  w.OffscreenCanvas=class{constructor(width,height){this.width=width;this.height=height;}getContext(){return {fillRect(){},drawImage(){}};}async convertToBlob(){return new Blob(['fixture-image'],{type:'image/jpeg'});}};
  w.exifr={parse:async()=>({DateTimeOriginal:'2026:10:24 12:30:00'}),gps:async()=>({latitude:31.23,longitude:121.47})};
  const image=new Blob(['fixture-original'],{type:'image/jpeg'});Object.defineProperties(image,{name:{value:'journal-fixture.jpg'},lastModified:{value:Date.UTC(2026,9,24)}});
  assert.equal((await t.JM.importPhotos('guest',tripId,[image],{stopId})).added,1);await t.jmLoad();const photo=(await t.JM.listPhotos('guest',tripId))[0];
  t.A.jmPhoto(photo.id);const photoNote=app().querySelector('#jm-photo-form [name="note"]');photoNote.value='Photo note that survives refresh';photoNote.dispatchEvent(new w.Event('input',{bubbles:true}));t.render();
  assert.equal(app().querySelector('#jm-photo-form [name="note"]').value,photoNote.value,'photo form edits survive refresh render');
  t.A.jmSavePhoto();await settled();const edited=(await t.JM.listPhotos('guest',tripId))[0];assert.equal(edited.note,photoNote.value);assert.equal(edited.dateSource,'exif','note-only edits preserve capture-date provenance');assert.equal(edited.locationSource,'exif','note-only edits preserve GPS provenance');
  t.A.jmNew();const title=app().querySelector('[name="title"]');title.value='Unsaved custom title';title.dispatchEvent(new w.Event('input',{bubbles:true}));
  // This check also catches the periodic Supabase renderer dropping an active form draft.
  t.render();assert.equal(app().querySelector('[name="title"]').value,'Unsaved custom title','new-memory input survives unrelated renders');
  await t.JM.saveTrip('other-owner',{title:'Private other-account trip',city:'Singapore',date:'2026-10-24',stops:[]});
  t.setOwner('other-owner');await settled();visit('memories');assert(app().textContent.includes('Private other-account trip'));assert(!t.cache.trips.some(x=>x.id===tripId),'account change hides guest journals');
  visit('memory-new');assert(!app().textContent.includes('Unsaved custom title'));assert.notEqual(app().querySelector('[name="title"]').value,'Unsaved custom title','account change clears another owner’s unsaved form');
  t.setOwner(null);await settled();visit('memory-trip',{id:tripId});t.A.jmTab('timeline');assert(app().textContent.includes(trip.stops[0].title));assert.equal(app().querySelector('[data-in="jmNote"]').value,note.value);
  assert.deepEqual(h.errors,[]);h.dom.window.close();
  // A fresh application runtime shares IndexedDB, but not the previous in-memory cache.
  h=await boot();({t,w,app,visit,settled}=h);visit('memory-trip',{id:tripId});t.A.jmTab('timeline');assert.equal(app().querySelector('[data-in="jmNote"]').value,'The skyline at sunset was wonderful.');assert.equal(app().querySelector('[data-act="jmVisited"]').getAttribute('aria-pressed'),'true');
  assert.equal(t.cache.trips.length,1,'reload remains scoped to guest');
  // Switch accounts precisely while the old operation is awaiting its final cache reload.
  let release,entered;const blocked=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const originalLoad=t.replaceLoad(async owner=>{if(owner==='guest'){entered();await blocked;return;}return originalLoad(owner);});
  const oldOperation=t.jmRun(async()=>({route:'memory-trip',params:{id:tripId}}));await started;
  t.setOwner('other-owner');await settled();visit('memories');release();await oldOperation;
  assert.equal(t.state.route,'memories','old owner cannot navigate after an awaited cache reload');assert.equal(t.cache.owner,'other-owner');
  t.replaceLoad(originalLoad);t.setOwner(null);await settled();
  // Returning to the same owner still creates a new cache scope, invalidating the old job.
  let releaseAgain;const pending=new Promise(resolve=>{releaseAgain=resolve;});const stale=t.jmRun(async()=>{await pending;return {route:'memory-trip',params:{id:tripId}};});
  t.setOwner('other-owner');await settled();t.setOwner(null);await settled();visit('memories');releaseAgain();await stale;
  assert.equal(t.state.route,'memories','guest → account → guest does not resurrect an old operation');
  assert.deepEqual(h.errors,[]);h.dom.window.close();
  assert.equal(commands,0,'all journal operations remain local');
  console.log('PASS: Journey/AI-plan journal entry, immutable snapshot and original business-state preservation, notes/visited persistence and reload, empty map/detail routes, draft rendering and account isolation. No backend writes; IndexedDB uses fake-indexeddb.');
})().catch(error=>{console.error(error);windows.forEach(w=>w.close());process.exitCode=1;});
