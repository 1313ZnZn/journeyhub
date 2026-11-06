const fs=require('node:fs'),{JSDOM,VirtualConsole}=require('jsdom'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase');
const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
const dom=new JSDOM(html,{url:'http://localhost:4173/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
const w=dom.window;w.fetch=async(input,init={})=>{const url=String(input?.url||input);if(url.includes('/functions/v1/journeyhub-agent')){assert.notEqual(init.method,'POST','core UI checks must never generate a real AI plan');return new Response(JSON.stringify({ai:{ready:false,provider:'deepseek',model:'deepseek-chat'},email:{ready:false,provider:''},worker:{ready:false},booking:{mode:'journeyhub_catalog',sample:true}}));}return fetch(input,init);};w.Headers=global.Headers;w.Request=global.Request;w.Response=global.Response;w.TextEncoder=global.TextEncoder;w.TextDecoder=global.TextDecoder;w.AbortController=global.AbortController;w.WebSocket=global.WebSocket;
Object.defineProperty(w,'crypto',{value:require('node:crypto').webcrypto});
w.eval(fs.readFileSync(path.join(out,'vendor/supabase.js'),'utf8'));
w.eval(fs.readFileSync(path.join(out,'config.js'),'utf8'));
let script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean).join('\n');
script=script.replace('jhStart();','window.JH_TEST={get live(){return !jhLoading&&!!jhLastSnapshot},get state(){return state},get DBC(){return DBC},get errors(){return jhLastError},get A(){return A},get V(){return V},get TT(){return TT},get TAB_OF(){return TAB_OF},get ui(){return ui},get sb(){return sb},go,render,jhRefresh,jhLoadUser,doLogin,signOut,jhFlush,catalogFor,homeResults};jhStart();');
w.eval(script);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  for(let i=0;i<60&&!w.JH_TEST.live;i++)await delay(500);
  await delay(300);
  const t=w.JH_TEST;
  const app=()=>w.document.querySelector('#app');
  const assertScreen=label=>assert(!app().textContent.includes('Something went wrong'),label+' must render');
  const visit=(route,params={})=>{assert.equal(typeof t.V[route],'function',route+' must remain registered');t.state.role='traveler';t.state.guestOk=true;t.go(route,params);assertScreen(route);};
  assert.equal(t.errors,'','bootstrap must reach live Supabase');
  assert.equal(t.state.route,'journey','travelers land on Journey after startup');
  assert(app().querySelector('[data-ch="agCity"]'),'destination is editable on the landing page');
  assert(app().querySelector('[data-ch="agDate"]'),'date is editable on the landing page');
  assert(app().querySelector('#ag-prompt'),'trip requirements are editable on the landing page');
  assert(app().querySelector('[data-act="jpRequirements"]'),'landing page continues to place selection');
  assert(!app().querySelector('.ix-ai-entry'),'no extra click-through to reach the AI form');
  assert(!app().querySelector('.jh-home-options').open,'advanced preferences are collapsed');
  assert(app().innerHTML.indexOf('id="ag-prompt"')<app().innerHTML.indexOf('data-a="memories"'),'memories follow the planning form');
  assert(!app().querySelector('.bar [data-a="planner"]'),'legacy planner is absent from the top bar');
  assert(!app().textContent.includes('Bangkok planner'),'landing page does not promote the legacy planner');
  assert.equal(app().querySelectorAll('[data-act="jhHomeCity"]').length,3,'three interactive destination cards');
  app().querySelector('[data-act="jhHomeCity"][data-a="Singapore"]').click();
  assert.equal(app().querySelector('[data-ch="agCity"]').value,'Singapore','photo cards update the real AI destination');
  const homePrompt=app().querySelector('#ag-prompt');homePrompt.value='Keep my custom request';homePrompt.dispatchEvent(new w.Event('input',{bubbles:true}));
  app().querySelector('[data-act="jhHomeVibe"][data-a="Local food"]').click();
  assert.equal(app().querySelector('#ag-prompt').value,'Keep my custom request\nLocal food','interest adds to custom text');
  app().querySelector('[data-act="jhHomeVibe"][data-a="Local food"]').click();
  assert.equal(app().querySelector('#ag-prompt').value,'Keep my custom request','interest toggles without erasing custom text');
  assert(!app().querySelector('[data-act="jpPicks"]'),'no independent swipe entry before requirements'); t.A.pdCatalog(); assert.equal(t.state.route,'ai-picks'); assert(app().querySelector('[data-act="jpFinish"]'),'place selection can finish without revisiting the form');
  visit('home');app().querySelector('[data-a="reserved-trips"]').click();assert.equal(t.state.route,'reserved-trips');
  assert.equal(t.TAB_OF['reserved-trips'],'orders','reserved trips belong to Bookings');
  assert.equal(Object.keys(t.DBC.orders).length,0,'guest cannot see seed orders');
  assert(Object.values(t.DBC.experiences).filter(e=>e.details?.photo).length>=36,'new catalog records retain image metadata');
  for(const route of ['home','shop','journey','planner','me','db','map','bag','checkout','orders','vat'])visit(route);
  visit('product',{id:'tote'});visit('dbt',{id:'stores'});
  assert.deepEqual(Array.from(t.TT,row=>row[0]),['journey','home','orders','me'],'Journey leads four primary tabs; Shop is inside Explore');
  visit('me');
  for(const route of ['home','journey','orders','me'])assert(app().querySelector('[data-act="tab"][data-a="'+route+'"]'),'visible primary tab: '+route);
  for(const city of ['Shanghai','Singapore','Bangkok']){
    t.A.destination(city);
    const cityExperiences=Object.values(t.DBC.experiences).filter(e=>e.city===city);
    assert(cityExperiences.length>=15,city+' must offer an expanded catalog');
    const cards=[...w.document.querySelectorAll('.xcard')];assert.equal(cards.length,cityExperiences.length,'home cards match the live '+city+' catalog');
    assert.equal(Number(app().querySelector('[data-act="jcOpen"]')?.textContent.match(/\d+/)?.[0]),cityExperiences.length,'home count matches the live '+city+' catalog');
    cards.forEach(c=>assert.equal(t.DBC.experiences[c.dataset.b].city,city));
    const ids=Object.values(t.DBC.experiences).filter(e=>e.city===city&&e.details.sample).map(e=>e.id);
    for(const id of ids){
      const experience=t.DBC.experiences[id];
      t.go('exp',{id});if(!experience.details.browseOnly)assert(w.document.querySelector('#app').textContent.includes('THB'));
      assert(!w.document.querySelector('#app').textContent.includes('Something went wrong'));
      assert(w.document.querySelector('a[href*="google.com/maps/search"]'));
      if(experience.details.source)assert([...app().querySelectorAll('a[href]')].some(a=>a.getAttribute('href')===experience.details.source&&a.textContent.includes('Official visitor information')),id+' links to official visitor information');
      if(experience.details.photo){
        const photo=experience.details.photo;
        assert(photo.image&&photo.alt&&photo.credit&&photo.source&&photo.license&&photo.licenseUrl,id+' photo keeps provenance and reuse terms');
        assert.equal(app().querySelector('.cover img')?.getAttribute('src'),photo.image,id+' detail uses its own place image');
        assert.equal(app().querySelector('.cover img')?.getAttribute('alt'),photo.alt,id+' photo has a meaningful description');
        const links=[...app().querySelectorAll('a[href]')];
        assert(links.some(a=>a.getAttribute('href')===photo.source&&a.textContent.includes(photo.credit)),id+' renders the photo credit/source');
        assert(links.some(a=>a.getAttribute('href')===photo.licenseUrl&&a.textContent.includes(photo.license)),id+' renders the image license');
        assert(app().textContent.includes('Sample itinerary')||experience.details.browseOnly,id+' preserves sample labeling');
      }
      const slot=Object.values(t.DBC.sessions).find(s=>s.exp===id);
      if(experience.details.browseOnly){
        assert(!slot,'browse-only locations must not expose bookable sessions');
        assert(!app().querySelector('[data-act="book"]'),'browse-only locations must not offer booking');
        continue;
      }
      assert(slot,id+' has a sample session');
      assert.equal(slot.start,new Intl.DateTimeFormat('en-GB',{timeZone:experience.timeZone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(slot.startsAt)));
      const book=w.document.querySelector('[data-act="book"]');assert(book);book.click();assert(w.document.querySelector('#lg-email'),'guest booking requires sign-in');
    }
    t.A.destination(city);assert(!/\p{Script=Han}/u.test(app().textContent),'English-only city interface');
    const search=app().querySelector('[data-in="homeQuery"]');assert(search,'destination search remains available');
    // Exercise the delegated input listener and REGIONS callback, not just the latest function binding.
    search.value=city==='Shanghai'?'Food':city==='Singapore'?'Chinatown':'Thai';search.dispatchEvent(new w.Event('input',{bubbles:true}));
    const results=[...app().querySelectorAll('[data-region="homeResults"] [data-a="exp"]')];
    assert(results.length,'typed destination search returns experiences');
    results.forEach(result=>assert.equal(t.DBC.experiences[result.dataset.b].city,city,'typed search must stay in the selected city'));
    search.value='walk';search.dispatchEvent(new w.Event('input',{bubbles:true}));
    [...app().querySelectorAll('[data-region="homeResults"] [data-a="exp"]')].forEach(result=>assert.equal(t.DBC.experiences[result.dataset.b].city,city,'shared search keyword must not leak another city'));
    for(const item of Object.values(t.catalogFor(1)).filter(x=>x.kind==='exp'))assert.equal(t.DBC.experiences[item.exp].city,'Bangkok','planner must not cross cities');
  }
  // Catalog controls operate on live public data and update only the results region.
  // Exercise native delegated events so a focus/caret regression is detectable.
  t.A.destination('Bangkok');
  const openCatalog=app().querySelector('[data-act="jcOpen"]');assert(openCatalog,'home offers the full catalog');openCatalog.click();
  assert.equal(t.state.route,'catalog');assert.equal(t.TAB_OF.catalog,'home','catalog belongs to the original Explore tab');
  const catalogCards=()=>[...app().querySelectorAll('[data-region="jcResults"] .jc-grid .xcard')];
  const catalogRows=()=>catalogCards().map(card=>t.DBC.experiences[card.dataset.b]);
  const catalogAction=(action,value)=>{const el=app().querySelector('[data-act="'+action+'"]'+(value===undefined?'':'[data-a="'+value+'"]'));assert(el,action+' '+(value||'')+' control exists');el.click();assertScreen('catalog '+action);};
  const changeSort=value=>{const el=app().querySelector('[data-ch="jcSort"]');assert(el,'catalog sorting remains available');el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(el.value,value);};
  const searchCatalog=value=>{
    const input=app().querySelector('[data-in="jcSearch"]');assert(input,'catalog search is available');input.focus();input.value=value;input.setSelectionRange(value.length,value.length);input.dispatchEvent(new w.Event('input',{bubbles:true}));
    assert.equal(app().querySelector('[data-in="jcSearch"]'),input,'typing must retain the same native search input');
    assert.equal(w.document.activeElement,input,'typing must retain focus');assert.equal(input.selectionStart,value.length,'typing must retain the caret');
    return input;
  };
  for(const city of ['Bangkok','Shanghai','Singapore']){
    catalogAction('jcCity',city);
    const expected=Object.values(t.DBC.experiences).filter(e=>e.city===city);
    assert.equal(catalogCards().length,expected.length,'full catalog exposes all '+city+' experiences');
    catalogRows().forEach(e=>assert.equal(e.city,city));
    catalogAction('jcCategory','culture');
    assert(catalogRows().length,'expanded '+city+' catalog includes culture');
    catalogRows().forEach(e=>{assert.equal(e.city,city);assert(e.cats.includes('culture'),'category filter excludes other categories');});
    catalogAction('jcCategory','all');
    // Native clicks and typing happen in separate browser tasks. Let the explicit
    // click token expire before simulating an unrelated background refresh.
    await delay(0);
    const target=expected.find(e=>e.name.toLowerCase().includes(city.toLowerCase()))||expected[0];
    const term=target.name.split(/\s+/)[0];
    const focused=searchCatalog(term);
    assert(catalogRows().length,'catalog search returns matching places');
    catalogRows().forEach(e=>{assert.equal(e.city,city);assert([e.name,e.details?.en,e.kind,e.venue,e.city,...e.does,...e.cats].join(' ').toLowerCase().includes(term.toLowerCase()),'search cards match the typed query');});
    t.render();assert.equal(w.document.activeElement,focused,'background redraw cannot replace focused catalog search');
    searchCatalog('journeyhub-no-such-place-78294');assert.equal(catalogCards().length,0,'unmatched query has an empty state');
    searchCatalog('');assert.equal(catalogCards().length,expected.length,'clearing search restores city catalog');
    for(const key of ['name','duration','price','curated']){
      changeSort(key);const rows=catalogRows();assert.equal(rows.length,expected.length,'sorting preserves all city records');
      for(let i=1;i<rows.length;i++){
        if(key==='name')assert(rows[i-1].name.localeCompare(rows[i].name,'en')<=0,'name order is alphabetical');
        if(key==='price')assert(rows[i-1].price<=rows[i].price,'price order is ascending');
        if(key==='duration')assert(parseFloat(rows[i-1].dur)<=parseFloat(rows[i].dur),'duration order is ascending');
      }
    }
    catalogAction('jcCategory','culture');searchCatalog('unmatched-query');catalogAction('jcReset');
    assert.equal(app().querySelector('[data-in="jcSearch"]').value,'','reset clears search');
    assert.equal(catalogCards().length,expected.length,'reset clears category and restores current city');
    assert(!/\p{Script=Han}/u.test(app().textContent),'catalog interface remains English-only');
  }
  t.A.destination('Bangkok');
  t.go('exp',{id:'craft'});assert(w.document.body.textContent.includes('Thai Craft Lab'));
  t.A.addQuick('tote');assert.equal(t.state.cart.tote,1);
  const cartBefore=JSON.stringify(t.state.cart);
  for(const route of ['ai','ai-plan','ai-tasks','ai-email','ai-review','ai-history','saved','city-map'])visit(route);
  for(const city of ['Shanghai','Singapore','Bangkok'])t.A.destination(city);
  assert.equal(JSON.stringify(t.state.cart),cartBefore,'AI navigation and destination changes preserve the original bag');
  visit('bag');assert(app().querySelector('[data-act="cartRemove"][data-a="tote"]'),'original bag item controls remain');
  visit('checkout');assert(app().querySelector('[data-ch="method"][value="hotel"]'),'hotel delivery remains');assert(app().querySelector('[data-ch="method"][value="intl"]'),'international shipping remains');
  for(const mode of ['hotel','intl']){t.A.addr(mode);assert(app().querySelector('[data-form="address"]'),'address form: '+mode);t.A.closeSheet();assert.equal(t.state.route,'checkout');}
  visit('me');t.A.passport();assert(app().querySelector('[data-form="passport"]'),'passport form remains');t.A.closeSheet();
  visit('planner');
  t.A.buildPlan();assert.equal(t.state.route,'plan','original planner still opens its result');assertScreen('original plan');
  assert(t.state.plan.generated,'original plan is generated');
  t.A.savePlan();assert.equal(t.state.route,'journey','original itinerary saves to Journey');assert(t.state.plan.savedStops?.length,'saved original itinerary contains stops');
  const originalStops=JSON.stringify(t.state.plan.savedStops);
  for(const route of ['ai','ai-plan','ai-tasks'])visit(route);
  assert.equal(JSON.stringify(t.state.plan.savedStops),originalStops,'AI screens preserve the original saved itinerary');
  const candidate=Object.values(t.DBC.sessions).find(s=>t.DBC.experiences[s.exp]?.city==='Shanghai'&&s.day>=0&&s.day<=6&&!s.closed&&s.cap-s.held-s.taken>=2);
  assert(candidate,'Shanghai has an available preview session');
  const candidateDate=new Intl.DateTimeFormat('en-CA',{timeZone:candidate.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(candidate.startsAt));
  visit('ai');
  for(const [name,value] of [['agCity','Shanghai'],['agDate',candidateDate],['agGuests',2]]){
    const select=app().querySelector('[data-ch="'+name+'"]');assert(select,'AI preference control: '+name);select.value=String(value);select.dispatchEvent(new w.Event('change',{bubbles:true}));
  }
  t.A.agPrompt('Culture first');t.A.agPreview();assert.equal(t.state.route,'ai-plan');assertScreen('populated sample itinerary');
  const sessionLink=app().querySelector('[data-act="ixSession"]');assert(sessionLink,'AI itinerary retains original session review entry');
  const previewSessionId=sessionLink.dataset.a;sessionLink.click();
  assert.equal(t.state.route,'exp');assert.equal(t.state.expSel[t.DBC.sessions[previewSessionId].exp].slot,previewSessionId,'AI review selects the original live session');
  visit('ai-plan');t.A.ixSave();assert.equal(t.state.route,'journey');
  assert.equal(t.state.plan.aiDraft.city,'Shanghai');assert.equal(t.state.plan.aiDraft.guests,2);assert(t.state.plan.aiDraft.stops.length,'AI draft is saved separately');
  for(const id of t.state.plan.aiDraft.stops)assert.equal(t.DBC.experiences[t.DBC.sessions[id].exp].city,'Shanghai','AI preview stays in its chosen city');
  assert.equal(JSON.stringify(t.state.plan.savedStops),originalStops,'saving AI draft never replaces original saved stops');
  visit('ai');
  for(const [name,value] of [['agCity','Singapore'],['agDate','2030-01-01'],['agGuests',6]]){const select=app().querySelector('[data-ch="'+name+'"]');select.value=String(value);select.dispatchEvent(new w.Event('change',{bubbles:true}));}
  visit('ai-plan');const edit=app().querySelector('[data-act="ixEdit"]');assert(edit,'draft preference editor remains available');edit.click();
  assert.equal(app().querySelector('[data-ch="agCity"]').value,'Shanghai','editing an existing itinerary restores its destination');
  assert.equal(app().querySelector('[data-ch="agDate"]').value,candidateDate,'editing an existing itinerary restores its absolute date');
  assert.equal(app().querySelector('[data-ch="agGuests"]').value,'2','editing an existing itinerary restores its guest count');
  visit('ai-tasks');assert(app().querySelector('[data-act="ixSession"]'),'trip tasks link to actual session review');
  t.A.ixReminder();assert(app().textContent.includes('Not scheduled'),'reminder preview does not claim an email was scheduled');
  visit('ai-email');assert(app().textContent.includes('Nothing has been sent or scheduled'),'email is clearly a preview');
  visit('ai-plan');const beforeRemove=app().querySelectorAll('[data-act="ixRemove"]').length;
  app().querySelector('[data-act="ixRemove"]').click();assert.equal(app().querySelectorAll('[data-act="ixRemove"]').length,beforeRemove-1,'AI draft stop can be removed');
  assert.equal(JSON.stringify(t.state.plan.savedStops),originalStops,'editing AI draft never changes original saved stops');
  assert.equal(JSON.stringify(t.state.cart),cartBefore,'planning preserves the original bag');
  t.A.signInPrompt();assert(w.document.querySelector('#lg-email'));assert(!w.document.querySelector('#app').textContent.includes('Demo account'));
  if(process.argv.includes('--auth')){
    const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'test-fixtures.json')));
    let u=fixture.users[0];t.ui.loginDraft={email:u.email,password:u.password};await t.doLogin('traveler-signin');
    assert(t.state.auth.traveler,'authenticated traveler');
    t.state.saved={craft:true,silk:true};await t.jhFlush();
    await t.jhRefresh(true);assert(t.state.saved.silk,'preferences persisted');
    await t.signOut();assert.equal(t.state.auth.traveler,null);
    t.go('login',{mode:'staff'});u=fixture.users[2];t.ui.loginDraft={email:u.email,password:u.password};await t.doLogin('staff-signin');
    assert.equal(t.state.auth.staff.role,'coordinator');
    for(const route of ['s-today','s-orders','s-sessions','s-session','s-insights','s-compare','s-plan']){
      t.state.role='staff';t.state.route=route;t.state.params={};t.render();assert(!w.document.querySelector('#app').textContent.includes('Something went wrong'),route);
    }
    t.state.route='s-order';t.state.params={id:'JH-1025'};t.render();
    assert(!w.document.querySelector('#app').textContent.includes('Something went wrong'),'staff order details');
    await t.signOut();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: expanded guest live catalog, city/category/search/sort/reset and focus stability, place-photo credits, browse-only booking exclusion, original routes/tabs/forms, bag and itinerary preservation, AI draft build/edit/save/remove/session review, reminder preview, and sign-in gate; no console errors'+(process.argv.includes('--auth')?'; authenticated login/logout, preference persistence and staff screens also verified.':'. No authenticated writes performed.'));
  w.close();
})().catch(e=>{console.error(e,errors);w.close();process.exitCode=1;});
