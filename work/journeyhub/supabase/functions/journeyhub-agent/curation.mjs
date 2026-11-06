import {fail} from './planner.mjs';
import {englishAddress,addressTranslationPrompt} from './address-localization.mjs';
export const intentPrompt=amap=>`You are a travel requirements analyst. Decompose EVERY explicit positive interest in the traveler request into separate searchable categories, including food cuisines, drinks, museums and historical sites. Respect negations and exclusions. Do not collapse a multi-interest request into one query. Return {"queries":[{"category":"short English label","query":"search keywords"}]}. Use 1 to 6 distinct queries, merging only closely related interests if necessary. For local food + Italian + matcha + museums + history, return five separate queries. Never invent venue names. ${amap?'Queries must be short Chinese POI keywords (e.g. 本帮菜, 意大利餐厅, 抹茶, 博物馆, 历史建筑), up to 24 characters. Only query fields may be Chinese.':'Queries must be concise English category keywords.'}`;
export const discoveryCardCount=days=>[0,8,12,14,16][days]||fail('INVALID_INPUT','Choose 1–4 days for your trip.');
export const rankingPrompt=`Act as a careful travel curator. Select up to targetCardCount distinct verified supplied places matching the traveler's explicit interests and exclusions. The target is 8 for one day, 12 for two days, 14 for three days and 16 for four days. Return {"places":[{"id":"exact supplied ID","category":"one exact requested category","name":"English venue name","addressEnglish":"English translation of supplied address","reason":"short concrete preference match"}]}. Cover EVERY requested category with suitable candidates, normally two per category before adding extras. Interleave categories so the first cards offer variety. Do not select a museum to satisfy a food request. Omit unsuitable results; return fewer when fewer are suitable, never fill a quota with unrelated venues. Avoid duplicate branches or multiple entrances/sub-attractions of the same venue. Prefer a geographically coherent mix, without sacrificing explicit cuisine/drink requests. Use an official English name when supplied, otherwise a faithful English translation or transliteration; preserve branch identity. All output names and reasons must be English. Never invent popularity, reviews, prices, quality, opening hours, availability, accessibility or local-favourite claims not supported by the supplied records. ${addressTranslationPrompt}`;
export function searchQueries(intent){
 const raw=Array.isArray(intent?.queries)?intent.queries:intent?.query?[{category:'Your interests',query:intent.query}]:[];
 const seen=new Set(),queries=[];
 for(const item of raw.slice(0,6)){const query=String(item.query||'').trim().slice(0,80),category=String(item.category||'Your interests').trim().slice(0,70);if(!query||seen.has(query.toLowerCase()))continue;seen.add(query.toLowerCase());queries.push({query,category});}
 if(!queries.length)fail('AI_INVALID_RESPONSE','The AI could not understand your interests. Please retry.',502);return queries;
}
export function mergeCandidates(batches){
 const output=[];
 for(const {category,places} of batches)for(const place of places){
  const normalized=s=>String(s).toLowerCase().replace(/[\s·•()（）,，.-]/g,'');
  const existing=output.find(p=>p.id===place.id||(normalized(p.originalName||p.name)===normalized(place.originalName||place.name)&&Math.abs(p.lat-place.lat)<.001&&Math.abs(p.lng-place.lng)<.001));
  if(existing){if(!existing.categories.includes(category))existing.categories.push(category);}else output.push({...place,categories:[category]});
 }return output;
}
export const englishName=s=>typeof s==='string'&&/[a-zA-Z]/.test(s)&&!/[\u3400-\u9fff]/.test(s)?s.trim().slice(0,160):null;
export function selectCurated(ranked,records,queries,targetCardCount=12){
 if(!Number.isInteger(targetCardCount)||targetCardCount<1||targetCardCount>16)fail('INVALID_INPUT','Choose a valid recommendation count.');
 if(!Array.isArray(ranked?.places)||!ranked.places.length||ranked.places.length>20)fail('AI_INVALID_RESPONSE','No suitable recommendations were found. Try adjusting your preferences.',502);
 const seen=new Set(),groups=new Map(queries.map(q=>[q.category,[]]));
 for(const item of ranked.places){const record=records.find(p=>p.id===item.id);if(!record||seen.has(item.id))fail('AI_INVALID_RESPONSE','The AI returned an unverified place. Please retry.',502);seen.add(item.id);
  const category=item.category||record.categories[0];if(!record.categories.includes(category)||!groups.has(category))fail('AI_INVALID_RESPONSE','A place did not match its search category. Please retry.',502);
  const name=englishName(item.name)||englishName(record.name);if(!name)fail('AI_INVALID_RESPONSE','An English place name could not be prepared. Please retry.',502);
  groups.get(category).push({...record,name,addressEnglish:englishAddress(record.address,item.addressEnglish),category,reason:String(item.reason||'').slice(0,300)});
 }
 const places=[];for(let i=0;i<targetCardCount;i++)for(const group of groups.values())if(group[i]&&places.length<targetCardCount)places.push(group[i]);
 return {places,missingCategories:[...groups].filter(([,p])=>!p.length).map(([name])=>name)};
}
