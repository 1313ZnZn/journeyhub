/* Local-only visual review. Never copied into the public deployment allowlist. */
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase');
let html=fs.readFileSync(path.join(out,'index.html'),'utf8');
const setup=`
sb.auth.getSession=async()=>({data:{session:null},error:null});
sb.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}});
const reviewRPC=sb.rpc.bind(sb);sb.rpc=(name,args)=>name==='journeyhub_snapshot'?reviewRPC(name,args):Promise.resolve({data:null,error:{message:'UI preview: saving is disabled.'}});
pmMount=async()=>{const status=document.querySelector('[data-pm-status]');if(status){status.hidden=false;status.textContent='UI preview · map not loaded';}};
function reviewSeed(){
  const experiences=Object.values(EXPS).filter(e=>e.city==='Shanghai').slice(0,4);
  pd=pdFresh();pd.mode=true;pd.input={...ag.prefs,city:'Shanghai',date:'2026-11-02',days:2};
  pd.places=experiences.map(e=>({id:e.id,name:e.name,kind:e.kind,reason:e.details?.summary||(e.details?.en!==e.name?e.details?.en:'')||'Leave time to explore at your own pace, with a relaxed break before the next stop.',address:e.venue,lat:31.23,lng:121.48,attributions:[],openingHours:[],sourceURL:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(e.venue+' Shanghai'),photo:{url:ixPhoto(e),authors:[]}}));
  pd.plan={city:'Shanghai',date:'2026-11-02',days:2,transport:'walk',summary:'A sample layout for two days in Shanghai.',notice:'UI preview only. No reservations or AI calls.',roadRoutes:[],stops:pd.places.map((p,i)=>({...p,dayIndex:i<2?1:2,start:i%2?'11:00':'09:00',end:i%2?'12:30':'10:30',travel:i%2?{durationMinutes:30,mode:'walk',source:'Estimate'}:null}))};
}
window.reviewView=page=>{state.role='traveler';state.guestOk=true;if(page==='cards'||page==='itinerary'){reviewSeed();go(page==='cards'?'ai-picks':'place-plan');if(page==='itinerary')A.tuTab('itinerary');}else go(page==='home'?'journey':page);};
A.jpRequirements=()=>window.reviewView('cards');A.pdFinish=()=>window.reviewView('itinerary');
jhStart().then(()=>{clearInterval(jhPoll);window.reviewView(location.hash.slice(1)||'home');});
`;
html=html.replace('jhStart();',setup).replaceAll('Place data: Google Maps','UI preview · example data');
html=html+'<aside style="position:fixed;left:10px;top:10px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:150px;font:13px system-ui;color:#315342"><strong>UI preview</strong><span>Sample itinerary · no AI or booking calls</span><button onclick="reviewView(\'home\')">Home</button><button onclick="reviewView(\'cards\')">Cards</button><button onclick="reviewView(\'itinerary\')">Itinerary</button><button onclick="reviewView(\'home\');document.querySelector(\'[data-act=tab][data-a=home]\').click()">Explore</button></aside>';
fs.writeFileSync(path.join(out,'ui-review.html'),html);console.log('Local UI review ready.');
