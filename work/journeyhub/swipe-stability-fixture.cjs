// Local QA harness: real swipe renderer/handlers, simulated saves, no account/API.
const fs=require('node:fs'),path=require('node:path');
const planning=fs.readFileSync(path.join(__dirname,'journey-planning.js'),'utf8');
const motion=planning.slice(planning.indexOf('function jpChoiceMotion('),planning.indexOf('A.jpPicks='));
const gestures=planning.slice(planning.indexOf('function jpReleaseGesture('),planning.indexOf('function jpWatchPlanning('));
const backs=planning.slice(planning.indexOf('function jpDeckBacks('),planning.indexOf('function jpChoiceMotion('));
const discovery=fs.readFileSync(path.join(__dirname,'place-discovery.js'),'utf8');
const history=fs.readFileSync(path.join(__dirname,'trip-history.js'),'utf8');
const historyBadge=history.slice(history.indexOf('function thBadge('),history.indexOf('function thSampleHTML('))+history.slice(history.indexOf("const thPicks=V['ai-picks']"),history.indexOf("const thPlan=V['place-plan']"));
const prelude=`
const A={jpRequirements(){},jpPick(){}},V={journey:()=>({body:''}),'ai-picks':()=>({body:'Catalog fixture'})},TAB_OF={};
let ag={owner:'fixture-owner',busy:false,error:'',prefs:{city:'Shanghai',date:'2099-01-01',prompt:'Local food',days:1}},jhUser={id:'fixture-owner'},state={route:'ai-picks',role:'traveler'},ui={sheet:null,toast:null},scrollTop=false,jpGesture=null;
const app=document.getElementById('app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ic=(name)=>'<span aria-hidden="true">'+({pin:'⌖',x:'×',heart:'♡',sparkle:'✦',journey:'↝',check:'✓'}[name]||'›')+'</span>',bar=o=>'<header class="bar"><span class="bar-title">'+esc(o.title)+'</span>'+o.right+'</header>',tabbar=()=>'<nav class="tabbar"><button class="tab" aria-current="page">AI Journey</button><button class="tab">Explore</button><button class="tab">Bookings</button><button class="tab">Me</button></nav>';
const agErrorText=e=>e.message,agDate=s=>s,jpSavePrefs=()=>{},jpNormalize=x=>x,jpPayload=x=>x,dayISO=()=> '2098-01-01',openLogin=()=>{},toast=()=>{};
let doLogin=async()=>{},signOut=async()=>{},savePending=false;
function thQueueChoices(){savePending=true;}
function render(){const v=V[state.route]();app.innerHTML=(v.bar||'')+'<div class="screen">'+v.body+'</div>'+(v.foot||'')+tabbar();v.after?.();scrollTop=false;}
function go(route){state.route=route;render();}
`;
function source({localPhotos=false}={}){
  const pd=localPhotos?discovery.replace("return u.protocol==='https:'?u.href:''","return u.protocol==='https:'||u.origin==='http://127.0.0.1:4173'?u.href:''"):discovery;
  return prelude+backs+motion+gestures+pd+historyBadge+`
window.swipeFixture={A,render,get pd(){return pd},get state(){return state},bindPhotos:pdBindPhotos,completeSave(){savePending=false;render();},owner(id){jhUser={id};ag.owner=id;render();},reset(places){pd=pdFresh();Object.assign(pd,{mode:true,places,token:'fixture-only',expires:Date.now()+3600000});state.route='ai-picks';render();}};
`;
}
module.exports={source};
if(require.main===module){
 const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase'),html=fs.readFileSync(path.join(out,'index.html'),'utf8');
 const colors=['#32644a','#66533c','#314b67'];
 for(let i=0;i<3;i++)fs.writeFileSync(path.join(out,'fixture-swipe-'+i+'.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="'+colors[i]+'"/><circle cx="320" cy="280" r="130" fill="#e9d9b6"/><circle cx="320" cy="280" r="90" fill="#b59f75"/><text x="320" y="480" text-anchor="middle" fill="white" font-size="24">LOCAL QA ILLUSTRATION '+(i+1)+'</text></svg>');
 const places=colors.map((_,i)=>({id:'fixture-'+i,name:['Fixture café','Fixture restaurant','Fixture garden'][i],kind:'restaurant',source:'Amap',sourceURL:'https://amap.com',reason:'Local test illustration.',address:'Fixture address',attributions:[],openingHours:[],photo:{url:'http://127.0.0.1:4173/fixture-swipe-'+i+'.svg'}}));
 const controls=`document.getElementById('fixture-save').onclick=()=>swipeFixture.completeSave();document.getElementById('fixture-reset').onclick=()=>swipeFixture.reset(${JSON.stringify(places)});document.addEventListener('click',e=>{const button=e.target.closest('[data-act]');if(button&&!button.disabled)A[button.dataset.act]?.(button.dataset.a,button.dataset.b);});swipeFixture.reset(${JSON.stringify(places)});`;
 const extra=fs.readFileSync(path.join(__dirname,'place-discovery.css'),'utf8');
 fs.writeFileSync(path.join(out,'fixture-swipe-stability.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local QA · swipe stability</title>'+html.match(/<style>[\s\S]*?<\/style>/)[0]+'<style>'+extra+'.fixture-tools{position:fixed;top:4px;right:4px;z-index:2000;font:11px sans-serif;display:flex;gap:5px}.fixture-tools button{padding:5px;border:1px solid #888;background:#222;color:white}</style></head><body><aside class="fixture-tools"><button id="fixture-save">Simulate saved</button><button id="fixture-reset">Reset fixture</button></aside><div class="device" id="app"></div><script>'+source({localPhotos:true})+controls+'</script></body></html>');
 console.log('Local-only swipe fixture written. No backend calls.');
}
