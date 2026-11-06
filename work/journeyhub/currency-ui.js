/* Display-only conversion. Catalog, orders, bookings and consent stay in THB. */
const jhFxCodes = Object.freeze(['THB', 'USD', 'CNY', 'SGD']);
const jhFxNames = Object.freeze({THB:'Thai baht',USD:'US dollar',CNY:'Chinese yuan',SGD:'Singapore dollar'});
const jhFxKeys = Object.freeze({selection:'journeyhub.displayCurrency.v1',rates:'journeyhub.fx.THB.v1',attempt:'journeyhub.fxAttempt.v1'});
const jhFxDay = 86400000;
const jhFxEndpoint = 'https://api.frankfurter.dev/v2/rates?base=THB&quotes=USD,CNY,SGD';
// Observed from the public endpoint on 2026-10-25; dates are the API's source dates.
const jhFxFallback = Object.freeze({version:1,base:'THB',fetchedAt:0,rates:Object.freeze({USD:0.02966,CNY:0.19775,SGD:0.03789}),dates:Object.freeze({USD:'2026-10-25',CNY:'2026-10-25',SGD:'2026-10-25'})});
function jhFxRead(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function jhFxWrite(key,value) { try { localStorage.setItem(key,value); } catch (_) { /* The current session still works when storage is unavailable. */ } }
function jhFxDateValid(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value&&value<=new Date().toISOString().slice(0,10);
}
function jhFxValidate(value) {
  if(!value||value.version!==1||value.base!=='THB'||typeof value.fetchedAt!=='number'||!Number.isFinite(value.fetchedAt)||value.fetchedAt<=0||value.fetchedAt>Date.now()+300000)return null;
  const rates={},dates={};
  for(const code of jhFxCodes.slice(1)){
    const rate=value.rates?.[code],date=value.dates?.[code];
    if(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||!jhFxDateValid(date))return null;
    rates[code]=rate;dates[code]=date;
  }
  return {version:1,base:'THB',fetchedAt:value.fetchedAt,rates,dates};
}
function jhFxParseCache(raw) { try { return typeof raw==='string'&&raw.length<4096?jhFxValidate(JSON.parse(raw)):null; } catch (_) { return null; } }
function jhFxAttemptTime(raw) { const n=Number(raw);return Number.isFinite(n)&&n>0&&n<=Date.now()+300000?n:0; }
let jhFxCode=jhFxCodes.includes(jhFxRead(jhFxKeys.selection))?jhFxRead(jhFxKeys.selection):'THB';
let jhFxData=jhFxParseCache(jhFxRead(jhFxKeys.rates))||jhFxFallback;
let jhFxSource=jhFxData===jhFxFallback?'bundled':'saved';
let jhFxAttempt=Math.max(jhFxAttemptTime(jhFxRead(jhFxKeys.attempt)),jhFxData.fetchedAt);
let jhFxPending=null,jhFxRequest=0,jhFxError=false;
function jhFxBaseDisplay(value) {
  const n=Number(value);if(!Number.isFinite(n))return '—';
  return (n<0?'−':'')+'฿'+Math.abs(Math.round(n)).toLocaleString('en-US');
}
function jhBaseMoney(value) {
  const n=Number(value);if(!Number.isFinite(n))return '—';
  return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:2})+' THB';
}
function jhFxBaseOnly() { return state.role==='staff'||state.route==='db'||state.route==='dbt'; }
function jhFxMoney(value,code=jhFxCode) {
  const n=Number(value);if(!Number.isFinite(n))return '—';
  if(code==='THB'||!jhFxCodes.includes(code))return jhFxBaseDisplay(n);
  const amount=n*jhFxData.rates[code];if(!Number.isFinite(amount))return '—';
  return '≈ '+code+' '+(amount<0?'−':'')+Math.abs(amount).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
fmt=function(value){return jhFxBaseOnly()?jhFxBaseDisplay(value):jhFxMoney(value);};
function jhCurrencyText(value) {
  const text=String(value);if(jhFxBaseOnly()||jhFxCode==='THB')return text;
  return text.replace(/([−-]?)฿(\d+(?:,\d{3})*(?:\.\d+)?)/g,(_,sign,amount)=>fmt(Number(amount.replace(/,/g,''))*(sign?-1:1)));
}
function jhFxDateLabel(date) { return new Date(date+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}); }
function jhCurrencyNote() {
  if(jhFxBaseOnly()||jhFxCode==='THB')return 'Base currency · THB';
  return 'Estimates · rates '+jhFxDateLabel(jhFxData.dates[jhFxCode])+' · base THB';
}
function jhFxNewer(next,current) {
  return next.fetchedAt>=current.fetchedAt&&jhFxCodes.slice(1).every(code=>next.dates[code]>=current.dates[code]);
}
function jhFxFromResponse(rows) {
  if(!Array.isArray(rows)||rows.length!==3)return null;
  const rates={},dates={};
  for(const row of rows){
    if(!row||row.base!=='THB'||!jhFxCodes.slice(1).includes(row.quote)||Object.hasOwn(rates,row.quote))return null;
    rates[row.quote]=row.rate;dates[row.quote]=row.date;
  }
  return jhFxValidate({version:1,base:'THB',fetchedAt:Date.now(),rates,dates});
}
function jhFxRefresh() {
  if(jhFxPending)return jhFxPending;
  if(Date.now()-jhFxAttempt<jhFxDay)return Promise.resolve(false);
  jhFxAttempt=Date.now();jhFxWrite(jhFxKeys.attempt,String(jhFxAttempt));
  const request=++jhFxRequest,started=jhFxAttempt,controller=new AbortController();
  jhFxError=false;
  let timeout;
  const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('FX timeout'));},4500);});
  jhFxPending=(async()=>{
    try {
      const rows=await Promise.race([deadline,(async()=>{
        const response=await fetch(jhFxEndpoint,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});
        if(!response.ok)throw new Error('FX unavailable');
        const body=await response.text();if(body.length>16384)throw new Error('Invalid FX response');
        return JSON.parse(body);
      })()]);
      if(request!==jhFxRequest)return false;
      const next=jhFxFromResponse(rows);
      if(!next)throw new Error('Invalid FX rates');
      // A newer cross-tab cache or newer source date wins over a delayed response.
      if(jhFxData.fetchedAt>started||!jhFxNewer(next,jhFxData))return false;
      jhFxData=next;jhFxSource='reference';jhFxWrite(jhFxKeys.rates,JSON.stringify(next));
      return true;
    } catch (_) {
      if(request===jhFxRequest)jhFxError=true;
      return false;
    } finally {
      clearTimeout(timeout);
      if(request===jhFxRequest){jhFxPending=null;if(state.role!=='staff'&&(jhFxCode!=='THB'||state.route==='currency'))render();}
    }
  })();
  return jhFxPending;
}
function jhFxSelect(code) {
  if(!jhFxCodes.includes(code))return false;
  if(jhFxCode!==code){jhFxCode=code;jhFxWrite(jhFxKeys.selection,code);render();}
  if(code!=='THB')jhFxRefresh();
  return true;
}
A.fxCurrency=code=>{if(state.role!=='staff')jhFxSelect(code);};
TAB_OF.currency='me';
function jhFxSwitch() {
  return '<button class="fx-switch" data-act="go" data-a="currency" aria-label="Display currency: '+jhFxNames[jhFxCode]+' ('+jhFxCode+')"><span>'+jhFxCode+'</span>'+ic('down',12)+'</button>';
}
const jhFxHome=V.home;
V.home=function(){
  const v=jhFxHome.apply(this,arguments);if(state.role==='staff')return v;
  const bell='<button class="icon-btn ring"';
  v.bar=v.bar.includes(bell)?v.bar.replace(bell,jhFxSwitch()+bell):v.bar.replace('</header>',jhFxSwitch()+'</header>');
  return v;
};
const jhFxMe=V.me;
V.me=function(){
  const v=jhFxMe.apply(this,arguments);if(state.role==='staff')return v;
  const entry='<section class="stack-8 fx-settings-entry"><h2 class="label">Preferences</h2><div class="list"><button class="li" data-act="go" data-a="currency">'+ic('globe',20)+'<span class="li-main"><span class="li-title">Display currency</span><span class="cap">'+jhFxNames[jhFxCode]+'</span></span><span class="fx-entry-code">'+jhFxCode+'</span>'+ic('right',16)+'</button></div></section>';
  const index=v.body.indexOf('<section');
  v.body=index>=0?v.body.slice(0,index)+entry+v.body.slice(index):v.body.replace(/<\/div>\s*$/,entry+'</div>');
  return v;
};
V.currency=()=>{
  const quote=jhFxCode==='THB'?'USD':jhFxCode,date=jhFxDateLabel(jhFxData.dates[quote]);
  const source=jhFxSource==='reference'?'Reference rates':jhFxSource==='saved'?'Saved rates':'Bundled reference rates';
  const status=jhFxPending?'Checking reference rates…':jhFxError?'Could not refresh. '+source+' from '+date+'.':source+' · '+date;
  return {bar:bar({title:'Display currency'}),tabs:true,body:'<div class="content fx-page"><div class="fx-intro"><span class="fx-mark">'+ic('globe',24)+'</span><h1>Prices, your way.</h1><p>Choose the currency you like to browse in.</p></div><div class="fx-options" role="group" aria-label="Display currency">'+jhFxCodes.map(code=>'<button class="fx-option" data-act="fxCurrency" data-a="'+code+'" aria-pressed="'+(jhFxCode===code)+'"><span class="fx-code">'+code+'</span><span class="fx-option-name"><strong>'+jhFxNames[code]+'</strong><small>'+(code==='THB'?'Original catalog currency':'Estimated conversion')+'</small></span><span class="fx-check" aria-hidden="true">'+(jhFxCode===code?ic('check',14):'')+'</span></button>').join('')+'</div><div class="fx-example"><span>For example</span><strong>'+jhBaseMoney(1000)+' <span>→</span> '+jhFxMoney(1000,quote)+'</strong><small>'+esc(status)+'</small></div><p class="fx-note">Conversions are estimates. Booking and order amounts stay in THB.</p><a class="fx-source" href="https://frankfurter.dev/" target="_blank" rel="noopener noreferrer">Exchange rates by Frankfurter '+ic('right',11)+'</a></div>'};
};
const jhFxPreviousRender=render;
render=function(){jhFxPreviousRender();if(state.role!=='staff'&&(jhFxCode!=='THB'||state.route==='currency'))jhFxRefresh();};
window.addEventListener('storage',event=>{
  if(event.key===jhFxKeys.selection){const next=event.newValue===null?'THB':event.newValue;if(jhFxCodes.includes(next)&&next!==jhFxCode){jhFxCode=next;render();}}
  if(event.key===jhFxKeys.attempt)jhFxAttempt=Math.max(jhFxAttempt,jhFxAttemptTime(event.newValue));
  if(event.key===jhFxKeys.rates){const next=jhFxParseCache(event.newValue);if(next&&jhFxNewer(next,jhFxData)){jhFxData=next;jhFxSource='saved';jhFxError=false;render();}}
});
window.JourneyCurrency=Object.freeze({get code(){return jhFxCode;},get source(){return jhFxSource;},get rateDate(){return jhFxCode==='THB'?null:jhFxData.dates[jhFxCode];},format:jhFxMoney,baseMoney:jhBaseMoney,text:jhCurrencyText,note:jhCurrencyNote,select:jhFxSelect,refresh:jhFxRefresh});
