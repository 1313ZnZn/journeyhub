// Simulated money and reservations only. This module never calls a purchase API.
import {WorkflowError,fail} from './planner.mjs';
import {historyId} from './history.mjs';
import {isAmap,amapDetails} from './amap.mjs';

const messages={
 SIGN_IN_REQUIRED:['Sign in again before confirming a reservation.',401],
 SESSION_CHANGED:['This session is closed or has changed. Choose another session.',409],
 ITINERARY_CHANGED:['Your saved dates or times changed. Review a fresh budget.',409],
 PRICE_CHANGED:['The session price changed. Review the updated budget before confirming.',409],
 CAPACITY_CHANGED:['There are not enough seats for your group. No credits were deducted. Choose another session.',409],
 BOOKING_CHANGE_REQUIRES_CANCEL:['An existing reservation has different dates or guests. Open Calendar to cancel it explicitly before rebooking. Your reservation and credits are unchanged.',409],
 RESERVATION_CANNOT_BE_CANCELLED:['This reservation has started or was checked in. It cannot be cancelled.',409],
 REMINDER_IN_PROGRESS:['This reservation is being updated. Retry shortly.',409],
 CANCELLED_BOOKING_CANNOT_REOPEN:['This reservation is cancelled. Create a new booking to reserve again.',409],
 DEMO_SOURCE_NOT_FOUND:['This saved itinerary is not available for your account.',404],
 DEMO_TRIP_PASSED:['Some visits have already started. Choose a future itinerary for the booking demo.',409],
 DEMO_SAMPLE_PLAN:['Choose a saved AI itinerary to try the booking demo.',409],
 DEMO_ACCOUNT_REQUIRED:['Please sign in to use your demo wallet.',401],
 DEMO_BALANCE_LIMIT:['Your demo balance has reached its limit.',409],
 DEMO_NOT_RESERVATION:['This item has no simulated payment to refund.',409],
 DEMO_NOT_READY:['These stops could not be checked for the demo. Refresh the estimate before confirming.',409],
 DEMO_PLAN_REMOVED:['This plan was deleted. Restore it before starting the booking demo.',409],
 DEMO_QUOTE_STALE:['Your itinerary changed. Review a fresh demo budget before confirming.',409],
 DEMO_QUOTE_EXPIRED:['This demo budget expired. Review it again before confirming.',409],
 DEMO_QUOTE_NOT_FOUND:['This demo budget is not available for your account.',404],
 DEMO_INSUFFICIENT_FUNDS:['Add demo credits to cover this budget, then confirm again. No credits were deducted.',409],
 DEMO_REQUEST_REUSED:['This request was already used for a different action. Refresh and try again.',409],
 DEMO_ALREADY_BOOKED:['This itinerary already has demo reservations. Open your demo wallet to view them.',409],
 DEMO_BOOKING_NOT_FOUND:['This demo reservation is not available for your account.',404],
 DEMO_INVALID_ITEMS:['The demo budget does not match the saved itinerary. Review it again.',400],
 DEMO_INVALID_TOPUP:['Choose a valid amount of demo credits.',400],
 DEMO_INVALID_REQUEST:['Please refresh and try this demo action again.',400]
};
export function demoDatabaseError(error){
 if(error instanceof WorkflowError)return error;
 const text=String(error?.message||'');
 const code=Object.keys(messages).find(code=>new RegExp('\\b'+code+'\\b').test(text))||text.match(/\bDEMO_[A-Z_]+\b/)?.[0];
 if(!code)return null;
 const [message,status]=messages[code]||['The demo account could not update. Refresh and try again.',409];
 return new WorkflowError(code,message,status);
}

