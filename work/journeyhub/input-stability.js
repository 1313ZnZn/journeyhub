/* Keep native editing/IME nodes alive during background refreshes. Load after all view wrappers. */
const inputStablePreviousRender=render;
let inputStableContext=null,inputStablePending=false,inputStableComposition=null,inputStableExplicit=0,inputStablePointer=false,inputStableFlushTimer=null,inputStableSheetScope=null;
const inputStableRegions=new Set();
const inputStableEditable=el=>!!(el&&app.contains(el)&&!el.disabled&&(el.tagName==='TEXTAREA'||el.tagName==='SELECT'||el.isContentEditable||(el.tagName==='INPUT'&&!['button','submit','reset','checkbox','radio','range','color','file','hidden','image'].includes(el.type))));
const inputStableActive=()=>inputStableEditable(document.activeElement)?document.activeElement:inputStableComposition?.isConnected&&app.contains(inputStableComposition)?inputStableComposition:null;
function inputStableScope(){
  const staff=state.auth?.staff,trav=state.auth?.traveler,sheet=ui.sheet;
  return JSON.stringify([state.route,state.params||{},state.role,state.guestOk,jhUser?.id||null,jhRevision,jhRecovery,jhUser?.email_confirmed_at||null,staff?.id||null,staff?.role||null,trav?.id||null,
    sheet?[sheet.type,sheet.id||null,sheet.coll||null,sheet.mode||null]:null,ui.showPw,ui.loginBusy,ui.loginErr,ui.loginFieldErr,ui.lockUntil,MODE.kind,allReady(),allDefinitive(),catalogEmpty()]);
}
function inputStableFlush(){
  inputStableFlushTimer=null;
  if(inputStablePointer||inputStableActive()||(ui.sheet&&inputStableSheetScope===inputStableScope()))return;
  if(inputStablePending){render();return;}
  const names=[...inputStableRegions];inputStableRegions.clear();names.forEach(name=>updateRegion(name));
}
function inputStableSchedule(){
  if(inputStableFlushTimer!==null)clearTimeout(inputStableFlushTimer);
  inputStableFlushTimer=setTimeout(inputStableFlush,0);
}
function inputStableUserAction(){
  const token=++inputStableExplicit;
  queueMicrotask(()=>{if(inputStableExplicit===token)inputStableExplicit=0;});
}
render=function(){
  const scope=inputStableScope(),focused=inputStableActive();
  // Route/modal/auth changes and explicit commands still redraw immediately.
  if((focused||(ui.sheet&&inputStableSheetScope===scope))&&scope===inputStableContext&&!scrollTop&&!inputStableExplicit){
    inputStablePending=true;
    // Connection status can change without replacing the editor or moving focus.
    if(typeof jhDrawStatus==='function')jhDrawStatus();
    return;
  }
  inputStablePending=false;inputStableRegions.clear();
  inputStablePreviousRender();
  inputStableContext=inputStableScope();
  if(inputStableSheetScope!==inputStableContext)inputStableSheetScope=null;
  if(inputStableComposition&&!inputStableComposition.isConnected)inputStableComposition=null;
};
updateRegion=function(name){
  const draw=REGIONS[name];if(typeof draw!=='function')return;
  const focused=inputStableActive();let deferred=false;
  document.querySelectorAll('[data-region]').forEach(el=>{
    if(el.dataset.region!==name)return;
    if(focused&&(el===focused||el.contains(focused))){deferred=true;return;}
    el.innerHTML=draw();
  });
  if(deferred)inputStableRegions.add(name);else inputStableRegions.delete(name);
};
document.addEventListener('compositionstart',e=>{if(inputStableEditable(e.target))inputStableComposition=e.target;},true);
document.addEventListener('compositionend',e=>{if(inputStableComposition===e.target)inputStableComposition=null;inputStableSchedule();},true);
// A dismissed mobile keyboard must not be reopened by the core sheet autofocus.
document.addEventListener('focusin',e=>{if(inputStableEditable(e.target)&&e.target.closest('.sheet'))inputStableSheetScope=inputStableScope();},true);
document.addEventListener('keydown',e=>{
  if(!app.contains(e.target))return;
  const composing=e.isComposing||e.keyCode===229||inputStableComposition===e.target;
  if(composing&&(e.key==='Enter'||e.key==='Escape')){
    // Do not prevent the IME's native commit/cancel; only suppress app hotkeys.
    e.stopImmediatePropagation();return;
  }
  if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA')inputStableUserAction();
},true);
document.addEventListener('submit',e=>{
  if(!app.contains(e.target))return;
  if(inputStableComposition?.isConnected){e.preventDefault();e.stopImmediatePropagation();return;}
  inputStableUserAction();
},true);
document.addEventListener('click',e=>{
  inputStablePointer=false;
  const target=e.target.closest?.('[data-act]');
  if(target&&app.contains(target)&&!target.disabled&&!(target.dataset.act==='scrim'&&e.target!==target))inputStableUserAction();
  inputStableSchedule();
},true);
document.addEventListener('change',e=>{
  const el=e.target;if(!app.contains(el)||inputStableComposition===el)return;
  if(el.tagName==='SELECT'||['checkbox','radio','range','color','file'].includes(el.type))inputStableUserAction();
},true);
document.addEventListener('focusout',inputStableSchedule,true);
for(const event of ['pointerdown','mousedown'])document.addEventListener(event,()=>{inputStablePointer=true;},true);
for(const event of ['pointerup','mouseup','pointercancel'])document.addEventListener(event,()=>{inputStablePointer=false;inputStableSchedule();},true);
