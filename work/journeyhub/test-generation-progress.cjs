/* Real pending/settled discovery transitions; every network response is mocked. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),{webcrypto}=require('node:crypto');
const dom=new JSDOM('<div id="app"></div>',{url:'https://fixture.test',runScripts:'outside-only'}),w=dom.window;
Object.assign(w,{Response,AbortController,Image:class{}});Object.defineProperty(w,'crypto',{value:webcrypto});
const pending=[],calls=[];
w.fetch=async(url,init={})=>{
  if(String(url).includes('action=health'))return Response.json({discovery:{ready:true}});
  const body=JSON.parse(init.body);calls.push(body);return new Promise(resolve=>pending.push(resolve));
};
w.eval(`
const A={jpRequirements(){},jpPick(){}},V={journey:()=>({body:'<textarea></textarea>'}),'ai-picks':()=>({body:'Catalog cards'})},TAB_OF={};
let ag={owner:'alice',busy:false,error:'',prefs:{city:'Shanghai',date:'2099-01-01',prompt:'',days:1}},jhUser={id:'alice'},state={route:'journey'};
const jhConfig={url:'https://fixture.supabase.co',publishableKey:'public'},sb={auth:{getSession:async()=>({data:{session:{user:{id:jhUser?.id},access_token:'fixture'}}})}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),ic=()=>'<svg></svg>',bar=o=>'<header>'+esc(o.title)+'</header>',agErrorText=e=>e.message,agDate=s=>s;
const jpSavePrefs=()=>{},jpNormalize=x=>x,jpPayload=x=>x,dayISO=()=> '2098-01-01',openLogin=()=>{},toast=()=>{},jpDeckBacks=()=>'<div class="jp-deck">',jpChoiceMotion=()=>{};
let doLogin=async()=>{},signOut=async()=>{},thFlushChoices=async()=>true;
const pdReviewHTML=()=>'<small class="fixture-review">A real supplied quote</small>';
function render(){const v=V[state.route]();document.querySelector('#app').innerHTML=(v.bar||'')+v.body+(v.foot||'');}
function go(route){state.route=route;render();}
`+fs.readFileSync(path.join(__dirname,'journey-planning.js'),'utf8').match(/^const jpDefaultPrompt=.*$/m)[0]+fs.readFileSync(path.join(__dirname,'place-discovery.js'),'utf8')+`
window.f={A,V,render,go,get ag(){return ag},get pd(){return pd},get state(){return state},setOwner(id){ag.owner=id;jhUser=id?{id}:null;render();},reset(places,opts={}){pd=pdFresh();Object.assign(pd,{mode:true,places,token:'signed-fixture',expires:Date.now()+3600000,...opts});state.route='ai-picks';render();}};
`);
const f=w.f,app=()=>w.document.querySelector('#app'),delay=()=>new Promise(r=>setTimeout(r,0));
const places=['a','b'].map(id=>({id,name:'Place '+id,reason:'Fits your interests',address:'Verified address',kind:'restaurant',source:'Amap',sourceURL:'https://amap.com/place/'+id,attributions:[],openingHours:[],photo:null}));
const plan={city:'Shanghai',date:'2099-01-01',days:1,summary:'A day out',notice:'Suggested',stops:[{...places[0],dayIndex:1,start:'09:00',end:'10:00'}]};
async function settle(body,status=200){for(let i=0;i<20&&!pending.length;i++)await delay();assert(pending.length,'real request is pending');pending.shift()(Response.json(body,{status}));await delay();}
function progress(label){const bar=app().querySelector('[role="progressbar"]');assert(bar,label);assert.equal(bar.getAttribute('aria-valuenow'),null,'provider has no numeric progress');assert.equal(bar.getAttribute('aria-valuetext'),'In progress');assert.equal(app().querySelector('[aria-busy="true"]')?.tagName,'SECTION');assert(!app().querySelector('.pd-working p,.pd-working small'),'working screen has no explanation copy');}
(async()=>{
  f.render();assert(!app().querySelector('[role="progressbar"]'));
  const search=f.A.jpRequirements();progress('search starts progress immediately');assert.equal(f.pd.phase,'search');
  await settle({places,token:'signed-fixture',expires:Date.now()+3600000});await search;
  assert.equal(calls[0].prompt,'A balanced trip with local food, culture and relaxed walks.','optional requirements receive a balanced server prompt');assert.equal(f.ag.prefs.prompt,'','default does not replace the user textarea');
  assert.equal(f.state.route,'ai-picks');assert.equal(f.pd.busy,false);assert.equal(f.pd.phase,null);assert(!app().querySelector('[role="progressbar"]'),'settled search stops progress');assert(app().querySelector('.jp-card-copy h1+.fixture-review'),'review hook is directly below title');
  f.A.jpPick('a','want');const partial=f.A.pdFinish();progress('planning from partial shortlist shows progress');assert.equal(f.pd.phase,'plan');assert(!app().querySelector('.jp-swipe-card,[data-act="pdReset"],[data-act="pdFinish"]'),'busy planning replaces idle controls');
  await delay();const before=calls.length;await f.A.pdFinish();assert.equal(calls.length,before,'busy planning cannot duplicate requests');await settle({plan});await partial;assert.equal(f.state.route,'place-plan');assert(!app().querySelector('[role="progressbar"]'));assert.deepEqual(JSON.parse(JSON.stringify(f.pd.plan)),plan);
  f.reset(places,{wanted:['a','b']});assert(app().querySelector('[data-act="pdReset"]'));assert(!app().querySelector('[role="progressbar"]'),'idle completed shortlist has no generation bar');
  const failure=f.A.pdFinish();progress('planning after all cards shows progress');await settle({error:{message:'Temporary provider error'}},503);await failure;assert.equal(f.pd.busy,false);assert.equal(f.pd.phase,null);assert(!app().querySelector('[role="progressbar"]'));assert(app().querySelector('[role="alert"]')?.textContent.includes('Temporary provider error'));assert.equal(f.pd.wanted.length,2,'retry retains choices');assert(!app().querySelector('[data-act="pdFinish"]').disabled);
  const retry=f.A.pdFinish();progress('retry restarts progress');await settle({plan:{...plan,stops:[...plan.stops,{...places[1],dayIndex:1,start:'10:30',end:'11:30'}]}});await retry;assert.equal(f.pd.error,'');
  f.reset(places,{sample:true});const samples=calls.length;await f.A.pdFinish();assert.equal(calls.length,samples);assert(!app().querySelector('[role="progressbar"]'),'read-only sample never generates');
  f.reset(places,{expires:0});await f.A.pdFinish();assert.equal(f.state.route,'place-search');assert(!app().querySelector('[role="progressbar"]'),'expired selection is an error, not progress');
  f.reset(places);const stale=f.A.pdFinish();await delay();f.setOwner('bob');await settle({plan});await stale;assert.equal(f.pd.owner,'bob');assert.equal(f.pd.plan,null);assert.equal(f.pd.busy,false);assert(!app().querySelector('[role="progressbar"]'),'stale account response cannot restore prior progress/results');
  console.log('PASS: both actual generation phases, pending-only indeterminate progress, partial/completed shortlists, success/error/retry, duplicate guards, samples, expiry, review hook and owner isolation. All requests mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>w.close());