// These are illustrative amounts, never quoted admission prices or venue deposits.
export function demoPrice(place,stop={}){
 if(!place||place.unavailable)return {kind:'unavailable',unitMinor:0};
 const kind=String(place.kind||'').toLowerCase().replaceAll('_',' ');
 const text=[place.name,place.originalName,stop.reason].filter(Boolean).join(' ').toLowerCase();
 if(/cafe|coffee|tea house|bakery/.test(kind)||(/restaurant|food|meal/.test(kind)&&/matcha|coffee|cafe|café|抹茶|咖啡|茶馆/.test(text)))return {kind:'cafe',unitMinor:2000};
 if(/restaurant|food|meal|bar|dining/.test(kind))return {kind:'restaurant',unitMinor:5000};
 if(/museum|art gallery|aquarium|zoo|amusement/.test(kind)||/museum|博物馆/.test(text))return {kind:'ticket',unitMinor:/museum|博物馆/.test(kind+' '+text)?4000:6000};
 if(/park|beach|hiking|natural feature|walking|neighborhood/.test(kind)||/riverside walk|waterfront walk|architecture walk|historic.*stroll|街区漫步|外滩.*建筑/.test(text))return {kind:'free',unitMinor:0};
 if(/tourist attraction|historical landmark|garden|landmark|cultural/.test(kind))return {kind:'ticket',unitMinor:6000};
 if(/shopping|store|market|hotel/.test(kind))return {kind:'free',unitMinor:0};
 return {kind:'unavailable',unitMinor:0};
}
async function metadata(id,{env,fetcher}){
 try{
  if(isAmap(id))return await amapDetails(id,env('AMAP_WEB_SERVICE_KEY'),fetcher);
  const key=env('GOOGLE_PLACES_API_KEY');if(!key){console.warn('demo_place_lookup_failed',{reason:'missing_key'});return null;}
  const response=await fetcher('https://places.googleapis.com/v1/places/'+encodeURIComponent(id)+'?languageCode=en',{headers:{'X-Goog-Api-Key':key,'X-Goog-FieldMask':'id,displayName,primaryType'},signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!response.ok){console.warn('demo_place_lookup_failed',{reason:'http_error',status:response.status});await response.body?.cancel();return null;}
  const p=await response.json();if(p.id!==id){console.warn('demo_place_lookup_failed',{reason:'id_mismatch'});return null;}
  return {name:p.displayName?.text||'',kind:p.primaryType||''};
 }catch(error){console.warn('demo_place_lookup_failed',{reason:'exception',name:error?.name||'Error'});return null;}
}
function source(value){
 if(!!value.historyId===!!value.runId)fail('INVALID_INPUT','Choose one saved itinerary for the demo.');
 return {p_source_type:value.historyId?'history':'run',p_source_id:historyId(value.historyId||value.runId)};
}
export async function demoAction(context){
 const {value,user,rpc}=context,owner={p_user_id:user.id};
 try{
  if(value.action==='demo_state')return {wallet:await rpc('journeyhub_demo_wallet_state',owner)};
  if(value.action==='demo_session_quote'){
   if(typeof value.sessionId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(value.sessionId)||!Number.isInteger(value.guests)||value.guests<1||value.guests>6)fail('INVALID_INPUT','Choose a session and 1–6 guests.');
   return {quote:await rpc('journeyhub_demo_session_quote',{...owner,p_session_id:value.sessionId,p_guests:value.guests}),wallet:await rpc('journeyhub_demo_wallet_state',owner)};
  }
  if(value.action==='demo_topup'){
   if(!Number.isSafeInteger(value.amountMinor)||value.amountMinor<100||value.amountMinor>1000000)fail('DEMO_INVALID_TOPUP',messages.DEMO_INVALID_TOPUP[0]);
   return {wallet:await rpc('journeyhub_demo_wallet_topup',{...owner,p_amount_minor:value.amountMinor,p_request_id:historyId(value.requestId)})};
  }
  if(value.action==='demo_quote'){
   const args={...owner,...source(value)},saved=await rpc('journeyhub_demo_source',args);
   if(!saved?.input||!Array.isArray(saved.plan?.stops)||saved.plan.stops.length<1||saved.plan.stops.length>16)fail('DEMO_SOURCE_NOT_FOUND',messages.DEMO_SOURCE_NOT_FOUND[0],404);
   let quote=saved.quote;
   // A manual revisit can recover missing metadata rather than freezing an
   // unknown item into the cached quote. Executed receipts are never re-priced.
   if(quote?.status==='quoted'&&quote.items?.some(item=>item.kind==='unavailable'))quote=null;
   if(!quote){
    const items=await Promise.all(saved.plan.stops.map(async (stop,index)=>{
     const id=stop.id||stop.sessionId;
     // Catalog price/session identity is verified again inside the booking RPC.
     const place=args.p_source_type==='run'?{kind:stop.kind||'tourist attraction',name:stop.title||''}:await metadata(id,context);
     const price=demoPrice(place,stop);
     if(price.kind==='unavailable')console.warn('demo_quote_unclassified',{reason:!place?'lookup_failed':place.unavailable?'place_unavailable':'unmatched_kind',kind:place?.kind||null});
     const label=({ticket:'Attraction visit',restaurant:'Restaurant reservation',cafe:'Cafe visit',free:'Free visit',unavailable:'Visit'})[price.kind];
     // Never persist Google venue content in the private demo catalog. The
     // traveler sees freshly hydrated venue names; staff sees a clear demo label.
     const name=isAmap(id)&&typeof place?.name==='string'&&!/[\u3400-\u9fff]/u.test(place.name)?place.name:'';
     return {stopId:id,...price,displayTitle:name||`${label} · ${saved.input.city} · Stop ${index+1}`};
    }));
    quote=await rpc('journeyhub_demo_quote_save',{...args,p_items:items});
   }
   return {quote,wallet:await rpc('journeyhub_demo_wallet_state',owner)};
  }
  if(value.action==='demo_book')return await rpc('journeyhub_demo_book',{...owner,p_quote_id:historyId(value.quoteId),p_request_id:historyId(value.requestId)});
  if(value.action==='demo_cancel')return await rpc('journeyhub_demo_cancel',{...owner,p_booking_id:historyId(value.bookingId),p_request_id:historyId(value.requestId)});
  fail('INVALID_INPUT','Choose a valid demo account action.');
 }catch(error){throw demoDatabaseError(error)||error;}
}
