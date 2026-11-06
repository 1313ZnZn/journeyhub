/* Conflict responses run through the built app; no remote calls. */
const assert=require('node:assert/strict');
const {boot,until,windows}=require('./test-calendar-ui.cjs');
(async()=>{
  const h=await boot(),{t,w}=h,baseFetch=w.fetch;
  const message='You already have a plan for 2026-12-31. Open Calendar, or delete the existing plan before creating another.';
  const conflicts=[];
  w.fetch=async(url,init={})=>{const p=init.body?JSON.parse(init.body):{};if(['plan','discover_plan'].includes(p.action)){conflicts.push(p);return Response.json({error:{code:'PLAN_DATE_CONFLICT',message}},{status:409});}return baseFetch(url,init);};
  const places=Array.from({length:2},(_,i)=>({id:'test_'+i,name:'Fixture place '+i,openingHours:[],attributions:[],sourceURL:'',kind:'park'}));
  Object.assign(t.pd,{owner:t.ag.owner,mode:true,sample:false,busy:false,input:{city:'Shanghai',date:'2026-12-31',days:2},places,wanted:places.map(p=>p.id),skipped:[],token:'fixture-token',expires:Date.now()+3600000,historyId:null,plan:null});
  h.visit('ai-picks');await t.A.pdFinish();
  assert.equal(conflicts.length,1);assert.equal(t.pd.plan,null);assert.equal(t.state.route,'ai-picks');
  assert.match(h.app().textContent,/already have a plan/);
  h.click('agOpenCalendar');assert.equal(t.state.route,'orders');assert.equal(t.cal.date,'2026-12-31');
  await until(()=>t.th.loaded&&!t.th.loading,'calendar settled');
  Object.assign(t.ag.prefs,{city:'Shanghai',date:'2026-12-31',days:2,prompt:'Food and gardens'});
  h.visit('ai');await t.A.agGenerate();
  assert.equal(conflicts.length,2);assert.equal(w.sessionStorage.getItem('journeyhub-agent-pending-'+t.ag.owner),null,'known date rejection clears request key');
  assert.match(t.ag.error,/already have a plan/);assert(h.app().querySelector('[data-act="agOpenCalendar"]'));
  assert.equal(h.commands.filter(c=>!['personal','profile'].includes(c.p_operation)).length,0,'no booking or mail effects');
  assert.deepEqual(h.errors,[]);h.close();
  console.log('PASS: discovery and catalog date-conflict errors, no second plan rendered, Calendar CTA selects conflict date, request cleanup. All calls mocked.');
})().catch(e=>{windows.forEach(w=>w.close());console.error(e);process.exitCode=1;});
