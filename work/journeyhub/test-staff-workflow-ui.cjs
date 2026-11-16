/* Production bundle, mocked transport. Database assertions live in the separate SQL test. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'outputs/JourneyHub-Supabase');
const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
const future=new Date(Date.now()+7*86400000).toISOString().slice(0,10),old='2020-01-01';
const settings={currency:'THB',duration:150,timeZone:'Asia/Bangkok',price:1400,maxCapacity:40,capacitySource:'Existing session ceiling; manager must verify',hostRate:.5,materialCost:250,history:{source:'Historical sample: September 2026',bookingRate:.917,cancellationRate:.091,attendanceRate:.92}};
const assumptions={bookingRate:.8,cancellationRate:.1,attendanceRate:.95,hostRate:.5,materialCost:100,basis:'TEST independent assumptions'};
const data={staff:{id:'TM-1002',name:'TEST Duty Manager',role:'duty_manager'},staffWorkflowVersion:1,profile:null,personal:{},stores:[{store_id:'test-store',name:'TEST Store'}],products:[{product_id:'test-product',store_id:'test-store',name:'TEST Product',price_thb:100,categories:[]}],inventory:[],orders:[],bookings:[],metrics:[],liveMetrics:[],venues:[{venue_id:'test',name:'TEST Venue',city:'Bangkok',time_zone:'Asia/Bangkok'}],experiences:['craft','food','culture'].map((id,i)=>({experience_id:id,name:['Thai Craft Lab','Old Town Food Walk','Museum Culture Visit'][i],kind:['Workshop','Food','Culture'][i],price_thb:[1400,900,450][i],duration_min:[150,120,90][i],venue_id:'test',details:{}})),sessions:[{session_id:'TEST-SESSION',experience_id:'craft',starts_at:future+'T03:00:00Z',ends_at:future+'T05:30:00Z',capacity:30,seats_taken:0,seats_held_other_channels:0,price_thb:1400,status:'open'}],planningSettings:{craft:settings,food:{...settings,price:900,duration:120,history:null,materialCost:null},culture:{...settings,price:450,duration:90,history:null,materialCost:null}},sessionPlans:[]};
function plan(id,exp,status='submitted',date=future){return {plan_id:id,experience_id:exp,session_date:date,start_time:'10:00',capacity:20,price_thb:1400,promo_budget_thb:0,reason:'TEST independent workflow verification',status,created_by:'TC-1001',submitted_by:'TC-1001',submittedName:'TEST Coordinator',submitted_at:new Date().toISOString(),created_at:new Date().toISOString(),version:1,events:[],assumptions,startsAt:date+'T03:00:00Z'};}
data.sessionPlans=[plan('PLAN-TEST0001','craft'),plan('PLAN-TEST0002','food','withdrawn'),plan('PLAN-TEST0003','culture','draft'),plan('PLAN-EXPIRED0','craft','submitted',old)];data.sessionPlans[1].return_reason='Please review the materials assumption.';
const boot=`
window.STAFF_TEST={A,V,guest(){jhUser=null;state.auth.staff=null;},get state(){return state},get sf(){return sf},get db(){return DBC},get user(){return jhUser},set staff(v){state.auth.staff=v},pending:swPending,status:swStatus,projection:sfProjection,validate:sfValidate,restore:snRestoreWorkspace,remember:snRememberWorkspace,select:sfSelect,plan:sfPlan,go,render,apply:jhApply,change:sfChange,flush:sfFlush,roles(user,employee){jhUser={id:user};state.auth.staff=employee;sfScope();}};
jhUser={id:'test-manager'};jhPersonalReady=true;jhLoading=false;state.role='staff';state.route='s-approvals';state.params={};
jhApply(window.STAFF_FIXTURE);jhRefresh=async()=>{jhApply(window.STAFF_FIXTURE);};
saLoad=async()=>{};state.guestOk=true;render();
`;
let code=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean).join('\n').replace('jhStart();',boot);
const vc=new VirtualConsole(),errors=[];vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
const dom=new JSDOM(html,{url:'http://localhost:4178/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
const queue=w.queueMicrotask.bind(w);w.queueMicrotask=fn=>queue(()=>{if(w.document)fn();});
w.matchMedia=query=>({get matches(){return !!w.testWide&&query.includes('min-width');},addEventListener(){},removeEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
w.fetch=async()=>Response.json({});Object.assign(w,{TextEncoder,TextDecoder,Headers,Request,Response,AbortController});
w.eval(fs.readFileSync(path.join(out,'vendor/supabase.js'),'utf8'));w.JOURNEYHUB_CONFIG={url:'https://test.supabase.co',publishableKey:'sb_publishable_test_fixture'};w.STAFF_FIXTURE=data;
(async()=>{try{
 w.eval(code);const t=w.STAFF_TEST;assert.equal(t.pending().length,1,'expired plan excluded from actionable count');
 assert.match(w.document.querySelector('#app').textContent,/1 actionable approvals/);assert(!w.document.querySelector('#app').textContent.includes('PLAN-EXPIRED0'));
 t.A.swFilterStatus('all');assert.match(w.document.querySelector('#app').textContent,/Needs rescheduling/);
 // sfBeforeLeave completes asynchronously; directly position the record for synchronous rendering checks.
 t.select('PLAN-TEST0001');t.go('s-plan',{id:'PLAN-TEST0001'});assert(w.document.querySelector('[data-act="splanApprove"]'));assert.match(w.document.querySelector('#app').textContent,/Thai Craft Lab/);
 t.remember();t.state.params={id:'wrong'};t.restore();assert.equal(t.state.params.id,'PLAN-TEST0001');
 t.go('s-plan',{id:'missing'});assert.match(w.document.querySelector('#app').textContent,/does not exist/);assert.equal(t.plan(),null,'no first-record fallback');
 t.go('s-session',{id:'missing'});assert.match(w.document.querySelector('#app').textContent,/missing or unavailable/);
 t.roles('host-user',{id:'TH-1003',name:'TEST Host',role:'host'});t.go('s-insights');assert.equal(t.state.route,'s-insights');assert.match(w.document.querySelector('#app').textContent,/Host insights/);t.go('s-plan',{exp:'food'});assert(w.document.querySelector('[data-ch="swActivity"]'));assert.equal(w.document.querySelector('[data-ch="swActivity"]').value,'food');
 t.roles('coordinator-user',{id:'TC-1001',name:'TEST Coordinator',role:'coordinator'});t.select('PLAN-TEST0003');t.go('s-plan',{id:'PLAN-TEST0003'});assert(w.document.querySelector('[data-act="splanSubmit"]'));assert(!w.document.querySelector('[data-act="splanApprove"]'));assert.match(w.document.querySelector('#app').textContent,/No historical sample/);
 assert.equal(t.projection({cap:10,price:100,promo:0,assumptions:{}}),null,'unknown costs never zero');
 const p=t.plan();assert.equal(t.validate({...p,date:old}), 'Choose a valid date within the next year.');
 t.go('s-approvals');t.state.swFilter={status:'all',exp:'culture',date:future,submitter:'TC-1001'};t.remember();t.state.swFilter={};t.restore();assert.equal(t.state.swFilter.exp,'culture');
 w.testWide=true;t.guest();t.state.role='traveler';t.go('journey');
 assert(w.document.body.classList.contains('pip-center'),'Guest uses the same centred Pip home');
 assert(w.document.querySelector('.jl-home.is-pip'),'Old two-column form is adapted for guests');
 const guestInput=w.document.querySelector('[data-pip-input]');assert(guestInput);guestInput.value='Shanghai museums';
 guestInput.form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(t.state.route,'login','Guest submission still requires authentication');
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS production-bundle approvals, real count semantics, missing-ID handling, record/filter restoration, Host routing, activity selection, submitter permissions and unknown-cost forecast. Transport mocked.');
 // A local, visibly labeled fixture for manual browser screenshots; never part of deployment.
 const fixtureDir=path.join(root,'outputs/staff-workflow');fs.mkdirSync(fixtureDir,{recursive:true});
 let page=html.replace(/<script src="\.\/config.js"><\/script>/,'<script>window.JOURNEYHUB_CONFIG={url:"https://test.supabase.co",publishableKey:"sb_publishable_test_fixture"};window.STAFF_FIXTURE='+JSON.stringify(data).replaceAll('<','\\u003c')+';</script>');
 page=page.replace('jhStart();',boot).replace('saLoad=async()=>{};','saLoad=async()=>{};fetch=async()=>new Response("{}",{headers:{"content-type":"application/json"}});');
 page=page.replace('<title>Journey Hub · Online</title>','<title>TEST ONLY · Staff workflow</title>');
 fs.writeFileSync(path.join(fixtureDir,'staff-fixture.html'),page);fs.cpSync(path.join(out,'vendor'),path.join(fixtureDir,'vendor'),{recursive:true});
 await new Promise(r=>setTimeout(r,100));
}finally{w.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
