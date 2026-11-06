/* Display-only currency contract tests. No real network, payments or database writes. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'currency-ui.js'),'utf8');
const keys={selection:'journeyhub.displayCurrency.v1',rates:'journeyhub.fx.THB.v1',attempt:'journeyhub.fxAttempt.v1'};
const now=Date.parse('2026-10-25T12:00:00Z'),day=86400000,windows=[];
const clone=value=>JSON.parse(JSON.stringify(value));
const cache=(extra={})=>({version:1,base:'THB',fetchedAt:now-3600000,rates:{USD:0.031,CNY:0.2,SGD:0.04},dates:{USD:'2026-10-24',CNY:'2026-10-24',SGD:'2026-10-24'},...extra});
const rows=(rates={USD:0.03,CNY:0.21,SGD:0.039},date='2026-10-25')=>Object.entries(rates).map(([quote,rate])=>({base:'THB',quote,rate,date}));
const response=value=>new Response(JSON.stringify(value),{status:200});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function boot({store=new Map(),fetcher=async()=>{throw new Error('Offline');},storageError=false,shortTimeout=false}={}){
  const dom=new JSDOM('<div id="app"></div>',{url:'https://journeyhub.example.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;windows.push(w);
  w.fxNow=now;const OriginalDate=w.Date;w.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[w.fxNow]));}static now(){return w.fxNow;}};
  const calls=[];w.AbortController=AbortController;
  w.fetch=(url,init)=>{calls.push({url,init});assert.equal(url,'https://api.frankfurter.dev/v2/rates?base=THB&quotes=USD,CNY,SGD');assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.headers.Authorization,undefined);return fetcher(url,init);};
  if(shortTimeout){const timer=w.setTimeout.bind(w);w.setTimeout=(fn,ms)=>timer(fn,ms===4500?5:ms);}
  Object.defineProperty(w,'localStorage',{value:{getItem:key=>{if(storageError)throw new Error('Storage blocked');return store.get(key)||null;},setItem:(key,value)=>{if(storageError)throw new Error('Quota exceeded');store.set(key,String(value));}}});
  w.eval(`(function(){
    let fmt=n=>(n<0?'−':'')+'฿'+Math.abs(Math.round(n)).toLocaleString('en-US');
    const state={role:'traveler',route:'home',cart:{silk:2},plan:{stops:['s1']},address:{city:'Shanghai'},saved:{s1:true}};
    const DBC={products:{silk:{price:1400}},sessions:{s1:{price:900}},orders:{o1:{total:2800,currency:'THB'}},bookings:{b1:{totalThb:900}}};
    const ag={run:{planHash:'immutable-hash',version:4,plan:{currency:'THB',totalThb:900}}};
    const A={},TAB_OF={},app=document.querySelector('#app');let renders=0;
    const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const ic=(name,size)=>'<svg aria-hidden="true" width="'+size+'" height="'+size+'"><title>'+name+'</title></svg>';
    const bar=o=>'<header class="bar"><button data-act="back">Back</button><b>'+o.title+'</b></header>';
    const V={home:()=>({bar:'<header class="bar top"><div class="ix-top-left">journey hub.</div><button class="icon-btn ring" data-act="bell">Bell</button></header>',body:'<div>'+fmt(DBC.products.silk.price)+'<input id="home-q" value="tea"></div>'}),me:()=>({bar:bar({title:'Me'}),body:'<div class="content"><div>Profile</div><section>Passport</section><section>Sign out</section></div>'})};
    function render(){renders++;const view=(V[state.route]||V.home)();app.innerHTML=view.bar+view.body;}
    function go(route){state.route=route;render();}
    A.go=go;
    document.addEventListener('click',event=>{const target=event.target.closest('[data-act]');if(target&&A[target.dataset.act])A[target.dataset.act](target.dataset.a);});
    ${source}
    window.TEST={state,DBC,ag,A,V,render,go,get renders(){return renders;},format:n=>fmt(n),base:jhBaseMoney,text:jhCurrencyText,note:jhCurrencyNote};
  })();`);
  return {w,dom,t:w.TEST,api:w.JourneyCurrency,store,calls,app:()=>w.document.querySelector('#app'),close:()=>w.close()};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
  await test('default THB remains the legacy format and makes no FX request',async()=>{
    const h=boot();h.t.render();assert.equal(h.api.code,'THB');assert.equal(h.t.format(1400),'฿1,400');assert.equal(h.t.format(-50.6),'−฿51');assert.equal(h.t.format(0),'฿0');assert.equal(h.calls.length,0);assert.equal(h.t.base(900),'900 THB');assert.equal(h.t.base(900.25),'900.25 THB');assert.equal(h.t.format(Infinity),'—');h.close();
  });
  await test('four currencies use independent THB calculations with no repeated conversion',async()=>{
    const h=boot();h.t.render();h.api.select('USD');assert.equal(h.t.format(1400),'≈ USD 41.52');h.api.select('CNY');assert.equal(h.t.format(1400),'≈ CNY 276.85');h.api.select('SGD');assert.equal(h.t.format(1400),'≈ SGD 53.05');h.api.select('USD');assert.equal(h.t.format(1400),'≈ USD 41.52');assert.equal(h.t.format(-1400),'≈ USD −41.52');assert.equal(h.t.format(0),'≈ USD 0.00');assert.equal(h.t.format(h.t.format(1400)),'—');h.api.select('THB');assert.equal(h.t.format(1400),'฿1,400');await h.api.refresh();h.close();
  });
  await test('selection leaves prices, cart quantities, bookings and approval hash unchanged',async()=>{
    const h=boot(),before=JSON.stringify([h.t.state,h.t.DBC,h.t.ag]);const hash=createHash('sha256').update(before).digest('hex');
    for(const code of ['USD','CNY','SGD','THB'])h.t.A.fxCurrency(code);
    await h.api.refresh();assert.equal(createHash('sha256').update(JSON.stringify([h.t.state,h.t.DBC,h.t.ag])).digest('hex'),hash);assert.equal(h.t.DBC.products.silk.price*h.t.state.cart.silk,2800);assert.equal(h.t.ag.run.planHash,'immutable-hash');h.close();
  });
  await test('preference persists across reload and an offline attempt is not repeated within 24 hours',async()=>{
    const store=new Map(),first=boot({store});first.api.select('USD');await first.api.refresh();assert.equal(store.get(keys.selection),'USD');assert.equal(first.calls.length,1);first.close();
    const second=boot({store});second.t.render();await second.api.refresh();assert.equal(second.api.code,'USD');assert.equal(second.t.format(1000),'≈ USD 29.66');assert.equal(second.calls.length,0);assert.equal(second.api.source,'bundled');assert.equal(second.api.rateDate,'2026-10-25');second.close();
  });
  await test('fresh validated cache is used without fetching and is labelled by source date',async()=>{
    const h=boot({store:new Map([[keys.selection,'USD'],[keys.rates,JSON.stringify(cache())]])});h.t.render();await h.api.refresh();assert.equal(h.t.format(1000),'≈ USD 31.00');assert.equal(h.calls.length,0);assert.equal(h.api.source,'saved');assert(h.t.note().includes('24 Oct 2026'));h.t.go('currency');assert(h.app().textContent.includes('Saved rates · 24 Oct 2026'));h.close();
  });
  await test('successful refresh saves validated THB rates and keeps the API rate date',async()=>{
    const h=boot({fetcher:async()=>response(rows())});h.api.select('USD');assert.equal(await h.api.refresh(),true);assert.equal(h.t.format(1000),'≈ USD 30.00');assert.equal(h.api.source,'reference');assert.equal(h.api.rateDate,'2026-10-25');const saved=JSON.parse(h.store.get(keys.rates));assert.equal(saved.base,'THB');assert.equal(saved.fetchedAt,now);assert.equal(saved.rates.CNY,0.21);assert.equal(h.calls.length,1);await h.api.refresh();assert.equal(h.calls.length,1);h.w.fxNow+=day+1;await h.api.refresh();assert.equal(h.calls.length,2);h.close();
  });
  await test('refresh failure keeps a dated cached rate rather than marking it fresh',async()=>{
    const old=cache({fetchedAt:now-2*day}),h=boot({store:new Map([[keys.selection,'USD'],[keys.rates,JSON.stringify(old)]])});h.t.go('currency');await h.api.refresh();assert.equal(h.t.format(1000),'≈ USD 31.00');assert.equal(JSON.parse(h.store.get(keys.rates)).fetchedAt,old.fetchedAt);assert(h.app().textContent.includes('Could not refresh. Saved rates from 24 Oct 2026.'));h.close();
  });
  await test('invalid, partial, nonpositive, future and non-THB caches fall back safely',async()=>{
    const variants=['broken JSON',JSON.stringify(cache({base:'USD'})),JSON.stringify(cache({rates:{USD:-1,CNY:0.2,SGD:0.04}})),JSON.stringify(cache({rates:{USD:0.03,CNY:0.2}})),JSON.stringify(cache({rates:{USD:'0.03',CNY:0.2,SGD:0.04}})),JSON.stringify(cache({dates:{USD:'2026-02-30',CNY:'2026-10-24',SGD:'2026-10-24'}})),JSON.stringify(cache({dates:{USD:'2027-01-01',CNY:'2026-10-24',SGD:'2026-10-24'}})),JSON.stringify(cache({fetchedAt:now+day}))];
    for(const raw of variants){const h=boot({store:new Map([[keys.selection,'USD'],[keys.rates,raw]])});assert.equal(h.t.format(1000),'≈ USD 29.66');assert.equal(h.api.source,'bundled');h.close();}
    const h=boot({store:new Map([[keys.selection,'<script>']])});assert.equal(h.api.code,'THB');assert.equal(h.api.select('EUR'),false);h.close();
  });
  await test('blocked storage does not break currency selection or offline display',async()=>{
    const h=boot({storageError:true});h.api.select('SGD');await h.api.refresh();assert.equal(h.t.format(1000),'≈ SGD 37.89');assert.equal(h.t.base(1000),'1,000 THB');h.close();
  });
  await test('staff and database views remain in THB while the traveler preference is retained',async()=>{
    const h=boot();h.api.select('CNY');assert.equal(h.t.format(1000),'≈ CNY 197.75');h.t.state.role='staff';assert.equal(h.t.format(1000),'฿1,000');h.t.A.fxCurrency('USD');assert.equal(h.api.code,'CNY');h.t.state.role='traveler';for(const route of ['db','dbt']){h.t.state.route=route;assert.equal(h.t.format(1000),'฿1,000');assert.equal(h.t.note(),'Base currency · THB');}h.t.state.route='home';assert.equal(h.t.format(1000),'≈ CNY 197.75');await h.api.refresh();h.close();
  });
  await test('static copy converts only a returned display string and remains stable on a second pass',async()=>{
    const h=boot(),copy='Entry about ฿200 per person; ฿1,400.50 total; refund −฿200.';h.api.select('USD');const shown=h.t.text(copy);assert.equal(shown,'Entry about ≈ USD 5.93 per person; ≈ USD 41.54 total; refund ≈ USD −5.93.');assert.equal(h.t.text(shown),shown);assert.equal(copy,'Entry about ฿200 per person; ฿1,400.50 total; refund −฿200.');h.api.select('THB');assert.equal(h.t.text(copy),copy);await h.api.refresh();h.close();
  });
  await test('home and Me expose compact navigation without removing existing features',async()=>{
    const h=boot();h.t.render();assert.equal(h.app().querySelectorAll('.fx-switch').length,1);assert(h.app().querySelector('[data-act="bell"]'));h.app().querySelector('.fx-switch').click();assert.equal(h.t.state.route,'currency');const options=h.app().querySelectorAll('[data-act="fxCurrency"]');assert.equal(options.length,4);options[1].click();assert.equal(h.api.code,'USD');assert.equal(h.app().querySelector('[data-a="USD"]').getAttribute('aria-pressed'),'true');assert(h.app().textContent.includes('Booking and order amounts stay in THB'));h.t.go('me');assert(h.app().querySelector('.fx-settings-entry'));assert(h.app().textContent.includes('Passport'));assert(h.app().textContent.includes('Sign out'));await h.api.refresh();h.close();
  });
  await test('only one in-flight request is allowed and a delayed response cannot overwrite a newer cross-tab cache',async()=>{
    const wait=deferred(),h=boot({fetcher:()=>wait.promise});h.api.select('USD');const first=h.api.refresh(),second=h.api.refresh();assert.equal(first,second);assert.equal(h.calls.length,1);
    h.w.fxNow+=1000;const newer=cache({fetchedAt:h.w.fxNow,rates:{USD:0.04,CNY:0.25,SGD:0.05},dates:{USD:'2026-10-25',CNY:'2026-10-25',SGD:'2026-10-25'}});
    h.t.go('currency');h.w.dispatchEvent(new h.w.StorageEvent('storage',{key:keys.rates,newValue:JSON.stringify(newer)}));assert.equal(h.t.format(1000),'≈ USD 40.00');wait.resolve(response(rows()));await first;assert.equal(h.t.format(1000),'≈ USD 40.00');assert.equal(h.api.source,'saved');assert(!h.app().textContent.includes('Checking reference rates'));h.close();
  });
  await test('older source dates, duplicate quotes and invalid API numbers never replace known rates',async()=>{
    for(const data of [rows(undefined,'2026-10-24'),[...rows().slice(0,2),rows()[0]],rows({USD:0,CNY:0.2,SGD:0.04}),rows({USD:null,CNY:0.2,SGD:0.04})]){
      const h=boot({fetcher:async()=>response(data)});h.api.select('USD');assert.equal(await h.api.refresh(),false);assert.equal(h.t.format(1000),'≈ USD 29.66');assert.equal(h.store.has(keys.rates),false);h.close();
    }
  });
  await test('timeout bounds even a fetch that ignores cancellation and keeps fallback labelled',async()=>{
    const h=boot({fetcher:()=>new Promise(()=>{}),shortTimeout:true});h.api.select('USD');assert.equal(await h.api.refresh(),false);assert.equal(h.calls[0].init.signal.aborted,true);assert.equal(h.t.format(1000),'≈ USD 29.66');h.t.go('currency');assert(h.app().textContent.includes('Bundled reference rates from 25 Oct 2026'));h.close();
  });
  await test('cross-tab preferences update display without altering business values',async()=>{
    const h=boot(),before=JSON.stringify(h.t.DBC);h.t.render();h.w.dispatchEvent(new h.w.StorageEvent('storage',{key:keys.selection,newValue:'SGD'}));assert.equal(h.t.format(1000),'≈ SGD 37.89');h.w.dispatchEvent(new h.w.StorageEvent('storage',{key:keys.selection,newValue:'THB'}));assert.equal(h.t.format(1000),'฿1,000');assert.equal(JSON.stringify(h.t.DBC),before);await h.api.refresh();h.close();
  });
  await settle();console.log(`${passed} currency tests passed. All exchange-rate responses mocked; no real money or database operations.`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>windows.forEach(w=>w.close()));
