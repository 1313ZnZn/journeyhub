/* Real preference/editor source with a mocked authenticated revision service. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),{webcrypto}=require('node:crypto');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8'),copy=value=>JSON.parse(JSON.stringify(value));
const dom=new JSDOM('<div id="app"></div>',{url:'https://journey.test/',runScripts:'outside-only'}),w=dom.window;Object.defineProperty(w,'crypto',{value:webcrypto});
const places=['a','b','c','d'].map(id=>({id,name:'Place '+id,kind:'museum',lat:31,lng:121}));
const input={city:'Shanghai',date:'2027-01-03',days:2,guests:2,prompt:'Gardens',dayStart:'09:00',dayEnd:'18:00',transport:'walk',budgetCurrency:'USD',budgetAmount:100,budgetScope:'group'};
const plan={...input,stops:places.slice(0,3).map((p,i)=>({...p,dayIndex:i===2?2:1,start:'09:00',end:'10:00'}))};
const posts=[],bookings=[{id:'unchanged-booking',place:'a',status:'confirmed'}];let hook=null;
w.rpc=async payload=>{posts.push(copy(payload));if(hook)return hook(payload);if(payload.action==='discover_revise')return {revisionToken:'signed-preview',plan:{...plan,guests:payload.input.guests,stops:payload.stops.map((s,i)=>({...places.find(p=>p.id===s.id),...s,start:i?'11:00':'09:00',end:i?'12:00':'10:00'})),estimate:{currency:'CNY',totalMinor:24000,items:payload.stops.map(s=>({stopId:s.id,totalMinor:8000}))}}};throw Error('Unexpected request '+payload.action);};
const setup=`
const A={agPrompt(){}},CHANGES={agDate(){},agGuests(){}},INPUTS={agPrompt(){}},TAB_OF={},EXPS={},V={'place-plan':()=>({body:'<div class="tu-title"><button class="tu-edit"></button></div><article class="pd-stop"></article>'})};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),ic=()=>'',agDate=s=>s,bar=()=>'',toast=()=>{},agErrorText=e=>e.message;
let state={route:'journey'},scrollTop=false,jhUser={id:'owner-a'},ag={owner:'owner-a',prefs:${JSON.stringify(input)},error:''};
const agPrefsDefault=()=>({...${JSON.stringify(input)},prompt:'',preferredExperienceIds:[],excludedExperienceIds:[]});
function render(){const view=V[state.route]?.();document.querySelector('#app').innerHTML=view?.body||'';}
function go(route){state.route=route;render();}
let pd={owner:'owner-a',historyId:'history-one',input:${JSON.stringify(input)},plan:${JSON.stringify(plan)},places:${JSON.stringify(places)},wanted:['a','b','c'],skipped:[],day:'all'};
let cal={owner:'owner-a',details:{'history-one':{plan:${JSON.stringify(plan)}}}},tc={owner:'owner-a',loadVersion:1,loaded:true,loading:false,trips:[{sourceType:'history',sourceId:'history-one',stops:${JSON.stringify(plan.stops)}}]},dw={owner:'owner-a',quotes:{'history:history-one':{quote:{id:'old-price'}}}},careLoads=0,historyLoads=0;
const tcLoad=async()=>{careLoads++;},thReloadAfterRevision=()=>{historyLoads++;};
const pdCurrent=ctx=>pd===ctx&&ctx.owner===ag.owner&&ctx.owner===jhUser?.id,pdRequest=payload=>window.rpc(payload);
let saves=0;const thSavedResult=(ctx,result)=>{saves++;ctx.historyId=result.historyId;};
`;
const destination=read('destinations-ui.js').split('const jhOriginalExpCard=')[0],planning=read('journey-planning.js');
const preferences=planning.slice(0,planning.indexOf('function jpPrefsFromRun('));
const budgetHTML=planning.slice(planning.indexOf('function jpBudgetHTML('),planning.indexOf('function jpPreferencesBaseHTML('));
w.eval(setup+destination+preferences+budgetHTML+read('planning-editor.js')+`
window.fixture={A,CHANGES,INPUTS,jpNormalize,jpPayload,jpLoadPrefs,jpSavePrefs,jpBudgetHTML,go,render,get scrollTop(){return scrollTop},resetScroll(){scrollTop=false},get city(){return jhCity},get ag(){return ag},get pd(){return pd},get pe(){return pe},get saves(){return saves},get caches(){return {cal,tc,dw,careLoads,historyLoads}},get state(){return state},newOwner(){jhUser={id:'owner-b'};ag.owner='owner-b';pd={...pd,owner:'owner-b'};}};
`);
const t=w.fixture,app=()=>w.document.querySelector('#app');
(async()=>{
 t.ag.prefs=t.jpNormalize(input);t.A.destination('Singapore');assert.equal(t.city,'Singapore');assert.equal(t.ag.prefs.city,'Singapore');t.CHANGES.agCity({value:'Shanghai'});assert.equal(t.city,'Shanghai');
 t.INPUTS.jpBudget('321.50');t.CHANGES.jpBudgetCurrency({value:'SGD'});t.CHANGES.jpBudgetScope({value:'person'});
 const payload=t.jpPayload(t.ag.prefs);assert.equal(payload.budgetAmount,321.5);assert.equal(payload.budgetCurrency,'SGD');assert.equal(payload.budgetScope,'person');assert(!('budgetCnyMinor'in payload),'browser does not invent canonical converted budgets');
 const restored={owner:'owner-a'};t.jpLoadPrefs(restored);assert.equal(restored.prefs.budgetAmount,321.5);assert.equal(restored.prefs.budgetScope,'person');assert.equal(t.city,restored.prefs.city);
 t.INPUTS.jpBudget('-1');assert.equal(t.jpPayload(t.ag.prefs),null);t.INPUTS.jpBudget('');assert.equal(t.jpPayload(t.ag.prefs).budgetAmount,null);assert(t.jpBudgetHTML(t.ag.prefs).includes('Whole trip · per person'));
 t.A.peStart();assert.equal(t.state.route,'plan-editor');assert.equal(app().querySelectorAll('.pe-stop').length,3);const original=JSON.stringify(t.pd.plan);
 const preferences=app().querySelector('.pe-preferences');preferences.open=true;preferences.dispatchEvent(new w.Event('toggle'));t.render();assert(app().querySelector('.pe-preferences').open,'background rendering preserves expanded preferences');assert.equal(t.pe.preferencesOpen,true);const detached=preferences;detached.open=false;detached.dispatchEvent(new w.Event('toggle'));t.render();assert(app().querySelector('.pe-preferences').open,'detached old details cannot erase the current open state');
 t.A.peRemove('a');assert.equal(t.pe.stops.length,2);t.A.peRemove('b');assert.equal(t.pe.stops.length,2,'last place on a day cannot be removed');
 t.CHANGES.peReplace({dataset:{stop:'b'},value:'d'});assert.equal(t.pe.stops[0].id,'d');t.CHANGES.peReplace({dataset:{stop:'d'},value:'c'});assert.equal(t.pe.stops[0].id,'d','duplicate replacement blocked');t.CHANGES.peReplace({dataset:{stop:'d'},value:'forged'});assert.equal(t.pe.stops[0].id,'d','unknown replacement blocked');
 t.CHANGES.peOption({dataset:{key:'guests'},value:'3'});t.INPUTS.peBudget('120');t.CHANGES.peOption({dataset:{key:'budgetCurrency'},value:'USD'});
 t.resetScroll();await t.A.pePreview();assert.equal(t.scrollTop,true,'review opens at the cost and summary');assert.equal(posts.length,1);assert.equal(posts[0].action,'discover_revise');assert.deepEqual(posts[0].stops,[{id:'d',dayIndex:1},{id:'c',dayIndex:2}]);assert.equal(posts[0].input.guests,3);assert.equal(posts[0].input.budgetAmount,120);assert(!JSON.stringify(posts[0]).includes('lat'),'only IDs sent for stop edits');assert.equal(JSON.stringify(t.pd.plan),original,'preview does not mutate saved itinerary');assert(app().textContent.includes('CNY 240.00'));assert(app().textContent.includes('11:00–12:00'));
 const revised=copy(t.pe.preview);let fail=true;hook=async payload=>{assert.equal(payload.action,'discover_revise_apply');if(fail){fail=false;throw Error('Connection lost. Retry.');}return {historyId:'history-one',plan:revised,input:{...input,guests:3,budgetAmount:120}};};
 await t.A.peApply();assert.equal(JSON.stringify(t.pd.plan),original);assert(t.pe.error.includes('Connection lost'));const applyId=posts.at(-1).requestId;await t.A.peApply();assert.equal(posts.at(-1).requestId,applyId,'ambiguous apply retries retain idempotency key');assert.equal(t.pd.historyId,'history-one');assert.equal(t.pd.plan.guests,3);assert.equal(t.saves,1);assert.equal(t.state.route,'place-plan');assert.deepEqual(bookings,[{id:'unchanged-booking',place:'a',status:'confirmed'}]);assert(posts.every(p=>['discover_revise','discover_revise_apply'].includes(p.action)),'editor cannot submit booking or cancellation calls');
 assert.equal(t.caches.cal.details['history-one'].plan.stops[0].id,'d','calendar cannot prefer a stale cached plan');assert.equal(t.caches.tc.trips.length,0,'old care schedule retired before rendering');assert.equal(t.caches.dw.quotes['history:history-one'],undefined,'old estimate cannot be confirmed after edit');assert.equal(t.caches.careLoads,1);assert.equal(t.caches.historyLoads,1);
 hook=null;t.A.peStart();await t.A.pePreview();hook=async()=>{const error=Error('Expired');error.code='SEARCH_EXPIRED';throw error;};await t.A.peApply();assert.equal(t.pe.preview,null);assert(app().querySelector('[data-act="pePreview"]'),'expired approval returns to preview with selections intact');assert.equal(t.pe.stops[0].id,'d');
 t.A.peStart();let release;hook=()=>new Promise(resolve=>release=resolve);const pending=t.A.pePreview();t.newOwner();release({revisionToken:'late',plan:revised});await pending;assert(!t.pe.preview,'late response cannot enter another account');assert.equal(t.saves,1);
 w.close();console.log('PASS: shared destination, account preference persistence, raw whole-trip budget validation, safe replace/remove, empty-day/duplicate guards, preview-before-apply, preserved reservations, idempotent retry and late-account isolation. No network.');
})().catch(error=>{w.close();console.error(error);process.exitCode=1;});
