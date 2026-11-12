/* Isolated browser contracts: the production adapter, no remote model or booking writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom'),{webcrypto}=require('node:crypto');
const copy=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(r=>setImmediate(r));
const input={city:'Shanghai',date:'2026-12-01',prompt:'Shanghai local food, Italian restaurants, matcha and museums',days:2,guests:2};
const place=i=>({id:'p'+i,name:['Shanghai local food','Italian restaurant','Matcha cafe','Museum'][i%4]+' '+i,source:'Amap',sourceURL:'https://example.test/p'+i,attributions:[],openingHours:[],photo:{url:'https://example.test/photo'+i}});
function harness({task=null,hint=null,route='journey',adapter=true}={}){
  const dom=new JSDOM('<main id="app"></main>',{runScripts:'outside-only',url:'https://journey.test/'}),w=dom.window,calls=[];
  Object.defineProperty(w,'crypto',{value:webcrypto});Object.assign(w,{AbortController,Response});
  if(hint)w.localStorage.setItem('journeyhub-planner-task-owner',hint);
  let live=task&&copy(task),transport=null;
  w.fetch=async(url,init)=>{const p=JSON.parse(init.body);calls.push(p);if(transport)return transport(p);
    if(p.action==='planner_start'){live={id:'task-'+p.kind,kind:p.kind,status:'running',input,stage:'searching',message:'Checking your interests.',events:[],updatedAt:new Date().toISOString()};return Response.json({task:live});}
    if(p.action==='planner_retry'){live={...live,status:'running',error:null,message:'Continuing saved work.'};return Response.json({task:live});}
    if(p.action==='history_open')return Response.json({input,places:Array.from({length:12},(_,i)=>place(i)),token:'restored-token',expires:Date.now()+3600000,wanted:['p0','p1'],skipped:[]});
    return Response.json({task:live});};
  w.eval(`const TAB_OF={},A={jpRequirements(){},jpPick(){}},V={'ai-picks':()=>({body:''}),journey:()=>({body:'<textarea id="ag-prompt">Keep my typed prompt</textarea>'})};
    let jhUser={id:'owner'},ag={owner:'owner',busy:false,prefs:${JSON.stringify(input)}},state={route:${JSON.stringify(route)}};
    const jhConfig={url:'https://fixture.test',publishableKey:'public-fixture'},sb={auth:{getSession:async()=>({data:{session:jhUser?{user:jhUser,access_token:'fixture-token'}:null}})}};
    let renders=0;let render=()=>{renders++;document.getElementById('app').innerHTML=V[state.route]?.().body||'';},doLogin=async()=>{},signOut=async()=>{};
    const toast=()=>{},go=route=>{state.route=route;render();},traveler=()=>jhUser,jpSavePrefs=()=>{},jpNormalize=x=>x,jpPayload=x=>x,agErrorText=e=>e.message,jpChoiceMotion=()=>{};
    const bar=x=>x,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),ic=()=>'',agDate=s=>s,jpDeckBacks=()=>'',dayISO=()=> '2026-11-04';
    const thSavedResult=(ctx,result)=>{ctx.historyId=result.historyId;},jhInvalidateSnapshot=()=>{};
    `+fs.readFileSync(__dirname+'/place-discovery.js','utf8')+'\n'+(adapter?fs.readFileSync(__dirname+'/traveler-planner-ui.js','utf8'):'const ptu=null,ptuPoll=()=>{},ptuRestore=()=>{},ptuScope=()=>{};')+`
    window.f={A,V,ag,state,render,poll:ptuPoll,restore:()=>ptuRestore(ptu),working:pdWorkingHTML,bindTask(task){ptuScope();ptu.task=task;ptu.binding=pd;pd.plannerTask=task;pd.plannerTaskId=task.id;},get ptu(){return ptu},get pd(){return pd},get renders(){return renders},scope:ptuScope,setOwner(id){jhUser=id?{id}:null;ag.owner=id;ptuScope();},seed(p){pd=pdFresh();Object.assign(pd,p);},getHTML:()=>document.getElementById('app').innerHTML};`);
  return {w,dom,f:w.f,calls,set live(x){live=copy(x)},get live(){return live},set transport(x){transport=x},close(){w.close()}};
}
module.exports={harness,input,place,tick,copy};
if(require.main===module)(async()=>{
  const h=harness(),{f}=h;
  const search=f.A.jpRequirements();await tick();assert.equal(h.calls[0].action,'planner_start');assert.equal(h.calls[0].kind,'discover');assert.equal(h.calls[0].payload.days,2);assert(f.pd.busy);
  h.live={...h.live,stage:'supplementing',message:'Finding more matcha options.',events:[{kind:'tool',tool:'search_places',summary:'Found local food and museums.'},{kind:'tool',tool:'search_places',summary:'<script>bad</script> Finding matcha options.'}]};await f.poll();
  assert(f.getHTML().includes('Finding more matcha options.'));assert(!f.getHTML().includes('<script>bad</script>'));assert(f.getHTML().includes('Agent activity'));assert(!f.getHTML().includes('aria-valuenow'),'no fabricated numeric percentage');
  h.live={...h.live,message:'Checking Italian restaurant options.',events:Array.from({length:6},(_,i)=>({kind:'tool_result',tool:'search_places',summary:'Verified requested interest '+i+'.'}))};await f.poll();assert.equal(h.w.document.querySelectorAll('.ptu-steps li').length,4);assert.equal(h.w.document.querySelectorAll('.ptu-steps .is-done').length,3);assert.equal(h.w.document.querySelectorAll('.ptu-steps .is-current').length,1);assert(!h.w.document.querySelector('.ptu-log'),'recent actions are directly visible, not folded');assert(!f.getHTML().includes('Verified requested interest 0.'));
  const searchResult={places:Array.from({length:12},(_,i)=>place(i)),token:'signed-token',expires:Date.now()+3600000,historyId:'search-history'};
  h.live={...h.live,status:'completed',result:searchResult};await f.poll();await search;
  assert.equal(f.pd.places.length,12);assert.equal(f.state.route,'ai-picks');assert.equal(f.pd.historyId,'search-history');assert(!f.pd.busy);assert.equal(h.calls.filter(c=>c.action==='planner_start').length,1);
  f.pd.wanted=['p0','p1','p2','p3'];const plan=f.A.pdFinish();await tick();assert.equal(h.calls.at(-1).kind,'discover_plan');assert.deepEqual(h.calls.at(-1).payload.wanted,['p0','p1','p2','p3']);
  h.live={...h.live,message:'Checking travel time between selected places.',events:[{kind:'tool_result',tool:'check_hours',summary:'Checked saved opening hours.'}]};await f.poll();assert(f.getHTML().includes('Checked saved opening hours.'));assert(f.getHTML().includes('Checking travel time between selected places.'));assert(h.w.document.querySelector('.pd-generation-progress'),'the existing progress bar remains in the second phase');
  const planResult={historyId:'plan-history',plan:{city:'Shanghai',date:input.date,days:2,summary:'Food and museums',notice:'',stops:[0,1,2,3].map((i)=>({...place(i),dayIndex:Math.floor(i/2)+1,start:i%2?'13:00':'09:00',end:i%2?'14:30':'11:00',reason:'A selected visit'}))}};
  h.live={...h.live,status:'completed',result:planResult};await f.poll();await plan;
  assert.equal(f.state.route,'orders');assert.equal(f.pd.plan.stops.length,4);assert(!h.calls.some(c=>/book|pay|topup|care_/.test(c.action)));
  h.close();

  // Boot restoration only reads the account-owned task; it neither starts a second
  // run nor forces the user away from the page they are reading or typing into.
  const pending={id:'restore-plan',kind:'discover_plan',status:'running',input,stage:'checking_routes',message:'Checking travel times.',events:[]};
  const r=harness({task:pending,hint:pending.id}),rf=r.f;rf.render();await tick();assert.equal(r.calls[0].action,'planner_status');assert.equal(r.calls[0].id,pending.id);assert.equal(rf.state.route,'journey');assert(rf.getHTML().includes('Your agent is working'));
  const text=r.w.document.getElementById('ag-prompt');text.focus();text.value='Do not lose my new prompt';const renders=rf.renders;await rf.poll();assert.equal(rf.renders,renders);assert.equal(text.value,'Do not lose my new prompt');
  const open=rf.A.ptuOpen();await tick();assert.equal(rf.state.route,'ai-picks');assert(rf.pd.busy);assert(!r.calls.some(c=>c.action==='planner_start'));
  r.live={...pending,status:'completed',result:planResult};await rf.poll();await open;
  assert.equal(rf.state.route,'orders');assert.equal(rf.pd.token,'restored-token');assert.equal(rf.pd.places.length,12);assert.equal(rf.pd.plan.stops.length,4);assert(r.calls.some(c=>c.action==='history_open'),'reuses saved search media on refresh');
  r.close();

  const e=harness(),ef=e.f;const first=ef.A.jpRequirements();await tick();e.live={...e.live,status:'needs_input',message:'No verified matcha options were found.',error:{code:'MISSING_INTEREST',message:'No verified matcha options were found.'}};await ef.poll();await first;
  assert(!ef.pd.busy);assert.equal(ef.pd.places.length,0);assert(!ef.getHTML().includes('Continue saved task'));assert(ef.getHTML().includes('Edit trip preferences'));
  const callCount=e.calls.length;ef.A.ptuRetry();assert.equal(ef.state.route,'journey');assert.equal(e.calls.length,callCount,'needs_input cannot loop unchangedtask');
  e.live={...e.live,status:'failed',message:'A provider request failed.',error:{code:'PROVIDER_UNAVAILABLE',message:'A provider request failed.'}};await ef.poll();
  const retry=ef.A.ptuRetry();await tick();assert.equal(e.calls.at(-1).action,'planner_retry');assert.equal(e.calls.at(-1).id,'task-discover');e.live={...e.live,status:'completed',result:searchResult};await ef.poll();await retry;assert.equal(ef.pd.places.length,12);assert.equal(e.calls.filter(c=>c.action==='planner_start').length,1);e.close();

  // Account switch fences delayed results and detaches the previous wait promise.
  const a=harness(),af=a.f;const old=af.A.jpRequirements();await tick();let release;a.transport=()=>new Promise(resolve=>release=resolve);const late=af.poll();await tick();af.setOwner('another-owner');release(Response.json({task:{...a.live,status:'completed',result:searchResult}}));await late;await old;
  assert.equal(af.ptu.owner,'another-owner');assert.equal(af.ptu.task,null);assert(!af.pd.plan);a.close();

  // A fresh generation renders before the start response arrives. A prior
  // phase, terminal task or detached discovery must never flash its message.
  const s=harness(),sf=s.f,active={id:'bound-task',kind:'discover',status:'running',message:'Current search is checking matcha.',events:[]};sf.seed({busy:true,phase:'search'});sf.bindTask(active);
  assert(sf.working('search').includes(active.message),'current bound search shows real progress');
  assert(!sf.working('plan').includes(active.message),'search progress cannot flash during plan generation');
  for(const status of ['completed','failed','needs_input']){sf.bindTask({...active,status,message:'Old '+status+' result'});assert(!sf.working('search').includes('Old '+status+' result'),'terminal '+status+' is not working progress');}
  sf.bindTask(active);sf.pd.plannerTask=null;assert(!sf.working('search').includes(active.message),'no fallback to global prior task');
  sf.bindTask(active);sf.seed({busy:true,phase:'search',plannerTask:active,plannerTaskId:active.id});assert(!sf.working('search').includes(active.message),'different discovery binding cannot supply progress');
  const resumed={...active,kind:'discover_plan',message:'Restored task is checking routes.'};sf.bindTask(resumed);assert(sf.working('plan').includes(resumed.message),'restored active task remains visible');sf.setOwner('other');assert(!sf.working('plan').includes(resumed.message),'previous account cannot supply progress');s.close();
  const ready=harness({task:{...pending,status:'completed',result:planResult}});ready.f.render();await tick();assert(ready.f.getHTML().includes('Your itinerary is ready'));assert(!ready.f.getHTML().includes('Your itinerary are ready'));ready.close();
  console.log('PASS durable traveler UI: two real-stage flows, 12 cards/media preserved, no fake progress, refresh recovery, no duplicate start, same-task retry, input stability, stale-phase progress and account/late-response isolation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
