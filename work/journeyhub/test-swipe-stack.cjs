/* Real DOM events against the shared source handlers; no network or paid providers. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const dom=new JSDOM('<div id="app"></div>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://fixture.example/'}),w=dom.window;
const setup=`
const A={},V={},TAB_OF={},app=document.querySelector('#app'),esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('\"','&quot;').replaceAll('<','&lt;'),ic=()=>'',bar=()=>'',fmt=n=>String(n),agDate=s=>s,ixPhoto=()=>'',ixAlt=e=>e.name;
let ag={owner:'owner-a',busy:false,prefs:{city:'Shanghai',preferredExperienceIds:[],excludedExperienceIds:[]}},jpUndo=[],jpGesture=null;
const EXPS=Object.fromEntries(['a','b','c'].map(id=>[id,{id,city:'Shanghai',name:'Place '+id,kind:'Park',dur:'1h',price:0,details:{summary:'A calm walk'}}]));
const jpSavePrefs=()=>{},jpNormalize=p=>p,jpValidIDs=ids=>ids,go=()=>{};
let pd={mode:false,busy:false,places:[],wanted:[],skipped:[],undo:[],input:{city:'Shanghai',date:'2026-11-01'}};
const pdScope=()=>{},pdSource=()=>'',pdSafeURL=s=>s;
function render(){app.innerHTML=V['ai-picks']().body;}
document.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b&&!b.disabled)A[b.dataset.act]?.(b.dataset.a,b.dataset.b);});
`;
const planning=read('journey-planning.js'),discovery=read('place-discovery.js');
w.eval(setup+planning.slice(planning.indexOf('const jpCandidates='),planning.indexOf('function jpWatchPlanning'))+discovery.slice(discovery.indexOf('const pdPicks='),discovery.indexOf('A.pdFinish=async'))+`window.fixture={A,render,pdBindPhotos,get ag(){return ag},get pd(){return pd},replaceOwner(){ag={...ag,owner:'owner-b',prefs:{...ag.prefs}};},live(){pd={...pd,mode:true,places:['live-a','live-b','live-c'].map(id=>({id,name:id,kind:'park',reason:'A calm visit',address:'Provider address',attributions:[]})),wanted:[],skipped:[],undo:[]};render();}};render();`);
const t=w.fixture,app=()=>w.document.querySelector('#app'),card=()=>app().querySelector('.jp-swipe-card'),copy=x=>JSON.parse(JSON.stringify(x));
const pointer=(target,type,x,y,id=1,extra={})=>{const e=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:id,isPrimary:true,button:0,clientX:x,clientY:y,...extra});target.dispatchEvent(e);return e;};
const begin=()=>{const el=card();pointer(el,'pointerdown',150,100);return el;};
const slide=(dx)=>{const el=begin();pointer(el,'pointermove',150+dx,104);pointer(el,'pointerup',150+dx,104);return el;};
const backs=()=>app().querySelectorAll('.jp-deck-back').length;
assert.equal(backs(),2);
let el=begin();pointer(el,'pointermove',190,102);assert.equal(el.dataset.direction,'want');pointer(el,'pointerup',190,102);assert.equal(el.style.transform,'');assert(!el.classList.contains('jp-dragging'));assert.equal(t.ag.prefs.preferredExperienceIds.length,0,'short drags spring back without a vote');
el=begin();pointer(el,'pointermove',155,160);pointer(el,'pointermove',280,165);pointer(el,'pointerup',280,165);assert.equal(t.ag.prefs.preferredExperienceIds.length,0,'vertical scroll cannot turn into an accidental horizontal vote');
el=begin();pointer(el,'pointermove',260,104);pointer(el,'pointerup',260,104,2);assert.equal(t.ag.prefs.preferredExperienceIds.length,0,'another pointer cannot finish the gesture');pointer(el,'pointercancel',260,104);assert.equal(el.style.transform,'');assert.equal(t.ag.prefs.preferredExperienceIds.length,0,'cancel never submits');
el=begin();pointer(el,'pointermove',260,104);pointer(el,'lostpointercapture',260,104);assert.equal(t.ag.prefs.preferredExperienceIds.length,0,'lost capture cancels cleanly');
el=slide(110);assert.deepEqual(copy(t.ag.prefs.preferredExperienceIds),['a']);assert.equal(backs(),1);pointer(el,'pointerup',260,104);t.A.jpPick('a','skip');assert.deepEqual(copy(t.ag.prefs.excludedExperienceIds),[],'duplicate gesture or stale button cannot submit twice');
slide(-110);assert.deepEqual(copy(t.ag.prefs.excludedExperienceIds),['b']);assert.equal(backs(),0,'last card has no fake cards behind it');
t.A.jpUndo();assert.equal(backs(),1);assert.equal(card().dataset.pickId,'b');
card().dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',repeat:true,bubbles:true}));assert.deepEqual(copy(t.ag.prefs.preferredExperienceIds),['a'],'key autorepeat cannot eat the deck');
card().dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.deepEqual(copy(t.ag.prefs.preferredExperienceIds),['a','b']);assert.equal(w.document.activeElement,card(),'keyboard focus advances to the next card');
app().querySelector('[data-act="jpPick"][data-b="skip"]').click();assert.deepEqual(copy(t.ag.prefs.excludedExperienceIds),['c']);assert(!card());
t.A.jpReset();el=begin();pointer(el,'pointermove',260,104);t.replaceOwner();pointer(el,'pointerup',260,104);assert.equal(t.ag.prefs.preferredExperienceIds.length,0,'account changes cancel in-flight choices');
t.live();assert.equal(backs(),2);slide(110);assert.deepEqual(copy(t.pd.wanted),['live-a']);assert.equal(backs(),1);slide(-110);assert.deepEqual(copy(t.pd.skipped),['live-b']);assert.equal(backs(),0);t.A.pdUndo();assert.equal(backs(),1);assert.equal(card().dataset.pickId,'live-b');
t.pd.busy=true;el=begin();pointer(el,'pointermove',260,104);pointer(el,'pointerup',260,104);assert.deepEqual(copy(t.pd.wanted),['live-a'],'busy live plans reject swipes');t.pd.busy=false;
// A broken first photo advances to a provider alternative, then an honest fallback.
t.pd.places[1].photo={url:'https://images.example/first.jpg',alternatives:['https://images.example/second.jpg']};t.render();t.pdBindPhotos();
const image=app().querySelector('img.pd-photo');assert(image);assert.equal(image.loading||image.getAttribute('loading'),'eager');image.dispatchEvent(new w.Event('error'));assert(image.src.endsWith('/second.jpg'));image.dispatchEvent(new w.Event('error'));assert(image.hidden);assert(app().querySelector('.pd-photo-fallback'));
assert(!app().textContent.includes('Swipe left to skip'));assert(!app().querySelector('.pf-step'));assert(app().querySelector('.pd-card-details'));
console.log('PASS: real catalog/live swipe choices, remaining stack, directional hints, short drag, scroll, cancellation, pointer identity, duplicate votes, keyboard, buttons, undo, and account isolation.');
dom.window.close();
