/* Explore + Shop integration: production bundle, mocked transport, no remote writes. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),{webcrypto}=require('node:crypto');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase'),html=fs.readFileSync(path.join(out,'index.html'),'utf8');
assert(html.includes('exBrowse'),'Build the Explore/Shop merge before running this test.');
const copy=value=>JSON.parse(JSON.stringify(value)),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{for(let i=0;i<200&&!fn();i++)await delay(10);assert(fn(),label);};
const future=new Date(Date.now()+7*86400000).toISOString().slice(0,10),windows=[];
const user={id:'35000000-0000-4000-8000-000000000075',email:'explore-fixture@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'};
let personal={};
const fixture={staff:null,bookings:[],orders:[],sessionPlans:[],metrics:[],liveMetrics:[],
  stores:[{store_id:'rf',name:'Riverfront Gifts',kind:'Craft',area:'Riverside',distance_km:1,opening_hours:'09:00–17:00',issues_vat_forms:false},{store_id:'ct',name:'City Textile Studio',kind:'Textiles',area:'Siam',distance_km:2,opening_hours:'10:00–19:00',issues_vat_forms:true}],
  products:[{product_id:'tote',store_id:'rf',name:'Riverfront tote',price_thb:250,description:'Offline tote fixture.',categories:['gifts'],made_to_order:false},{product_id:'scarf',store_id:'ct',name:'Silk scarf',price_thb:1500,description:'Offline scarf fixture.',categories:['textiles'],made_to_order:true}],
  inventory:[{product_id:'tote',stock:10},{product_id:'scarf',stock:8}],
  venues:[{venue_id:'bangkok',name:'Heritage Hub',city:'Bangkok',time_zone:'Asia/Bangkok'},{venue_id:'shanghai',name:'Shanghai Riverside',city:'Shanghai',time_zone:'Asia/Shanghai'},{venue_id:'singapore',name:'Singapore Bay',city:'Singapore',time_zone:'Asia/Singapore'}],
  experiences:[{experience_id:'craft',name:'Thai Craft Lab',kind:'Craft',duration_min:90,price_thb:1400,rating:4.8,review_count:10,host_name:'Local host',languages:['English'],venue_id:'bangkok',details:{}},{experience_id:'food',name:'Bangkok food walk',kind:'Food',duration_min:90,price_thb:900,rating:4.8,review_count:10,host_name:'Local host',languages:['English'],venue_id:'bangkok',details:{}},{experience_id:'sh-walk',name:'Shanghai riverwalk',kind:'Culture',duration_min:90,price_thb:450,rating:4.8,review_count:10,host_name:'Local host',languages:['English'],venue_id:'shanghai',details:{}},{experience_id:'sg-walk',name:'Singapore bay walk',kind:'Culture',duration_min:90,price_thb:500,rating:4.8,review_count:10,host_name:'Local host',languages:['English'],venue_id:'singapore',details:{}}],
  sessions:['craft','food','sh-walk','sg-walk'].map((id,i)=>({session_id:'explore-session-'+i,experience_id:id,starts_at:future+'T03:00:00Z',ends_at:future+'T04:30:00Z',capacity:12,seats_held_other_channels:0,seats_taken:0,price_thb:450,status:'open'}))};

async function boot(signedIn=false){
  const errors=[],commands=[],requests=[],vc=new VirtualConsole();let snapshots=0;
  vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
  const dom=new JSDOM(html,{url:'http://localhost:4173/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;windows.push(w);
  Object.assign(w,{indexedDB:new IDBFactory(),Blob,Headers,Request,Response,TextEncoder,TextDecoder,AbortController,WebSocket});Object.defineProperty(w,'crypto',{value:webcrypto});
  w.URL.createObjectURL=()=> 'blob:explore-'+webcrypto.randomUUID();w.URL.revokeObjectURL=()=>{};
  w.fixtureSession=()=>signedIn?{user,access_token:'mock-explore-session'}:null;
  w.fixtureRPC=async(name,args={})=>{
    await delay(2);
    if(name==='journeyhub_calendar_state')return {data:{removed:[]},error:null};if(name==='journeyhub_snapshot'){snapshots++;return {data:{...copy(fixture),profile:signedIn?{id:user.id,email:user.email,name:'Explore Fixture',country:'Singapore'}:null,personal:signedIn?copy(personal):{}},error:null};}
    if(name==='journeyhub_agent_list')return {data:[],error:null};
    if(name==='journeyhub_command'){
      assert(signedIn,'Guest cannot write');assert(['profile','personal'].includes(args.p_operation),'Tests may not submit an order, reservation or staff operation');commands.push(copy(args));
      if(args.p_operation==='personal')personal=copy(args.p_payload.body);
      return {data:{},error:null};
    }
    throw Error('Unexpected mocked RPC: '+name);
  };
  w.fetch=async(input,init={})=>{
    const url=String(input?.url||input);assert(url.includes('/functions/v1/journeyhub-agent'),'Unexpected network access: '+url);
    if(init.method==='POST'){const payload=JSON.parse(init.body);requests.push(payload);assert(['care_status','history_list'].includes(payload.action),'Cannot generate plans or create bookings');return Response.json(payload.action==='care_status'?{trips:[]}:{items:[],hasMore:false});}
    return Response.json({ai:{ready:false,provider:'deepseek',model:'deepseek-chat'},email:{ready:false},worker:{ready:false},booking:{mode:'journeyhub_catalog',sample:true}});
  };
  w.eval(fs.readFileSync(path.join(out,'vendor/supabase.js'),'utf8'));w.eval(fs.readFileSync(path.join(out,'config.js'),'utf8'));
  let code=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean).join('\n');
  assert.equal((code.match(/jhStart\(\);/g)||[]).length,1,'Single bootstrap target');
  code=code.replace('jhStart();',`sb.rpc=(name,args)=>window.fixtureRPC(name,args);sb.auth.getSession=async()=>({data:{session:window.fixtureSession()},error:null});sb.auth.getUser=async()=>({data:{user:window.fixtureSession()?.user||null},error:null});sb.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}});window.EX_TEST={get ready(){return !jhLoading&&!!jhLastSnapshot},get settled(){return !jmCache.loading&&!ag.loading&&!ag.healthLoading},get state(){return state},get A(){return A},get TT(){return TT},get TAB_OF(){return TAB_OF},get db(){return DBC},get error(){return jhLastError},go,render,jhRefresh,jhFlush};jhStart();`);
  w.eval(code);const t=w.EX_TEST;await until(()=>t.ready&&t.settled,'offline app bootstrap');await delay(20);
  const app=()=>w.document.querySelector('#app');
  const screen=label=>{assert(!app().textContent.includes('Something went wrong'),label+' renders');assert.equal(t.error,'',label+' has no connection error');};
  const visit=(route,params={})=>{t.state.role='traveler';t.state.guestOk=true;t.go(route,params);screen(route);};
  const click=(act,a)=>{const el=app().querySelector('[data-act="'+act+'"]'+(a===undefined?'':'[data-a="'+a+'"]'));assert(el,act+' '+(a||'')+' control exists');el.click();screen(act);return el;};
  const type=(selector,value)=>{const el=app().querySelector(selector);assert(el,selector+' exists');el.focus();el.value=value;el.setSelectionRange(1,Math.min(3,value.length));el.dispatchEvent(new w.Event('input',{bubbles:true}));assert.strictEqual(app().querySelector(selector),el,'typing retains native node');assert.strictEqual(w.document.activeElement,el,'typing retains focus');return el;};
  const refresh=async()=>{const before=snapshots;await t.jhRefresh();assert(snapshots>before,'snapshot refresh ran');};
  const header=route=>{assert.equal(app().querySelector('.ex-header h1')?.textContent.trim(),'Explore');assert(app().querySelector('.ex-header [data-a="bag"]'),'shared header exposes bag');for(const pane of ['home','shop']){const button=app().querySelector('[data-act="exBrowse"][data-a="'+pane+'"]');assert.equal(button?.tagName,'BUTTON');assert.equal(button.getAttribute('aria-pressed'),String(pane===route));}assert.equal(app().querySelector('.tabbar [aria-current="page"]')?.dataset.a,'home','Explore remains highlighted');assert(!app().querySelector('.tabbar [data-a="shop"]'),'no separate Shop nav');};
  const close=async()=>{await until(()=>t.settled,'async work settles');await delay(20);assert.deepEqual(errors,[],'No browser errors');w.close();};
  return {w,t,app,screen,visit,click,type,refresh,header,close,commands,requests};
}

(async()=>{
  const h=await boot(),{t,app,w}=h;
  assert.deepEqual(Array.from(t.TT,row=>row[0]),['journey','home','orders','me'],'Four primary tabs');
  for(const route of ['shop','map','product','bag','checkout'])assert.equal(t.TAB_OF[route],'home',route+' belongs to Explore');
  h.visit('home');h.header('home');assert(app().querySelector('[data-a="reserved-trips"]'),'reservations preserved');assert(app().querySelector('[data-act="staffEntry"]'),'staff entry preserved');assert(app().querySelector('.fx-switch'),'currency control preserved');
  h.click('homeCat','food');const expSearch=h.type('#home-q','food');assert(app().querySelector('[data-region="homeResults"]').textContent.includes('Bangkok food walk'));
  const before=[expSearch.selectionStart,expSearch.selectionEnd];await h.refresh();assert.strictEqual(app().querySelector('#home-q'),expSearch,'Experience search survives async refresh');assert.deepEqual([expSearch.selectionStart,expSearch.selectionEnd],before);
  h.click('exBrowse','shop');h.header('shop');assert.equal(t.state.homeQuery,'food');assert.equal(t.state.homeCat,'food');
  h.click('shopCat','textiles');const productSearch=h.type('#shop-q','scarf');assert(app().querySelector('[data-region="shopGrid"]').textContent.includes('Silk scarf'));assert(!app().querySelector('[data-region="shopGrid"]').textContent.includes('Riverfront tote'));
  await h.refresh();assert.strictEqual(app().querySelector('#shop-q'),productSearch,'Product search survives async refresh');
  h.click('exBrowse','home');h.header('home');assert.equal(app().querySelector('#home-q').value,'food');assert.equal(app().querySelector('[data-act="homeCat"][aria-pressed="true"]').dataset.a,'food');
  h.click('exBrowse','shop');h.header('shop');assert.equal(app().querySelector('#shop-q').value,'scarf');assert.equal(t.state.shopCat,'textiles');
  h.type('#shop-q','');h.click('shopCat','all');h.click('addQuick','tote');assert.equal(t.state.cart.tote,1);assert(app().querySelector('.ex-header [data-a="bag"]').textContent.includes('1'),'bag count updates');await h.refresh();assert.equal(t.state.cart.tote,1,'Snapshot refresh retains bag');
  h.visit('product',{id:'scarf'});h.click('go','map');assert.equal(t.state.route,'map');h.click('shopStore','ct');assert.equal(t.state.route,'shop');h.header('shop');assert.equal(t.state.shopStore,'ct');assert(app().querySelector('[data-region="shopGrid"]').textContent.includes('Silk scarf'));assert(!app().querySelector('[data-region="shopGrid"]').textContent.includes('Riverfront tote'));
  t.A.back();h.screen('Back from store products');h.visit('shop');h.click('shopStore','');assert.equal(t.state.shopStore,null);assert.equal(app().querySelectorAll('[data-region="shopGrid"] .pcard').length,2,'clear store filter restores all products');
  h.visit('bag');h.click('go','checkout');assert.equal(t.state.route,'login','guest checkout requires sign-in');assert.equal(t.state.params.next.route,'checkout','checkout destination retained');assert.equal(t.state.cart.tote,1,'login gate retains cart');assert(app().querySelector('#lg-email'));
  h.visit('bag');h.click('cartRemove','tote');assert(app().textContent.includes('Your bag is empty'));h.click('tab','shop');assert.equal(t.state.route,'shop','legacy empty-bag link opens shopping');h.header('shop');
  for(const city of ['Shanghai','Singapore']){t.A.destination(city);h.screen(city);h.click('exBrowse','shop');h.header('shop');assert(/Bangkok/.test(app().textContent),'shopping discloses Bangkok location');assert(/not connected|Bangkok stores|Bangkok catalog|Bangkok only/i.test(app().textContent),'shopping does not imply local inventory');assert(!/\p{Script=Han}/u.test(app().textContent),'English shopping interface');}
  h.click('staffEntry');assert.equal(t.state.route,'login');assert.equal(t.state.params.mode,'staff');h.click('staffTraveler');await until(()=>t.state.route==='journey','Staff sign-in returns to traveler Journey');h.visit('shop');h.header('shop');await h.close();

  // Account persistence exercises the production flush/load path against an in-memory server.
  const signed=await boot(true);signed.visit('shop');signed.click('addQuick','tote');signed.click('addQuick','scarf');await signed.t.jhFlush();assert.deepEqual(personal.cart,{tote:1,scarf:1});await signed.refresh();assert.equal(signed.t.state.cart.scarf,1);await signed.close();
  const reopened=await boot(true);reopened.visit('shop');reopened.header('shop');assert.deepEqual(copy(reopened.t.state.cart),{tote:1,scarf:1},'Authenticated bag survives full app reload');reopened.click('go','bag');assert(reopened.app().textContent.includes('Riverfront tote'));assert(reopened.app().textContent.includes('Silk scarf'));reopened.click('go','checkout');assert.equal(reopened.t.state.route,'checkout','authenticated user reaches delivery');assert(reopened.app().querySelector('[data-act="placeOrder"]'),'existing checkout submission remains available');assert(!reopened.commands.some(x=>x.p_operation==='order'),'test never submits an order');await reopened.close();
  console.log('PASS: merged Explore navigation, independent filters/search focus, bag counts, legacy routes, product/store/back, guest checkout, city disclosure, staff entry, and authenticated cart reload. All transport mocked; no real orders or bookings.');
})().catch(async error=>{console.error(error);await delay(30);process.exitCode=1;}).finally(()=>windows.forEach(w=>w.close()));
