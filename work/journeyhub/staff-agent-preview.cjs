/* Isolated visual fixture: production staff views, in-memory task/approval simulation. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase');
require('./calendar-preview.cjs').make();
let html=fs.readFileSync(path.join(out,'fixture-calendar.html'),'utf8');
if(!html.includes('function saCompact('))throw Error('Build staff assistant first.');
const future=new Date(Date.now()+7*86400000).toISOString().slice(0,10),now=new Date().toISOString();
const forecast=cap=>{const booked=Math.round(cap*.917),paid=Math.round(booked*.909),att=Math.round(paid*.92),rec=paid*1400,pay=rec*.5,mat=att*250,con=rec-pay-mat;return{booked,paid,att,rec,pay,mat,con,margin:con/rec*100,diff:con-11750};};
const history=[{experience_id:'craft',name:'Thai Craft Lab',seats_filled_pct:91.7,contribution_margin_pct:32.6},{experience_id:'silk',name:'Silk Workshop',seats_filled_pct:80,contribution_margin_pct:26.4},{experience_id:'herbal',name:'Herbal Workshop',seats_filled_pct:72.5,contribution_margin_pct:22.1}];
const tasks=[{id:'qa-staff-opportunity',kind:'opportunity',status:'suggested',title:'Next session opportunity',summary:'Upcoming craft sessions are at least 80% booked. Review an extra capacity scenario.',checkedAt:now,
 evidence:{historical:history,live:{confirmed:18,capacity:20,sessions:1}},proposal:{exp:'craft',date:future,startTime:'10:00',cap:30,price:1400,promo:0,reason:'Review demand before publishing this illustrative session.',scenarios:[20,25,30].map(cap=>({cap,price:1400,promo:0,forecast:forecast(cap)})),forecast:forecast(30)},events:[]},
 {id:'qa-staff-watch',kind:'opportunity',status:'tracking',title:'Published session follow-up',summary:'Publication verified in the traveler catalogue. Live bookings and cancellations are being tracked.',checkedAt:now,planId:'PLAN-QA-PUBLISHED',sessionId:'qa-published',
 evidence:{historical:history,live:{confirmed:18,capacity:20,sessions:1},outcome:{confirmed:2,cancelled:1,checkedIn:0,cap:25,bookedValueThb:2800,published:true,forecast:forecast(25),bookings:[{id:'B-QA-NEW',guests:2,status:'confirmed'}]}},proposal:{scenarios:[20,25,30].map(cap=>({cap,price:1400,promo:0,forecast:forecast(cap)}))},events:[{kind:'tracking',detail:'Publication verified against the canonical session.',created_at:now}]}];
const pre=`
window.staffAgentPreviewTasks=${JSON.stringify(tasks)};
const sap=window.calendarPreviewData;sap.snapshot.staff={id:'QA-MANAGER',name:'Local QA Manager',role:'duty_manager'};sap.snapshot.orders=[];
sap.snapshot.experiences.push({experience_id:'craft',name:'Thai Craft Lab',kind:'Craft',duration_min:150,price_thb:1400,rating:4.8,review_count:12,host_name:'Local QA host',languages:['English'],venue_id:'shanghai',details:{}});
sap.snapshot.sessions.push({session_id:'qa-published',experience_id:'craft',starts_at:'${future}T06:00:00Z',ends_at:'${future}T08:30:00Z',capacity:25,seats_held_other_channels:0,seats_taken:2,price_thb:1400,status:'open'});
sap.snapshot.bookings.push({booking_id:'B-QA-NEW',session_id:'qa-published',traveler_id:sap.user.id,guest_name:'Local QA guest',guests:2,channel:'app',status:'confirmed',unit_price_thb:1400,checkin_code:'QANEW1',created_at:'${now}'});
sap.snapshot.sessionPlans.push({plan_id:'PLAN-QA-PUBLISHED',experience_id:'craft',session_date:'${future}',start_time:'14:00:00',capacity:25,price_thb:1400,promo_budget_thb:0,reason:'Local QA published plan.',status:'approved',submitted_by:'QA-COORD',approved_by:'QA-MANAGER',created_session_id:'qa-published',version:3,events:[]});
`;
html=html.replace('window.calendarPreviewCalls=[];',()=>pre+'\nwindow.calendarPreviewCalls=[];');
const rpc=`
 if(name==='journeyhub_staff_agent'){
  const task=window.staffAgentPreviewTasks.find(t=>t.id===args.p_id);let planId=null;
  if(args.p_action==='prepare'&&task){planId=task.planId||'PLAN-QA-PREPARED';if(!task.planId){const p=task.proposal;task.planId=planId;task.status='draft';task.summary='Draft prepared. Review the date and forecast, then submit it for a different manager to approve.';d.snapshot.sessionPlans.unshift({plan_id:planId,experience_id:'craft',session_date:p.date,start_time:p.startTime+':00',capacity:p.cap,price_thb:p.price,promo_budget_thb:p.promo,reason:p.reason,status:'draft',version:1,events:[]});}}
  if(args.p_action==='acknowledge'&&task)task.acknowledgedUntil=new Date(Date.now()+86400000).toISOString();
  return{data:{tasks:JSON.parse(JSON.stringify(window.staffAgentPreviewTasks)),planId,checkedAt:new Date().toISOString()},error:null};
 }
`;
html=html.replace("if(name==='journeyhub_snapshot')",()=>rpc+"\n if(name==='journeyhub_snapshot')");
html=html.replace("state.role='traveler';state.guestOk=true;state.route='orders';state.params={};calSelect('2026-11-04');window.calendarPreviewReady=true;",()=>"state.role='staff';state.route='s-today';state.params={};await saLoad(true);render();window.calendarPreviewReady=true;window.staffAgentPreview={workspace:()=>{state.role='staff';go('s-today');},assistant:()=>{state.role='staff';go('s-assistant');}};");
html=html.replace('<title>Local QA · Calendar</title>','<title>Local QA · Staff assistant</title>');
html=html.replace('</html>','<aside style="position:fixed;top:8px;left:8px;z-index:99999;display:grid;gap:5px;padding:10px;background:#222;color:#fff;border-radius:10px;font:12px sans-serif;max-width:125px"><b>Local QA · Mock data</b><button onclick="window.staffAgentPreview?.workspace()">Workspace</button><button onclick="window.staffAgentPreview?.assistant()">Assistant</button></aside></html>');
for(const script of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean))new vm.Script(script);
fs.writeFileSync(path.join(out,'fixture-staff-agent.html'),html);
console.log('Wrote fixture-staff-agent.html: compact staff workspace, opportunity, preparation and publication tracking. All data mocked; no live writes.');
