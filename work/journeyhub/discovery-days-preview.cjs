/* Local-only QA: production UI with in-memory auth, searches and itineraries. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase');
const user={id:'35000000-0000-4000-8000-000000000085',email:'discovery-preview@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'};
const input={city:'Shanghai',date:'2026-12-01',days:4,guests:2,prompt:'Local food, Italian dining, matcha, museums and historic streets.',dayStart:'09:00',dayEnd:'21:00',transport:'drive'};
const titles=['Shanghai History Museum','Riverside Walk','Matcha Cafe','Italian Dinner','Yu Garden','Old Town Lunch','Art Museum','Tea House','Historic Street','Local Noodle Bar','Waterfront Gallery','Italian Lunch','City Park','Shanghai Cuisine','Garden Museum','Matcha Break'];
const places=titles.map((name,i)=>({id:'preview_'+i,name,kind:i%4===3?'restaurant':i%4===2?'cafe':'place',source:'Local QA fixture',address:'Preview location '+(i+1),attributions:[],openingHours:[],sourceURL:'',lat:31.23+(i%4)*.001,lng:121.47+Math.floor(i/4)*.001,reason:'Illustrative local test place.',bookable:false}));
const snapshot={profile:{id:user.id,email:user.email,name:'Preview traveler',country:'China'},staff:null,sessionPlans:[],metrics:[],liveMetrics:[],personal:{},bookings:[],orders:[],stores:[{store_id:'fixture',name:'Local preview store',kind:'Craft',area:'Preview',distance_km:1,opening_hours:'09:00–18:00',issues_vat_forms:false}],products:[{product_id:'fixture',store_id:'fixture',name:'Preview item',price_thb:100,description:'Local QA only.',categories:['gifts'],made_to_order:false}],inventory:[{product_id:'fixture',stock:10}],venues:[{venue_id:'fixture',name:'Preview venue',city:'Shanghai',time_zone:'Asia/Shanghai'}],experiences:[{experience_id:'fixture',name:'Preview activity',kind:'Culture',duration_min:60,price_thb:100,host_name:'Fixture',languages:['English'],venue_id:'fixture',details:{sample:true}}],sessions:[]};
snapshot.sessions.push({session_id:'preview-session',experience_id:'fixture',starts_at:'2026-12-01T02:00:00Z',ends_at:'2026-12-01T03:00:00Z',capacity:10,seats_held_other_channels:0,seats_taken:0,price_thb:100,status:'open'});
const prelude=`
window.JOURNEYHUB_CONFIG={url:'https://discovery-preview.invalid',publishableKey:'local-preview-only'};
window.discoveryPreviewData=${JSON.stringify({user,input,places,snapshot})};window.discoveryPreviewCalls=[];
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:window.discoveryPreviewData.user,access_token:'local-only'}},error:null}),getUser:async()=>({data:{user:window.discoveryPreviewData.user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:Error('Local preview only')})},rpc:async(name,args={})=>{
 window.discoveryPreviewCalls.push({rpc:name});const d=window.discoveryPreviewData;
 if(name==='journeyhub_snapshot')return {data:structuredClone(d.snapshot),error:null};
 if(name==='journeyhub_calendar_state')return {data:{removed:[]},error:null};
 if(name==='journeyhub_agent_list')return {data:[],error:null};
 if(name==='journeyhub_command'&&['profile','personal'].includes(args.p_operation))return {data:{},error:null};
 throw Error('Local preview blocked operation: '+name);
}})};
window.fetch=async(url,init={})=>{
 const d=window.discoveryPreviewData,p=init.method==='POST'?JSON.parse(init.body||'{}'):{};window.discoveryPreviewCalls.push({action:p.action||'health'});
 if(String(url).includes('maps_config'))return Response.json({ready:false});
 if(!p.action)return Response.json({ai:{ready:true,provider:'deepseek',model:'local-fixture'},discovery:{ready:true},email:{ready:false},worker:{ready:false},booking:{sample:true}});
 if(p.action==='history_list')return Response.json({items:[],nextCursor:null});
 if(p.action==='care_status')return Response.json({trips:[]});
 if(p.action==='discover'){d.input={...p};const count=[0,8,12,14,16][p.days];return Response.json({places:d.places.slice(0,count),token:'local-only',expires:Date.now()+3600000});}
 if(p.action==='discover_plan'){
   const ids=p.wanted.length?p.wanted:d.places.map(x=>x.id).filter(id=>!p.skipped.includes(id)),selected=d.places.filter(x=>ids.includes(x.id)),days=d.input.days;
   const stops=selected.map((place,i)=>{const dayIndex=Math.min(days,Math.floor(i*days/selected.length)+1),n=selected.slice(0,i).filter((_,j)=>Math.min(days,Math.floor(j*days/selected.length)+1)===dayIndex).length,h=9+n*2;return {...place,dayIndex,start:String(h).padStart(2,'0')+':00',end:String(h+1).padStart(2,'0')+':00'};});
   return Response.json({plan:{...d.input,summary:'Local QA: '+days+' complete days.',stops,roadRoutes:[],bookable:false,notice:'Local visual fixture. No live provider calls or reservations.'}});
 }
 return Response.json({error:{message:'Local preview blocks this operation.'}},{status:403});
};
`;
const controls=`
A.previewDays=async value=>{ag.prefs={...window.discoveryPreviewData.input,days:Number(value)};window.discoveryPreviewData.input={...ag.prefs};await A.jpRequirements();document.querySelector('#preview-status').textContent=pd.places.length+' cards / '+ag.prefs.days+' days';};
A.previewLikes=value=>{pd.wanted=pd.places.slice(0,Number(value)||pd.places.length).map(p=>p.id);pd.skipped=[];pd.plan=null;pd.error='';go('ai-picks');document.querySelector('#preview-status').textContent=pd.wanted.length+' liked / '+pd.input.days+' days';};
A.previewGenerate=()=>A.pdFinish();
`;
function make(){
  let html=fs.readFileSync(path.join(out,'index.html'),'utf8');
  if(!html.includes('so every day has a stop.'))throw Error('Build the new discovery guards before creating this preview.');
  let code=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean).join('\n');
  code=code.replace('jhStart();',controls+`jhStart().then(async()=>{state.role='traveler';state.guestOk=true;await A.previewDays(4);window.discoveryPreviewReady=true;});`);new vm.Script(prelude+code);
  html=html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*href="https?:[^>]*>/g,'');
  html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; connect-src \'none\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\'; frame-src \'none\'">');
  const toolbar='<details id="preview-controls" style="position:fixed;top:0;left:0;z-index:99999;background:#111;color:white;padding:8px;border:1px solid #777;font:12px sans-serif"><summary>Local QA controls</summary><p id="preview-status">Loading</p>'+[1,2,3,4].map(n=>'<button data-act="previewDays" data-a="'+n+'">'+n+' days</button>').join('')+'<p><button data-act="previewLikes" data-a="2">Like 2</button> <button data-act="previewLikes" data-a="0">Like all</button> <button data-act="previewGenerate">Generate</button></p><small>No live calls or saved data</small></details>';
  html=html.replace('</html>',()=>toolbar+'<script>'+prelude+code+'</script></html>');
  fs.writeFileSync(path.join(out,'discovery-days-preview.html'),html);console.log('Wrote local discovery-days-preview.html: 1–4 day controls, 8/12/14/16 cards, shortlist guard and complete daily plan fixture; network blocked.');
}
module.exports={make};if(require.main===module)make();
