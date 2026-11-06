// Store traveler input and itinerary structure only. Google content is hydrated on open.
import {fail,validateInput} from './planner.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const historyId=value=>typeof value==='string'&&UUID.test(value)?value.toLowerCase():fail('INVALID_INPUT','Choose a valid saved trip.');
export function historyIds(value){if(!Array.isArray(value)||value.length>20||value.some(x=>typeof x!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(x))||new Set(value).size!==value.length)fail('INVALID_INPUT','Choose valid, distinct places.');return [...value];}
export function historyInput(value){
  // Validate the original date relative to itself, so past trips remain readable.
  const anchor=new Date(String(value?.date)+'T00:00:00Z');
  if(!Number.isFinite(anchor.getTime()))fail('INVALID_DATE','The saved travel date is invalid.');
  return validateInput({...value,action:'plan',requestId:'11111111-1111-4111-8111-111111111111',preferredExperienceIds:[],excludedExperienceIds:[]},anchor).input;
}
export function historyChoices(placeIds,wanted=[],skipped=[]){
  wanted=historyIds(wanted);skipped=historyIds(skipped);
  if([...wanted,...skipped].some(id=>!placeIds.includes(id))||wanted.some(id=>skipped.includes(id)))fail('INVALID_INPUT','Choose only places from this saved search.');
  return {wanted:[...wanted].sort(),skipped:[...skipped].sort()};
}
export function historyPlan(plan,input,placeIds){
  if(plan==null)return null;
  if(!Array.isArray(plan.stops)||!plan.stops.length||plan.stops.length>16||typeof plan.summary!=='string')fail('INVALID_INPUT','The saved itinerary is invalid.');
  const seen=new Set(),ends=new Map();
  const stops=plan.stops.map(stop=>{
    if(!placeIds.includes(stop.id)||seen.has(stop.id)||!Number.isInteger(stop.dayIndex)||stop.dayIndex<1||stop.dayIndex>input.days||!TIME.test(stop.start||'')||!TIME.test(stop.end||'')||stop.start>=stop.end||stop.start<input.dayStart||stop.end>input.dayEnd)fail('INVALID_INPUT','The saved itinerary contains an invalid place or time.');
    seen.add(stop.id);return {id:stop.id,dayIndex:stop.dayIndex,start:stop.start,end:stop.end,reason:typeof stop.reason==='string'?stop.reason.slice(0,300):''};
  }).sort((a,b)=>a.dayIndex-b.dayIndex||a.start.localeCompare(b.start));
  for(const stop of stops){if(ends.has(stop.dayIndex)&&stop.start<ends.get(stop.dayIndex))fail('INVALID_INPUT','Saved visit times overlap.');ends.set(stop.dayIndex,stop.end);}
  return {summary:plan.summary.slice(0,600),stops};
}
export async function stableHistoryId(text){
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes.slice(0,16),n=>n.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const searchHistoryId=async(search,token)=>search.historyId?historyId(search.historyId):stableHistoryId('legacy-search:'+search.owner+':'+token);
// A new schedule policy creates a new version; older immutable history stays readable.
export const revisionHistoryId=(root,wanted,skipped)=>stableHistoryId('itinerary:daily-coverage-v2:'+root+':'+JSON.stringify([[...wanted].sort(),[...skipped].sort()]));
export async function getHistory(rpc,userId,id,required=true){const row=await rpc('journeyhub_trip_history_get',{p_user_id:userId,p_id:historyId(id)});if(!row&&required)fail('HISTORY_NOT_FOUND','This saved trip is unavailable for your account.',404);return row;}
export async function saveHistory({rpc,userId,id,input,placeIds,wanted=[],skipped=[],plan=null,parentId=null,allowOptional=false}){
  input=historyInput(input);placeIds=historyIds(placeIds);const choices=historyChoices(placeIds,wanted,skipped),selected=!allowOptional&&choices.wanted.length?choices.wanted:placeIds.filter(id=>!choices.skipped.includes(id)),structure=historyPlan(plan,input,selected);
  if(allowOptional&&structure&&choices.wanted.some(id=>!structure.stops.some(stop=>stop.id===id)))fail('INVALID_INPUT','The itinerary omitted a must-visit place.');
  const row=await rpc('journeyhub_trip_history_save',{p_user_id:userId,p_id:historyId(id),p_input:input,p_place_ids:placeIds,p_wanted:choices.wanted,p_skipped:choices.skipped,p_plan:structure,p_parent_id:parentId?historyId(parentId):null});
  if(!row||row.id!==id)fail('HISTORY_UNAVAILABLE','Your trip could not be saved. Please retry saving.',503);return row;
}
export async function saveSearchAndPlan({rpc,userId,search,token,wanted=[],skipped=[],plan=null,onSaved=null,allowOptional=false}){
  const root=await searchHistoryId(search,token),input=historyInput(search.input),placeIds=historyIds(search.ids);historyChoices(placeIds,wanted,skipped);
  await saveHistory({rpc,userId,id:root,input,placeIds});
  const choices=historyChoices(placeIds,wanted,skipped),updated=await rpc('journeyhub_trip_history_choices',{p_user_id:userId,p_id:root,p_wanted:choices.wanted,p_skipped:choices.skipped});
  if(!updated?.id)fail('HISTORY_UNAVAILABLE','Your choices could not be saved. Please retry.',503);
  if(!plan)return root;
  const id=await revisionHistoryId(root,wanted,skipped),row=await saveHistory({rpc,userId,id,input,placeIds,wanted,skipped,plan,parentId:root,allowOptional});if(onSaved)await onSaved(row);return id;
}
export async function safelySave(operation){try{return {historyId:await operation()};}catch(error){
  // A competing request may have occupied these dates after the preflight.
  // Do not expose a conflicting itinerary as a successful, unsaved second plan.
  if(error?.code==='PLAN_DATE_CONFLICT'||/\bPLAN_DATE_CONFLICT\b/.test(String(error?.message||'')))throw error;
  return {historyId:null,historyError:'This trip is still available here, but could not be saved to your account. Retry saving before leaving.'};
}}
export async function listHistory(rpc,userId,value){
  const limit=value.limit??20;if(!Number.isInteger(limit)||limit<1||limit>40)fail('INVALID_INPUT','Choose a valid history page size.');
  // Preserve Postgres microseconds: Date.toISOString() would skip rows sharing a millisecond.
  let cursor=null;if(value.cursor!=null){const c=value.cursor;if(!c||typeof c.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(c.createdAt)||!Number.isFinite(Date.parse(c.createdAt)))fail('INVALID_INPUT','The history page is invalid.');cursor={createdAt:c.createdAt,id:historyId(c.id)};}
  const page=await rpc('journeyhub_trip_history_list',{p_user_id:userId,p_limit:limit,p_cursor_at:cursor?.createdAt||null,p_cursor_id:cursor?.id||null});
  if(!page||!Array.isArray(page.items))fail('HISTORY_UNAVAILABLE','Your saved trips could not be loaded. Please retry.',503);return page;
}
