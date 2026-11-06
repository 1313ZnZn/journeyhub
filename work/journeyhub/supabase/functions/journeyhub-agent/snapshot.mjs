// Account-owned itinerary presentation, never an authoritative availability or
// provider-content cache. The schedule and budget remain in trip_history.
import {englishName} from './curation.mjs';

const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function displayPayload(row,places){
 const allowed=new Set(row.placeIds),seen=new Set();
 const labels=[];
 for(const place of places||[]){
  const name=englishName(place?.name);
  if(!allowed.has(place?.id)||seen.has(place.id)||!name||place.labelPending||place.name==='Place details unavailable')continue;
  seen.add(place.id);
  labels.push({id:place.id,name,kind:text(place.kind,80)||'saved place',
   ...(text(place.category,80)?{category:text(place.category,80)}:{}),
   ...(text(place.reason,300)?{reason:text(place.reason,300)}:{})});
 }
 return {schemaVersion:1,places:labels};
}
export async function getDisplaySnapshot(rpc,userId,row){
 try{
  const saved=await rpc('journeyhub_trip_snapshot_get',{p_user_id:userId,p_id:row.id});
  if(!saved?.payload||saved.payload.schemaVersion!==1||!Array.isArray(saved.payload.places))return null;
  // Both timestamps come from the same Postgres JSON representation. Preserve
  // microseconds so a concurrent edit cannot reuse the previous labels.
  if(saved.sourceUpdatedAt&&row.updatedAt&&saved.sourceUpdatedAt!==row.updatedAt)return null;
  return {...saved,payload:displayPayload(row,saved.payload.places)};
 }catch{return null;}
}
export async function persistDisplaySnapshot(rpc,userId,row,places){
 const payload=displayPayload(row,places);
 if(!payload.places.length||!row.updatedAt)return {ok:false,reason:'no_labels'};
 try{return await rpc('journeyhub_trip_snapshot_put',{p_user_id:userId,p_id:row.id,p_expected_updated_at:row.updatedAt,p_payload:payload})||{ok:false};}
 catch{return {ok:false,reason:'unavailable'};}
}
