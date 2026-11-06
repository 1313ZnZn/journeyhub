/* Local visual fixture: real app + durable-task adapter, all providers/auth mocked. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase');
require('./calendar-preview.cjs').make();
let html=fs.readFileSync(path.join(out,'fixture-calendar.html'),'utf8');
const adapter=fs.readFileSync(path.join(__dirname,'traveler-planner-ui.js'),'utf8');
const adapterStart=html.indexOf('/* Durable traveler planning.'),adapterEnd=html.indexOf('/* Keep native editing/IME nodes alive');
if(adapterEnd<0)throw Error('Expected current production input stability wrapper.');
html=adapterStart>=0?html.slice(0,adapterStart)+adapter+'\n'+html.slice(adapterEnd):html.slice(0,adapterEnd)+adapter+'\n'+html.slice(adapterEnd);
html=html.replace('</style>',()=>fs.readFileSync(path.join(__dirname,'traveler-planner-ui.css'),'utf8')+'\n</style>');
const fixture=`
window.plannerPreviewInput={city:'Shanghai',date:'2026-12-01',days:2,guests:2,prompt:'Shanghai local food, Italian restaurants, matcha and museums',dayStart:'09:00',dayEnd:'21:00',transport:'drive'};
window.plannerPreviewRead=()=>{try{return JSON.parse(localStorage.getItem('journeyhub-local-planner-fixture')||'null');}catch{return null;}};
window.plannerPreviewWrite=task=>{localStorage.setItem('journeyhub-local-planner-fixture',JSON.stringify(task));return JSON.parse(JSON.stringify(task));};
window.plannerPreviewNew=kind=>({id:kind==='discover'?'93000000-0000-4000-8000-000000000001':'93000000-0000-4000-8000-000000000002',kind,status:'running',input:window.plannerPreviewInput,stage:kind==='discover'?'searching':'validating',message:kind==='discover'?'Finding more matcha options.':'Checking opening hours and travel times.',events:[{kind:'tool_result',tool:'set_requirements',summary:'Prepared four interests: local food, Italian dining, matcha and museums.'},{kind:'tool_result',tool:'search_places',summary:'Found local food and museum options.'},{kind:'tool_result',tool:'inspect_coverage',summary:'Italian dining and matcha need more matches.'},{kind:'tool_result',tool:'search_places',summary:'Searched again for Italian restaurants and matcha.'}],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
window.plannerPreviewPlaces=Array.from({length:12},(_,i)=>({id:'local-planner-place-'+i,name:['Shanghai local food','Italian restaurant','Matcha cafe','Shanghai museum'][i%4]+' · '+(Math.floor(i/4)+1),kind:['restaurant','restaurant','cafe','museum'][i%4],reason:'Matches one of the requested interests.',source:'Local QA fixture',sourceURL:'https://example.invalid/places/'+i,address:'Shanghai',attributions:[],openingHours:['09:00–21:00'],lat:31.23+i*.0005,lng:121.47+i*.0005}));
window.plannerPreviewResult=task=>task.kind==='discover'?{historyId:'local-planner-search',input:task.input,places:window.plannerPreviewPlaces,token:'local-preview-selection',expires:Date.now()+3600000,targetCardCount:12,cardCountShortfall:0}:{historyId:'local-planner-plan',plan:{...task.input,summary:'A complete two-day plan covering food, matcha and museums.',notice:'Local QA only.',stops:window.plannerPreviewPlaces.slice(0,8).map((p,i)=>({...p,dayIndex:i<4?1:2,start:['09:00','12:00','15:00','17:00'][i%4],end:['10:30','13:30','16:00','18:30'][i%4]})),roadRoutes:[]}};
if(!window.plannerPreviewRead())window.plannerPreviewWrite(window.plannerPreviewNew('discover'));
`;
html=html.replace('window.calendarPreviewCalls=[];',()=>fixture+'\nwindow.calendarPreviewCalls=[];');
const transport=`
 if(p.action==='planner_start'){const t=window.plannerPreviewNew(p.kind);t.input=p.kind==='discover'?p.payload:window.plannerPreviewInput;return Response.json({task:window.plannerPreviewWrite(t)});}
 if(p.action==='planner_status')return Response.json({task:window.plannerPreviewRead()});
 if(p.action==='planner_retry'){const t=window.plannerPreviewRead();t.status='running';t.error=null;t.message='Continuing the saved search.';t.events.push({kind:'resume',summary:'Resumed the saved task without restarting completed tools.'});t.updatedAt=new Date().toISOString();return Response.json({task:window.plannerPreviewWrite(t)});}
 if(p.action==='history_open'&&p.id==='local-planner-plan')return Response.json({...window.plannerPreviewResult({kind:'discover',input:window.plannerPreviewInput}),wanted:window.plannerPreviewPlaces.slice(0,8).map(x=>x.id),skipped:[]});
 if(p.action==='history_choices')return Response.json({historyId:p.id});
`;
html=html.replace("if(!p.action)return Response.json",()=>transport+'\n if(!p.action)return Response.json');
const bootstrap=`jhStart().then(async()=>{
 await Promise.all([thLoad(),tcLoad(true),agLoadRuns()]);state.role='traveler';state.guestOk=true;state.route='journey';state.params={};ag.prefs=jpNormalize(window.plannerPreviewInput);render();await ptuRestore(ptu);
 window.plannerPreview={
  progress:()=>A.ptuOpen(),
  search:()=>{ptuRetire(ptu);pd=pdFresh();ag.prefs=jpNormalize(window.plannerPreviewInput);go('journey');void A.jpRequirements();},
  planning:()=>{ptuRetire(ptu);pd=pdFresh();window.plannerPreviewWrite(window.plannerPreviewNew('discover_plan'));ptu.task=window.plannerPreviewRead();void A.ptuOpen();},
  async complete(){const t=window.plannerPreviewRead();t.status='completed';t.stage='completed';t.message='Saved to Trip history.';t.result=window.plannerPreviewResult(t);t.updatedAt=new Date().toISOString();window.plannerPreviewWrite(t);await ptuPoll(ptu);},
  async needsInput(){const t=window.plannerPreviewRead();t.status='needs_input';t.message='No verified matcha options were found for these preferences.';t.error={code:'INTEREST_UNVERIFIED',message:t.message};t.updatedAt=new Date().toISOString();window.plannerPreviewWrite(t);await ptuPoll(ptu);},
  async failure(){const t=window.plannerPreviewRead();t.status='failed';t.message='The map provider could not be reached. Your completed searches are saved.';t.error={code:'PROVIDER_UNAVAILABLE',message:t.message};t.updatedAt=new Date().toISOString();window.plannerPreviewWrite(t);await ptuPoll(ptu);},
  home:()=>go('journey'),
  reset:()=>{localStorage.removeItem('journeyhub-local-planner-fixture');localStorage.removeItem(ptuPendingKey(jhUser.id));location.reload();}
 };
 window.plannerPreviewReady=true;
});`;
html=html.replace("jhStart().then(async()=>{await Promise.all([thLoad(),tcLoad(true),agLoadRuns()]);calScope();state.role='traveler';state.guestOk=true;state.route='orders';state.params={};calSelect('2026-11-04');window.calendarPreviewReady=true;});",()=>bootstrap);
if(!html.includes('window.plannerPreviewReady=true'))throw Error('Fixture bootstrap not replaced.');
html=html.replace('<title>Local QA · Calendar</title>','<title>Local QA · Traveler planning agent</title>');
html=html.replace('</html>','<aside style="position:fixed;top:8px;left:8px;z-index:99999;display:grid;gap:6px;padding:10px;background:#222;color:#fff;border-radius:10px;font:12px sans-serif;max-width:130px"><b>Local QA · Mock data</b><button onclick="window.plannerPreview?.progress()">Open saved progress</button><button onclick="window.plannerPreview?.search()">New search</button><button onclick="window.plannerPreview?.planning()">Plan progress</button><button onclick="window.plannerPreview?.complete()">Finish task</button><button onclick="window.plannerPreview?.needsInput()">Missing interest</button><button onclick="window.plannerPreview?.failure()">Provider failure</button><button onclick="window.plannerPreview?.home()">Home</button><button onclick="location.reload()">Reload & resume</button><button onclick="window.plannerPreview?.reset()">Reset fixture</button></aside></html>');
for(const script of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean))new vm.Script(script);
fs.writeFileSync(path.join(out,'fixture-traveler-planner.html'),html);
console.log('Wrote fixture-traveler-planner.html: real UI, mock task persistence, actual stage log, missing-interest and provider-failure controls; all external calls blocked.');
