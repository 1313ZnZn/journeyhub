/* Real Pip modules with isolated, in-memory services: never contacts Supabase. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=file=>fs.readFileSync(__dirname+'/'+file,'utf8');
function payment(){
  const messages=[],calls=[],quote={id:'quote',status:'quoted',totalMinor:4000,items:[{stopId:'museum',kind:'ticket',totalMinor:4000,date:'2027-01-03'}]};
  const record={quote,error:'',receipts:[]};
  const ctx={A:{},V:{'place-plan':()=>({body:''})},state:{route:'orders'},cal:{date:'2027-01-03'},pd:{mode:true},jhUser:{id:'alice'},
    dw:{owner:'alice',busy:false,loaded:true,wallet:{balanceMinor:10000},quotes:{'history:trip':record}},
    dwKey:(type,id)=>type+':'+id,dwPaid:b=>b.status==='simulated_confirmed',dwMoney:n=>'CNY '+(n/100).toFixed(2),dwItemName:()=> 'Museum',dwKinds:{ticket:'Demo ticket'},
    dwCurrent:owner=>ctx.dw===owner&&owner.owner===ctx.jhUser.id,calEvents:()=>[{date:'2027-01-03',manageKind:'history',manageId:'trip'}],
    esc:s=>String(s??''),render(){},setTimeout(){},document:{querySelector:()=>null},window:{matchMedia:()=>({matches:true}),jhPipSync(){},jhPipShowing:()=>true,jhPipOnce:(...v)=>messages.push(v)},
    localStorage:{getItem(){return null},setItem(){},removeItem(){}}};
  ctx.A.dwBook=async()=>{calls.push('book');record.quote={...quote,status:'booked'};record.receipts=[{status:'simulated_confirmed'}];};
  ctx.A.dwTopup=async()=>calls.push('topup');vm.createContext(ctx);vm.runInContext(read('pip-booking.js'),ctx);
  return {ctx,record,quote,messages,calls};
}
async function run(){
  const success=payment();await success.ctx.A.pbPay();assert.deepEqual(success.calls,['book']);assert.equal(success.messages.length,1);
  await success.ctx.A.pbPay();assert.equal(success.calls.length,1,'a saved payment cannot be repeated');
  const low=payment();low.ctx.dw.wallet.balanceMinor=0;await low.ctx.A.pbPay();assert.equal(low.calls.length,0,'insufficient funds never auto-top-up');assert(low.ctx.window.jhPipBookingCard().includes('Open Wallet'));
  const failure=payment();let release;failure.ctx.A.dwBook=()=>{failure.calls.push('book');return new Promise((resolve,reject)=>release=reject);};
  const pending=failure.ctx.A.pbPay();await failure.ctx.A.pbPay();assert(!failure.ctx.window.jhPipBookingCard().includes('is-done'),'no paid tick before confirmation');
  assert.equal(failure.calls.length,1,'double clicks share the in-flight payment');
  release(Error('Connection lost'));await pending;assert(failure.ctx.window.jhPipBookingCard().includes('Connection lost'));
  assert(!failure.ctx.window.jhPipBookingCard().includes('is-paying'));
  failure.ctx.A.dwBook=async()=>{failure.record.quote={...failure.quote,status:'booked'};failure.record.receipts=[];};
  await failure.ctx.A.pbPay();assert.equal(failure.messages.length,1,'a failed payment can be explicitly retried');
  const switched=payment();let finish;switched.ctx.A.dwBook=()=>new Promise(r=>finish=r);const late=switched.ctx.A.pbPay();
  switched.ctx.dw={...switched.ctx.dw,owner:'bob'};switched.ctx.jhUser={id:'bob'};finish();await late;assert.equal(switched.messages.length,0,'old-account completion never speaks in a new account');

  const storage=new Map(),ctx={A:{jpRequirements(){}},state:{route:'journey',role:'traveler'},pd:{busy:true,mode:true},ptu:{task:{id:'saved-task'}},jhUser:{id:'alice'},
    window:{matchMedia:()=>({matches:false,addEventListener(){}})},document:{body:{classList:{toggle(){},remove(){}}},addEventListener(){}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    render(){},go(route){ctx.state.route=route},pdFresh:()=>({mode:false,busy:false}),ptuRetire:task=>task.retired=true,setInterval(){},setTimeout(){},clearTimeout(){},
    cal:{date:'2027-01-03'},calEvents:()=>[],calWeatherCity:()=> 'Shanghai',calWeatherSaved:()=>({days:[{date:'2027-01-03',condition:'Rain',icon:'rain',tempC:20}]}),
    calWeatherInRange:()=>true,esc:s=>String(s??'')};
  vm.createContext(ctx);const source=read('pip.js'),end=source.lastIndexOf('})();');
  vm.runInContext(source.slice(0,end)+'window.weatherForTest=weatherCard;'+source.slice(end),ctx);
  ctx.A.pipNewTrip();assert.equal(ctx.state.route,'journey');assert.equal(ctx.pd.busy,false);assert(ctx.ptu.retired);assert.equal(ctx.ptu.task,null);
  assert(ctx.window.weatherForTest().includes('umbrella'));
  ctx.calWeatherSaved=()=>({days:[{date:'2027-01-03',condition:'Sun',icon:'sun',tempC:30}]});assert(ctx.window.weatherForTest().includes('sunscreen'));
  ctx.calWeatherSaved=()=>({days:[]});assert(ctx.window.weatherForTest().includes('not available'),'no fabricated forecast');
  console.log('PASS feedback: explicit payment, no premature success, repeat-click fence, recoverable errors, account switch, new-trip reset and evidence-based weather advice. All services mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
