/* Execute the local full-application fixture, keeping every network call mocked. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),{webcrypto}=require('node:crypto');
const filename=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase/fixture-traveler-planner.html');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),windows=[];
async function until(fn,label){for(let i=0;i<250&&!fn();i++)await sleep(8);assert(fn(),label);}
async function boot(storage={}){
 const html=fs.readFileSync(filename,'utf8'),errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
 const d=new JSDOM(html,{url:'http://127.0.0.1:4173/JourneyHub-Supabase/fixture-traveler-planner.html',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=d.window;windows.push(w);
 Object.assign(w,{indexedDB:new IDBFactory(),Blob,Headers,Request,Response,TextEncoder,TextDecoder,AbortController,WebSocket,structuredClone});Object.defineProperty(w,'crypto',{value:webcrypto});w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>{};
 for(const[k,v]of Object.entries(storage))w.localStorage.setItem(k,v);
 for(const s of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean))w.eval(s);
 await until(()=>w.plannerPreviewReady,'full application bootstrap');
 return{w,errors,app:()=>w.document.getElementById('app'),storage:()=>Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)])),close:()=>w.close()};
}
(async()=>{
 const h=await boot(),{w,app}=h;assert(app().textContent.includes('Your agent is working'));
 w.plannerPreview.progress();await until(()=>app().querySelector('.ptu-working'),'saved task opens actualgenerationview');assert(app().textContent.includes('Finding more matcha options.'));assert(app().textContent.includes('Italian dining and matcha need more matches.'));
 await w.plannerPreview.needsInput();await until(()=>!app().querySelector('.ptu-working'),'missinginterest stops actualgenerationview');
 assert(app().textContent.includes('No verified matcha options'));assert(app().querySelector('[data-act="ptuEdit"]'));assert(!app().querySelector('[data-act="ptuRetry"]'),'missinginput never retriesunchangedtask');assert(!app().textContent.includes('Try place search again'));
 app().querySelector('[data-act="ptuEdit"]').click();await until(()=>app().querySelector('#ag-prompt'),'editingpreferences restoreshomepage');assert(app().querySelector('#ag-prompt').value.includes('matcha'));
 w.plannerPreview.search();await until(()=>app().querySelector('.ptu-working'),'newsearch starts');await w.plannerPreview.failure();await until(()=>app().querySelector('[data-act="ptuRetry"]'),'providerfailureoffersresume');
 app().querySelector('[data-act="ptuRetry"]').click();await until(()=>app().querySelector('.ptu-working'),'retryresumessavedtask');assert(w.calendarPreviewCalls.some(x=>x.action==='planner_retry'));
 const storage=h.storage();h.close();
 const r=await boot(storage);assert(r.app().textContent.includes('Your agent is working'));assert(!r.w.calendarPreviewCalls.some(x=>x.action==='planner_start'),'refreshdoesnotrestart generation');
 r.w.plannerPreview.progress();await until(()=>r.app().querySelector('.ptu-working'),'refreshprogressreopened');await r.w.plannerPreview.complete();await until(()=>r.app().querySelector('.jp-swipe-card'),'completedsearch becomesactualswipedeck');
 assert(!r.app().querySelector('.ptu-working'));assert(r.w.plannerPreviewRead().result.places.length===12);
 r.w.plannerPreview.planning();await until(()=>r.app().querySelector('.ptu-working'),'secondgenerationusesactualprogress');assert(r.app().textContent.includes('Checking opening hours and travel times.'));
 await r.w.plannerPreview.complete();await until(()=>r.app().textContent.includes('A complete two-day plan'),'secondgenerationopenssavedplan');assert(r.w.plannerPreviewRead().result.plan.stops.length===8);assert(r.w.plannerPreviewRead().result.plan.stops.some(s=>s.dayIndex===2));
 const runtimeErrors=[...h.errors,...r.errors].filter(x=>!x.startsWith('Could not parse CSS'));assert.deepEqual(runtimeErrors,[]);
 r.close();console.log('PASS full production fixture: bothgenerationprogress/actionlog, missing-input Edit instead ofretryloop, providerretry, refreshrecoverywithoutnewtask,12cardsandcomplete2dayplan.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>windows.forEach(w=>w.close()));
