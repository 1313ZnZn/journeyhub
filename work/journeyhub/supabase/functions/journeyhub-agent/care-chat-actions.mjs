// Read/quote adapters only. The model never receives a debit, top-up, cancellation
// or real-payment tool. Explicit confirmation uses the existing atomic SQL flow.
import {demoAction,demoPrice} from './demo-wallet.mjs';
import {fail,estimateTravel} from './planner.mjs';
import {protectedStopIds} from './care-readiness.mjs';
const short=(v,n=180)=>typeof v==='string'?v.slice(0,n):'';
const paid=b=>b?.paymentStatus==='simulated_paid'&&['confirmed','checked_in','simulated_confirmed'].includes(b.canonicalStatus||b.status);
const money=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000000;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
const english=v=>typeof v==='string'&&v.length<=240&&/[A-Za-z]/.test(v)&&!/[<>\p{Script=Han}\p{Script=Thai}\u0000-\u001f]/u.test(v);
export const explicitlyCompleted=(row,id)=>{
 const stop=row.plan.stops.find(s=>(s.id||s.sessionId)===id);
 return !!stop&&(['completed','visited'].includes(stop.status)||stop.completed===true||typeof stop.completedAt==='string'&&Number.isFinite(Date.parse(stop.completedAt)));
};
const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const time=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
export function unchangedProtectedTransfer(row,a,b){
 const fixed=protectedStopIds(row);for(const s of row.plan.stops)if(explicitlyCompleted(row,s.id))fixed.add(s.id);
 if(!fixed.has(a.id)||!fixed.has(b.id)||a.dayIndex!==b.dayIndex)return false;
 const old=row.plan.stops.filter(p=>p.dayIndex===a.dayIndex).sort((x,y)=>x.start.localeCompare(y.start)),index=old.findIndex(p=>p.id===a.id),x=old[index],y=old[index+1];
 return x&&y?.id===b.id&&x.start===a.start&&x.end===a.end&&y.start===b.start&&y.end===b.end;
}
export function packDaySwap(row,places,firstDay,secondDay,suggestedStops,requiredTransfers={}){
 const days=[firstDay,secondDay],fixed=protectedStopIds(row),all=row.plan.stops;
 for(const stop of all)if(explicitlyCompleted(row,stop.id))fixed.add(stop.id);
 if(suggestedStops!=null&&(!Array.isArray(suggestedStops)||suggestedStops.some(p=>!all.some(s=>s.id===p?.id))))return{ok:false,message:'Use only saved itinerary visits for the swap.'};
 const proposed=new Map((suggestedStops||[]).map(p=>[p.id,p]));
 const flexible=all.filter(p=>days.includes(p.dayIndex)&&!fixed.has(p.id));
 const scheduled=all.filter(p=>!days.includes(p.dayIndex)||fixed.has(p.id)).map(p=>({id:p.id,dayIndex:p.dayIndex,start:p.start,end:p.end}));
 const transfer=(a,b)=>a&&b?Math.max(requiredTransfers[a.id+'|'+b.id]||0,estimateTravel(places[a.id]||a,places[b.id]||b,row.input.transport).durationMinutes+10):0;
 const begin=minutes(row.input.dayStart||'08:00'),finish=minutes(row.input.dayEnd||'22:00');
 const fit=(stop,day,preferred)=>{
  const duration=minutes(stop.end)-minutes(stop.start),evening=minutes(stop.start)>=18*60,earliestPreference=evening?18*60:begin,anchors=scheduled.filter(p=>p.dayIndex===day).sort((a,b)=>a.start.localeCompare(b.start));
  if(evening)preferred=Math.max(preferred,minutes(stop.start));
  for(const honorPreference of [true,false])for(let i=0;i<=anchors.length;i++){
   const previous=anchors[i-1],next=anchors[i],earliest=previous?minutes(previous.end)+transfer(previous,stop):begin,
    latest=next?minutes(next.start)-transfer(stop,next):finish,start=Math.max(earliest,honorPreference?preferred:earliestPreference);
   if(start+duration<=latest){scheduled.push({id:stop.id,dayIndex:day,start:time(start),end:time(start+duration)});return true;}
  }
  return false;
 };
 const deferred=[];
 for(const stop of flexible.sort((a,b)=>(proposed.get(a.id)?.start||a.start).localeCompare(proposed.get(b.id)?.start||b.start))){
  const suggestion=proposed.get(stop.id),day=suggestion&&days.includes(suggestion.dayIndex)?suggestion.dayIndex:stop.dayIndex===firstDay?secondDay:firstDay,
   preferred=suggestion&&typeof suggestion.start==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(suggestion.start)?minutes(suggestion.start):minutes(stop.start);
  if(!fit(stop,day,preferred))deferred.push(stop);
 }
 // If the destination cannot hold every flexible visit, keep the remainder on
 // its original day. This is an explicit partial swap; no visit is dropped.
 for(const stop of deferred)if(!fit(stop,stop.dayIndex,minutes(stop.start)))return{ok:false,message:'The flexible visits do not fit around the reserved slots within your active hours.',issues:all.filter(p=>days.includes(p.dayIndex)&&fixed.has(p.id)).map(p=>({id:p.id,name:places[p.id]?.name,day:p.dayIndex,start:p.start,end:p.end,protected:true}))};
 if(!scheduled.some(p=>p.dayIndex!==all.find(s=>s.id===p.id).dayIndex))return{ok:false,message:'The reserved slots leave no room to move a flexible visit between these days.',issues:all.filter(p=>days.includes(p.dayIndex)&&fixed.has(p.id)).map(p=>({id:p.id,name:places[p.id]?.name,day:p.dayIndex,start:p.start,end:p.end,protected:true}))};
 return{ok:true,stops:scheduled.sort((a,b)=>a.dayIndex-b.dayIndex||a.start.localeCompare(b.start))};
}
export async function readTripWallet(row,ctx){
 const {wallet}=await demoAction({...ctx,value:{action:'demo_state'}});
 if(wallet?.currency!=='CNY'||!money(wallet.balanceMinor)||!Array.isArray(wallet.bookings))fail('WALLET_UNAVAILABLE','Your virtual wallet could not be read. Please retry.',503);
 const ids=new Set(row.plan.stops.map(s=>s.id||s.sessionId)),records=wallet.bookings.filter(b=>b.sourceType===row.sourceType&&b.sourceId===row.sourceId&&ids.has(b.stopId));
 const bookings=(row.canonicalBookings||[]).filter(b=>ids.has(b.stopId)).map(b=>{
  const receipt=records.find(r=>r.bookingId===b.bookingId)||{};
  return {stopId:b.stopId,bookingId:b.bookingId,status:b.status,paymentStatus:b.paymentStatus,simulated:!!b.simulated,quoteId:receipt.quoteId||null,amountMinor:receipt.amountMinor??b.amountMinor??null,quantity:receipt.quantity??b.guests??null,date:receipt.date||null};
 });
 return {currency:'CNY',balanceMinor:wallet.balanceMinor,bookings,paidCount:bookings.filter(paid).length,unpaidCount:bookings.filter(b=>['confirmed','checked_in'].includes(b.status)&&!paid(b)).length,simulated:true};
}
export async function prepareVirtualPayment(row,places,scope,ctx){
 if(!['existing_reservations','trip'].includes(scope))fail('INVALID_INPUT','Choose existing reservations or the saved trip.');
 const wallet=await readTripWallet(row,ctx),active=wallet.bookings.filter(b=>['confirmed','checked_in'].includes(b.status));
 if(scope==='existing_reservations'&&!active.length)return{ok:false,wallet,message:'There are no existing reservations for this trip. Ask whether to prepare a virtual quote for the planned visits.'};
 const chargeable=row.plan.stops.filter(s=>demoPrice(places[s.id||s.sessionId],s).unitMinor>0).map(s=>s.id||s.sessionId);
 const covered=scope==='existing_reservations'?active.length>0&&active.every(paid):chargeable.length>0&&chargeable.every(id=>active.some(b=>b.stopId===id&&paid(b)));
 if(covered){
  const quoteId=active.find(b=>paid(b)&&uuid(b.quoteId))?.quoteId||null;
  return {ok:true,alreadyPaid:true,wallet,quoteId,totalMinor:0,message:'These reservations already have recorded virtual payments. No additional credits will be deducted.'};
 }
 if(scope==='existing_reservations')return{ok:false,wallet,message:'Some existing reservations do not have a recorded virtual payment. The available checkout prepares the whole itinerary and could add new reservations. Ask whether to review a full-trip quote; do not silently expand this request.'};
 const result=await demoAction({...ctx,value:{action:'demo_quote',...(row.sourceType==='history'?{historyId:row.sourceId}:{runId:row.sourceId})}}),q=result.quote;
 if(!q||!uuid(q.id)||q.currency!=='CNY'||!money(q.totalMinor))fail('DEMO_INVALID_ITEMS','The virtual budget could not be verified.',409);
 return {ok:true,alreadyPaid:false,quoteId:q.id,totalMinor:q.totalMinor,currency:'CNY',balanceMinor:result.wallet?.balanceMinor??wallet.balanceMinor,items:(q.items||[]).map(i=>({stopId:i.stopId,title:short(i.title||i.displayTitle),quantity:i.quantity,totalMinor:i.totalMinor,amountDueMinor:i.amountDueMinor,bookingId:i.bookingId||null,kind:i.kind})),expiresAt:q.expiresAt,simulated:true};
}
export function paymentView(raw){
 if(!raw||raw.simulated!==true||!uuid(raw.quoteId)||raw.currency!=='CNY'||!money(raw.totalMinor)||!money(raw.balanceMinor)||!money(raw.shortfallMinor)||!['ready','insufficient_funds','paid','expired','stale','not_eligible','no_payment_needed'].includes(raw.status)||!Array.isArray(raw.items)||raw.items.length>16)return null;
 if(typeof raw.expiresAt!=='string'||!Number.isFinite(Date.parse(raw.expiresAt)))return null;
 const items=[];
 for(const item of raw.items){
  if(!item||!identifier(item.stopId)||!money(item.totalMinor)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>6)return null;
  const title=english(item.title)?item.title:'Reservation';
  items.push({stopId:item.stopId,title,quantity:item.quantity,totalMinor:item.totalMinor,...(money(item.amountDueMinor)?{amountDueMinor:item.amountDueMinor}:{}),...(identifier(item.bookingId)?{bookingId:item.bookingId}:{}),...(typeof item.status==='string'&&/^[a-z_]{1,40}$/.test(item.status)?{status:item.status}:{}),...(typeof item.kind==='string'&&/^[a-z_]{1,40}$/.test(item.kind)?{kind:item.kind}:{})});
 }
 return{quoteId:raw.quoteId,currency:'CNY',totalMinor:raw.totalMinor,balanceMinor:raw.balanceMinor,shortfallMinor:raw.shortfallMinor,status:raw.status,expiresAt:raw.expiresAt,items,simulated:true};
}
export function receiptView(raw){
 if(!raw||raw.simulated!==true||!uuid(raw.quoteId)||raw.currency!=='CNY'||!money(raw.totalMinor)||!money(raw.balanceMinor)||!Array.isArray(raw.bookingIds)||raw.bookingIds.length>16||raw.bookingIds.some(id=>!identifier(id)))return null;
 return{quoteId:raw.quoteId,currency:'CNY',totalMinor:raw.totalMinor,balanceMinor:raw.balanceMinor,bookingIds:[...new Set(raw.bookingIds)],simulated:true};
}
