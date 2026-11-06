/* Selected-day calendar hydration: real calendar source, isolated transport. */
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
 const dom=new JSDOM('<main id="app"></main>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window;
 Object.assign(w,{AbortController,Response});const calls=[];let handler;
 w.fetch=async(url,init)=>{const body=JSON.parse(init.body);calls.push({...body,authorization:init.headers.Authorization});return handler(body);};
 w.eval(`
 const A={},V={orders:()=>({body:''})},TAB_OF={},DBC={bookings:{},sessions:{}},EXPS={};
 let jhUser={id:'alice'},ag={owner:'alice',runs:[],loading:false,error:''},pd={owner:'alice',historyId:null,plan:null};
 let th={owner:'alice',items:[],loaded:true,loading:false,error:'',cursor:null},tc={owner:'alice',trips:[]},cm={owner:'alice',loaded:true,loading:false,error:''};
 let state={route:'orders',params:{},plan:{savedStops:[]}};
 const jhConfig={url:'https://fixture.invalid',publishableKey:'fixture-public'},sb={auth:{getSession:async()=>({data:{session:jhUser?{user:jhUser,access_token:jhUser.id+'-fixture-token'}:null}})}};
 const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),ic=()=>'',bar=x=>x;
 const traveler=()=>jhUser,myBookings=()=>Object.values(DBC.bookings),myOrders=()=>[],isMine=()=>true,agPlan=r=>r?.plan,tcName=s=>s.name,agTime=()=>'',agErrorText=e=>e.message;
 const cmHidden=()=>false,cmActionButton=(kind,id)=>'<button data-act="cmAsk" data-a="'+kind+'" data-b="'+id+'">Delete plan</button>',thScope=()=>{},tcScope=()=>{},thLoad=async()=>{},agLoadRuns=async()=>{},jhRefresh=async()=>{};
 const thHydrate=async id=>{const {data}=await sb.auth.getSession();if(!data.session)throw Error('Please sign in again.');const response=await fetch(jhConfig.url+'/functions/v1/journeyhub-agent',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({action:'history_open',id})});const body=await response.json();if(!response.ok)throw Error(body?.error?.message||'Could not load');return body;};
 const go=route=>{state.route=route;render()},openLogin=()=>{};
 let render=()=>{if(state.route!=='orders')return;const view=V.orders();document.querySelector('#app').innerHTML=view.body;view.after?.();};
 `+fs.readFileSync(__dirname+'/calendar-ui.js','utf8')+`
 window.inline={A,render,go,DBC,get cal(){return cal},get pd(){return pd},get th(){return th},get ag(){return ag},get state(){return state},events:calEvents,seed(rows){th.items=rows},switchOwner(id){jhUser=id?{id}:null;ag.owner=id;th.owner=id;th.items=[];tc.owner=id;tc.trips=[];cm.owner=id;render();}};
 `);
 const t=w.inline,app=()=>w.document.querySelector('#app');
 const input={city:'Shanghai',date:'2026-12-01',days:2},row=(id,date='2026-11-01T00:00:00Z')=>({id,status:'itinerary',input,createdAt:date});
 const plan={...input,stops:[{id:'a',name:'Shanghai History Museum',address:'325 Nanjing West Road',dayIndex:1,start:'09:00',end:'10:30',reason:'City history'},{id:'b',name:'Italian Restaurant',address:'3 Zhongshan East Road',dayIndex:1,start:'12:00',end:'13:00'},{id:'c',name:'Yu Garden',address:'Anren Street',dayIndex:2,start:'10:00',end:'11:30'}]};
 handler=async body=>Response.json({historyId:body.id,plan});
 t.seed([row('latest','2026-11-04T00:00:00Z'),row('older')]);t.A.calDate('2026-11-30');await tick();assert.equal(calls.length,0,'month markers alone never hydrate all plans');
 const beforePD=JSON.stringify(t.pd);t.A.calDate('2026-12-01');assert(app().textContent.includes('Loading your day'));await tick();await tick();
 assert.equal(calls.length,1);assert.equal(calls[0].id,'latest');assert.equal(calls[0].action,'history_open');assert.equal(calls[0].authorization,'Bearer alice-fixture-token');
 assert.equal(app().querySelectorAll('.cal-day-plan').length,1);assert.equal(app().querySelectorAll('.cal-schedule-stop').length,2);assert(app().textContent.includes('09:00–10:30'));assert(app().textContent.includes('325 Nanjing West Road'));assert(!app().textContent.includes('View day'));assert(app().textContent.includes('Delete plan'));
 assert.equal(t.th.items.length,2,'old histories are retained');assert.equal(JSON.stringify(t.pd),beforePD,'inline reading does not replace the active planner');assert.equal(t.state.route,'orders');
 t.A.calDate('2026-12-02');await tick();assert.equal(calls.length,1,'same itinerary details reused across days');assert.equal(app().querySelectorAll('.cal-schedule-stop').length,1);assert(app().textContent.includes('Yu Garden'));assert(!app().textContent.includes('Italian Restaurant'));
 for(let i=0;i<4;i++)t.render();await tick();assert.equal(calls.length,1,'rerenders do not repeatedly load places');
 // Booking failure does not erase its valid itinerary; no-plan failures have no day.
 t.ag.runs.push({id:'failed-newer',status:'failed',createdAt:'2026-11-05T00:00:00Z',plan});assert(t.events().some(e=>e.id==='failed-newer'));t.ag.runs.pop();
 t.ag.runs.push({id:'failed-empty',status:'failed',createdAt:'2026-11-05T00:00:00Z'});assert(!t.events().some(e=>e.id==='failed-empty'));
 t.DBC.sessions.s1={date:'2026-12-01',start:'09:00'};t.DBC.bookings.b1={id:'b1',slot:'s1',guests:1,status:'confirmed'};
 t.ag.runs.push({id:'booked-newer',status:'booked',createdAt:'2026-11-05T00:00:00Z',plan:{...input,days:1,stops:[{...plan.stops[0],sessionId:'s1'}]}});
 const bookedDay=t.events().filter(e=>e.date==='2026-12-01'&&e.kind==='plan');assert.equal(bookedDay.length,1,'one current schedule remains after booking');assert.equal(bookedDay[0].id,'booked-newer','booking never exposes the older overlapping plan');assert.equal(bookedDay[0].stops[0].sessionId,'s1','reserved visit remains in its plan');assert(!t.events().some(e=>e.id==='b1'),'embedded reservation is not repeated as a separate card');assert.equal(t.th.items.length,2,'superseded histories stay saved');t.ag.runs.pop();delete t.DBC.sessions.s1;delete t.DBC.bookings.b1;
 t.seed([row('error-trip')]);handler=async()=>Response.json({error:{message:'Place provider unavailable'}},{status:503});t.A.calDate('2026-12-01');await tick();await tick();assert(app().textContent.includes('Place provider unavailable'));const n=calls.length;for(let i=0;i<3;i++)t.render();await tick();assert.equal(calls.length,n,'failure requires explicit retry');
 handler=async body=>Response.json({historyId:body.id,plan});t.A.calRetryDay('error-trip');await tick();await tick();assert(app().textContent.includes('Shanghai History Museum'));assert.equal(calls.length,n+1);
 // A result arriving after account change must not enter the new account cache.
 let release;t.seed([row('held-trip')]);handler=()=>new Promise(r=>release=r);t.A.calDate('2026-12-01');await tick();t.switchOwner('bob');release(Response.json({historyId:'held-trip',plan}));await tick();await tick();assert.equal(t.cal.owner,'bob');assert.deepEqual(Object.keys(t.cal.details),[]);assert(!app().textContent.includes('Shanghai History Museum'));
 t.switchOwner(null);assert(app().textContent.includes('Sign in to see'));
 dom.window.close();console.log('PASS: inline daily activities/times/addresses, latest one-plan selection, booked winner dedup, no month-wide fetch, per-plan cache, explicit retry, planner isolation and stale-account protection. All transport mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
