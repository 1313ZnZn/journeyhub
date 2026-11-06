/* Real discovery UI contracts, isolated from all remote services. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{webcrypto}=require('node:crypto');
(async()=>{
  const dom=new JSDOM('<main id="app"></main>',{runScripts:'outside-only',url:'https://journey.test/'}),w=dom.window;
  Object.defineProperty(w,'crypto',{value:webcrypto});
  Object.assign(w,{AbortController,Response});
  const calls=[];let response=null;
  w.fetch=async(url,init={})=>{if(!init.body)return Response.json({discovery:{ready:true}});const payload=JSON.parse(init.body);calls.push(payload);return Response.json(response);};
  w.eval(`const TAB_OF={},A={jpRequirements(){},jpPick(){}},V={'ai-picks':()=>({body:''}),journey:()=>({body:''})};
    let jhUser={id:'owner'},ag={owner:'owner',busy:false,prefs:{city:'Shanghai',date:'2026-12-01',prompt:'Food and gardens',days:1}},state={route:'journey'};
    const jhConfig={url:'https://fixture.test',publishableKey:'public-fixture'},sb={auth:{getSession:async()=>({data:{session:{user:jhUser,access_token:'fixture-token'}}})}};
    let render=()=>{},doLogin=async()=>{},signOut=async()=>{};const previewToasts=[],toast=message=>previewToasts.push(message);
    const go=route=>{state.route=route;},jpSavePrefs=()=>{},jpNormalize=x=>x,jpPayload=x=>x,agErrorText=e=>e.message,jpChoiceMotion=()=>{};
    const bar=x=>x,esc=s=>String(s??''),ic=()=>'',agDate=s=>s,jpDeckBacks=()=>'',dayISO=()=> '2026-11-04';
    `+fs.readFileSync(__dirname+'/place-discovery.js','utf8')+`
    window.testUI={A,V,ag,state,previewToasts,get pd(){return pd},seed(input,places,wanted=[],skipped=[]){pd=pdFresh();Object.assign(pd,{mode:true,input,places,wanted,skipped,token:'signed-fixture',expires:Date.now()+3600000});state.route='ai-picks';}};`);
  const t=w.testUI,place=i=>({id:'place_'+i,name:'Place '+i,attributions:[],openingHours:[],sourceURL:'https://example.test/places/'+i});
  // No frontend truncation: all 16 verified cards remain available; requested days
  // travel to the backend instead of being silently replaced by a default day.
  for(const [days,count] of [[1,8],[2,12],[3,14],[4,16]]){
    t.ag.prefs.days=days;response={places:Array.from({length:count},(_,i)=>place(i)),token:'signed-fixture',expires:Date.now()+3600000};
    await t.A.jpRequirements();assert.equal(calls.at(-1).days,days);assert.equal(t.pd.places.length,count);assert.equal(t.state.route,'ai-picks');
  }
  assert.equal(t.previewToasts.length,0,'full target results do not add explanatory text');
  response={places:[place(0),place(1)],targetCardCount:16,cardCountShortfall:14,token:'signed-fixture',expires:Date.now()+3600000};
  await t.A.jpRequirements();assert.equal(t.previewToasts.length,1);assert.match(t.previewToasts[0],/Found 2 matching places/);
  t.V['ai-picks']();t.V['ai-picks']();assert.equal(t.previewToasts.length,1,'rendering never repeats the shortage toast');
  const places=Array.from({length:16},(_,i)=>place(i)),input={...t.ag.prefs,days:4};
  t.seed(input,places,['place_0'],['place_2']);let before=calls.length;
  assert.match(t.V['ai-picks']().body,/unreviewed places optional/);
  response={plan:{days:4,agent:{checked:true},stops:[{...places[0],dayIndex:1}]}};
  await t.A.pdFinish();assert.equal(calls.length,before+1,'one must-visit can produce a plan with free days');assert.equal(t.state.route,'place-plan');
  t.seed(input,places,[],places.map(p=>p.id));before=calls.length;await t.A.pdFinish();
  assert.equal(calls.length,before,'all skipped places cannot be re-added');assert.match(t.pd.error,/at least one place/);
  t.seed(input,places,['place_0'],['place_2']);response={plan:{days:4,agent:{checked:true},stops:[{...places[2],dayIndex:1}]}};
  await t.A.pdFinish();assert.equal(t.pd.plan,null);assert.match(t.pd.error,/shortlist/);
  // A malformed response with all stops on day 1 never becomes a successful plan.
  t.seed(input,places,places.map(p=>p.id));response={plan:{days:4,stops:places.map(p=>({...p,dayIndex:1}))}};
  await t.A.pdFinish();assert.equal(t.state.route,'ai-picks');assert.equal(t.pd.plan,null);assert.match(t.pd.error,/every day/);
  response={plan:{days:1,stops:[{...places[0],dayIndex:1}]}};await t.A.pdFinish();assert.equal(t.pd.plan,null,'shortening the trip does not hide missing days');
  response={plan:{city:'Shanghai',days:4,date:input.date,summary:'Four complete days',stops:places.map((p,i)=>({...p,dayIndex:Math.floor(i/4)+1,start:'09:00',end:'10:00'}))}};
  await t.A.pdFinish();assert.equal(t.state.route,'place-plan');assert.equal(t.pd.plan.stops.length,16);assert.equal(calls.at(-1).wanted.length,16);assert(!t.pd.busy);
  // Done before liking anything still accepts the remaining candidates, matching
  // server selection rules; every explicit Skip remains on the request.
  t.seed({...input,days:2},places,[],['place_0']);response={plan:{days:2,stops:[{...places[1],dayIndex:1},{...places[2],dayIndex:2}]}};
  await t.A.pdFinish();assert.equal(t.state.route,'place-plan');assert.deepEqual(calls.at(-1).skipped,['place_0']);assert.deepEqual(calls.at(-1).wanted,[]);
  dom.window.close();console.log('PASS: 8/12/14/16 cards preserved, days payload, must-visit and free day support, Skip preservation, incomplete response rejection, and complete four-day plans. No real network calls.');
})().catch(e=>{console.error(e);process.exitCode=1;});
