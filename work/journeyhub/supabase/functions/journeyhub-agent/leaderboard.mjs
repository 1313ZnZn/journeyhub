// This week's leaderboards (most-picked Must go places, debate champions) and the record of a
// finished place debate. Only aggregate counts are returned; no traveler is identified.
import {fail} from './planner.mjs';
import {readSelection} from './discovery.mjs';
import {searchHistoryId} from './history.mjs';

const CITIES=['Bangkok','Shanghai','Singapore'];
const clean=(s,n)=>typeof s==='string'?s.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n):'';
const count=v=>Number.isInteger(Number(v))&&Number(v)>=0?Number(v):0;
const row=r=>({placeId:clean(r?.placeId,200),name:clean(r?.name,160),kind:clean(r?.kind,60),city:CITIES.includes(r?.city)?r.city:null});

export async function leaderboard({value,rpc}){
  const city=value?.city==null||value.city==='all'?null:CITIES.includes(value.city)?value.city:fail('INVALID_INPUT','Choose Bangkok, Shanghai or Singapore.');
  const data=await rpc('journeyhub_leaderboard',{p_city:city})||{};
  const mustGo=(Array.isArray(data.mustGo)?data.mustGo:[]).slice(0,10).map(r=>({...row(r),travelers:count(r.travelers),trips:count(r.trips)})).filter(r=>r.placeId&&r.name&&r.travelers);
  const debates=(Array.isArray(data.debates)?data.debates:[]).slice(0,10).map(r=>({...row(r),wins:count(r.wins),debates:count(r.debates)})).filter(r=>r.placeId&&r.name&&r.debates&&r.wins<=r.debates);
  return {city,since:'7 days',mustGo,debates};
}

// The traveler finished a debate between two places from their own search.
export async function debateResult({value,user,rpc,now,secret}){
  // A debate can end after the card token's hour is up; recording it needs no live data.
  const selection=await readSelection(value?.token,secret,user.id,now,{allowExpiredForStorage:true});
  if(selection.sample)return {recorded:false};
  const ids=Array.isArray(value?.ids)?value.ids:[];
  if(ids.length!==2||ids[0]===ids[1]||!ids.every(id=>typeof id==='string'&&selection.ids.includes(id)))fail('INVALID_INPUT','Choose two places from this search.');
  const choice=['a','b','both','none'].includes(value?.choice)?value.choice:fail('INVALID_INPUT','Choose who won the debate.');
  const city=selection.input?.city;if(!CITIES.includes(city))return {recorded:false};
  const root=await searchHistoryId(selection,value.token),prior=await rpc('journeyhub_planner_search_result',{p_user_id:user.id,p_history_id:root});
  const lookup=new Map((prior?.places||[]).map(p=>[p.id,p]));
  const places=ids.map(id=>{const p=lookup.get(id);return {id,name:clean(p?.name||selection.englishNames?.[id],160),kind:clean(p?.kind,60)};});
  if(places.some(p=>!p.name))return {recorded:false};
  try{await rpc('journeyhub_debate_record',{p_user_id:user.id,p_city:city,p_places:places,p_choice:choice});}
  catch(e){if(/limit/i.test(String(e?.message||'')))return {recorded:false};throw e;}
  return {recorded:true};
}
