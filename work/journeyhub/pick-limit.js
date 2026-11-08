/* How many places a trip can keep. Plans are built by day, so the trip length sets a
   total cap on must-visit places, spread evenly across the days:
     up to 2 hours: 1 · up to 8 hours: 2 · up to 12 hours: 3 · a longer single day: 4
     2 days: 8 · 3 days: 10 · 4 days: 12
   A single day's length is its daily window (start to finish). Applies on every screen size. */
const jhPickInput=()=>typeof pd!=='undefined'&&pd.mode?{...ag.prefs,...(pd.input||{})}:ag.prefs;
function jhPickHours(input){
  const m=t=>{const [h,mm]=String(t||'').split(':').map(Number);return h*60+(mm||0);};
  const span=m(input.dayEnd)-m(input.dayStart);
  return Number.isFinite(span)&&span>0?span/60:12;
}
function jhPickCap(input=jhPickInput()){
  const days=Math.max(1,Math.min(4,Math.round(Number(input.days)||1)));
  if(days>1)return {2:8,3:10,4:12}[days];
  const hours=jhPickHours(input);
  return hours<=2?1:hours<=8?2:hours<=12?3:4;
}
// Even split across days, earlier days take any remainder: 10 over 3 days is 4, 3, 3.
function jhPickPerDay(cap=jhPickCap(),days=Math.max(1,Math.min(4,Math.round(Number(jhPickInput().days)||1)))){
  return Array.from({length:days},(_,i)=>Math.floor(cap/days)+(i<cap%days?1:0));
}
const jhPickKept=()=>typeof pd!=='undefined'&&pd.mode?pd.wanted.slice():jpValidIDs(ag.prefs.preferredExperienceIds,ag.prefs.city);
function jhPickLimitText(cap=jhPickCap()){
  const input=jhPickInput(),days=Math.round(Number(input.days)||1);
  const length=days>1?days+' days':(()=>{const h=jhPickHours(input);return h<=2?'up to 2 hours':h<=8?'up to 8 hours':h<=12?'up to 12 hours':'a full day';})();
  return 'A trip of '+length+' fits up to '+plural(cap,'place')+'.';
}
const jhPickBase=A.jpPick;
A.jpPick=(id,vote)=>{
  if(vote==='want'&&!jhPickKept().includes(id)&&jhPickKept().length>=jhPickCap()){
    toast(jhPickLimitText()+' Release one to keep this.');
    return false;
  }
  return jhPickBase(id,vote);
};
// Put one kept place back among the cards still to decide.
A.jhPickRelease=id=>{
  if(typeof pd!=='undefined'&&pd.mode){
    if(pd.busy||!pd.wanted.includes(id))return;
    pd.wanted=pd.wanted.filter(x=>x!==id);pd.undo=pd.undo.filter(x=>x!==id);pd.plan=null;pd.error='';
    if(typeof thQueueChoices==='function')thQueueChoices(pd);
  }else{
    if(!ag.prefs.preferredExperienceIds.includes(id))return;
    ag.prefs.preferredExperienceIds=ag.prefs.preferredExperienceIds.filter(x=>x!==id);
    jpUndo=jpUndo.filter(x=>x.id!==id);jpSavePrefs();
  }
  render();
};
