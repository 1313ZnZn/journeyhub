/* Staff assistant UI behavior using real implementation and deterministic RPC doubles. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/staff-agent.js','utf8');
const clone=v=>JSON.parse(JSON.stringify(v));
const baseTask={id:'task-1',kind:'opportunity',status:'suggested',title:'Next session opportunity',summary:'Review a future session using historical and live evidence.',checkedAt:new Date().toISOString(),planId:null,sessionId:null,events:[],
 evidence:{historical:[{name:'Thai Craft Lab',seats_filled_pct:91.7,contribution_margin_pct:32.6}],live:{confirmed:18,capacity:20,sessions:1}},
 proposal:{exp:'craft',date:'2026-12-10',startTime:'10:00',cap:30,price:1400,promo:0,scenarios:[{cap:30,price:1400,promo:0,forecast:{con:11750}}]}};
let staff={id:'STAFF-A',role:'coordinator'},user={id:'user-a'},tasks=[clone(baseTask)],hold=null,fail=false,calls=[],plans=0,renders=0,refresh=0;
const ctx={console,Date,Intl,DBC:{sessionPlans:{}},EXPS:{craft:{timeZone:"Asia/Bangkok"}},sfDateAtZone:zone=>new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()),setInterval:()=>1,clearInterval:()=>{},jhUser:user,me:()=>staff,state:{role:'staff',route:'s-today'},ui:{},TAB_OF:{},snRoutes:new Set(),
 A:{splanSubmit:async()=>{tasks[0].status='approval';},splanApprove:async()=>{tasks[0].status='tracking';},splanWithdraw:async()=>{tasks[0].status='draft';}},
 V:Object.fromEntries(['s-today','s-insights','s-session','s-plan'].map(k=>[k,()=>({bar:'',body:'<div class="content"><p>Existing UI</p></div>'})])),
 sb:{rpc:async(name,args)=>{calls.push({name,...args});assert.equal(name,'journeyhub_staff_agent');if(hold)return hold;if(fail)return {error:{message:'Temporary connection failure'}};
  if(args.p_action==='prepare'){if(!tasks[0].planId){plans++;tasks[0].planId='PLAN-AGENT';tasks[0].status='draft';}return {data:{tasks:clone(tasks),planId:'PLAN-AGENT',checkedAt:new Date().toISOString()}};}
  if(args.p_action==='acknowledge')tasks[0].acknowledgedUntil=new Date(Date.now()+86400000).toISOString();
  return {data:{tasks:clone(tasks),checkedAt:new Date().toISOString()}};}},
 jhError:e=>e.message||String(e),render:()=>{renders++;},jhApply:()=>{},jhRefresh:async()=>{refresh++;},jhInvalidateSnapshot:()=>{},
 esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),ic:(name)=>'<svg data-icon="'+name+'"></svg>',badge:(label)=>'<span>'+label+'</span>',staffBar:title=>title,
 sfBeforeLeave:async()=>true,sfSelect:id=>{ctx.selected=id;},sfPlan:()=>({id:ctx.selected}),go:(route,params)=>{ctx.state.route=route;ctx.state.params=params;},toast:text=>{ctx.lastToast=text;},document:{visibilityState:'visible'}};
vm.createContext(ctx);vm.runInContext(source+'\n globalThis.TEST={get state(){return sa},load:saLoad,scope:saScope,compact:saCompact,evidence:saEvidence};',ctx);
(async()=>{
 await ctx.TEST.load();assert.equal(calls.length,1);await ctx.TEST.load();assert.equal(calls.length,1,'reads reuse 30-second account-scoped cache');
 assert.match(ctx.V['s-today']().body,/Staff assistant/);assert.match(ctx.V['s-today']().body,/Existing UI/,'existing workspace retained');
 let html=ctx.V['s-assistant']().body;assert.match(html,/Prepare editable draft/);assert.match(html,/Historical sample/);assert.match(html,/LIVE/);assert.match(html,/Forecast scenarios/);
 assert(!html.includes('undefined'));assert.equal(ctx.TAB_OF['s-assistant'],'s-today');
 await ctx.A.saPrepare('task-1');assert.equal(plans,1);assert.equal(refresh,1);assert.equal(ctx.selected,'PLAN-AGENT');assert.equal(ctx.state.route,'s-plan');assert.match(ctx.V['s-plan']().body,/Assistant is following/);
 await ctx.A.saPrepare('task-1');assert.equal(plans,1,'repeat action navigates to same saved draft');
 await ctx.A.splanSubmit();assert.equal(ctx.TEST.state.tasks[0].status,'approval','submission immediately reconciles assistant state');
 tasks[0].evidence.outcome={confirmed:2,cancelled:1,checkedIn:0,cap:30,bookedValueThb:2800,forecast:{con:11750},bookings:[{id:'B-SAVED',status:'confirmed',guests:2}]};
 await ctx.A.splanApprove();html=ctx.V['s-assistant']().body;assert.match(html,/Published · tracking/);assert.match(html,/Reservation value/);assert.match(html,/Forecast contribution/);assert.match(html,/data-a="B-SAVED"/,'canonical reservation record available');
 fail=true;await ctx.A.saRefresh();html=ctx.V['s-assistant']().body;assert.match(html,/Temporary connection failure/);assert.match(html,/data-act="saRefresh"/);assert.equal(ctx.TEST.state.tasks[0].planId,'PLAN-AGENT','failed refresh preserves last saved task');fail=false;
 let release;hold=new Promise(resolve=>release=resolve);const pending=ctx.A.saRefresh();ctx.jhUser={id:'user-b'};staff={id:'STAFF-B',role:'host'};ctx.TEST.scope();release({data:{tasks:clone(tasks),checkedAt:new Date().toISOString()}});await pending;hold=null;
 assert.equal(ctx.TEST.state.tasks.length,0,'stale account response cannot leak old finance tasks');
 tasks=[];await ctx.A.saRefresh();assert.match(ctx.V['s-session']().body,/Staff assistant/,'host sees operational entry');const count=calls.length;await ctx.A.saPrepare('task-1');assert.equal(calls.length,count,'host cannot prepare unauthorized task');
 ctx.jhUser={id:'user-c'};staff={id:'STAFF-C',role:'coordinator'};ctx.TEST.scope();tasks=[clone(baseTask),...Array.from({length:49},(_,i)=>({id:'session-'+i,kind:'session_attention',status:'attention',title:'Craft session '+i,summary:'Review low fill.',evidence:{reason:'low_fill',confirmed:2,cap:25},sessionId:'slot-'+i}))];await ctx.A.saRefresh();
 Object.assign(ctx.TEST.state,{counts:{opportunities:1,sessionChecks:115,tracking:0,acknowledged:0},totalCount:116,returnedCount:50});
 const {JSDOM}=require('jsdom'),doc=new JSDOM(ctx.V['s-assistant']().body).window.document;
 assert.equal(doc.querySelectorAll('.sa-page > .sa-task-preview').length,5,'only five concise task rows initially');
 assert.equal(doc.querySelectorAll('.sa-other-checks .sa-task-preview').length,45,'all other returned tasks remain accessible');assert(!doc.querySelector('.sa-other-checks').open,'other checks collapsed');
 assert.match(doc.body.textContent,/Other session checks \(45\)/);assert.match(doc.body.textContent,/Showing 50 of 116 saved checks/);assert.match(ctx.TEST.compact(),/1 opportunity · 115 session checks/,'compact totals are not truncated to returned page');
 ctx.TEST.state.open.add('session-8');ctx.TEST.state.moreOpen=true;await ctx.A.saRefresh();const refreshed=new JSDOM(ctx.V['s-assistant']().body).window.document;
 assert(refreshed.querySelector('[data-sa-task="session-8"]').open&&refreshed.querySelector('.sa-other-checks').open,'refresh retains expanded task and other-check group');
 tasks=[{...clone(baseTask),proposal:{...baseTask.proposal,date:'2020-01-01'}}];await ctx.A.saRefresh();assert(!ctx.V['s-assistant']().body.includes('Prepare editable draft'),'expired opportunity is not actionable');
 const guestCount=calls.length;ctx.jhUser=null;staff=null;ctx.TEST.scope();const guest=ctx.V['s-assistant']();assert.match(guest.body,/Staff sign in/);await ctx.TEST.load();assert.equal(calls.length,guestCount,'anonymous cannot call assistant RPC');
 console.log('PASS staff assistant UI: compact workspace, durable draft navigation, role/account isolation, immediate approval reconciliation, evidence separation, canonical records, retry and cache.');
})().catch(e=>{console.error(e);process.exitCode=1;});
