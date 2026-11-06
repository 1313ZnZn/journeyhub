// HTTP transport used by the official @fly-ai/flyai-cli 1.0.16.
// Only fliggy_fast_search is enabled. This adapter cannot create or pay for orders.
import {createHash,createHmac,randomBytes} from 'node:crypto';
export function flyaiURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)(feizhu\.com|fliggy\.com|taobao\.com|tmall\.com)$/.test(u.hostname)&&u.href.length<=700?u.href:'';}catch{return '';}}
const RELEVANCE_VERSION=1;
const CITY_NAMES={Shanghai:['shanghai','上海'],Singapore:['singapore','新加坡'],Bangkok:['bangkok','曼谷']};
const normalized=value=>typeof value==='string'?value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,''):'';
const unrelated=/电话卡|流量卡|上网卡|手机卡|通讯卡|(?:^|[^a-z])e?sim(?:[^a-z]|$)|wifi|\bdata\s*(?:card|plan)\b|签证|visa|接送机|机场接送|airport transfer|机票|airfare|flight ticket|酒店|民宿|hotel|住宿|保险|insurance|租车|car rental|导游|导览|tour guide|旅游攻略|攻略|讲解|city pass|通票|旅游套票/i;
const events=/演唱会|音乐节|音乐会|巡回|巡演|话剧|演出|concert|music festival|touring|theatre|theater/i;
const dining=/餐厅|餐饮|餐券|餐饮券|套餐|订位|订座|用餐|晚餐|午餐|下午茶|自助餐|甜品|咖啡|restaurant|dining|dinner|lunch|meal|table reservation|afternoon tea|buffet|cafe|coffee/i;
const attraction=/门票|入园|入馆|参观|入场|ticket|admission|entry/i;
function categoryOf(place){
 const kind=String(place?.kind||'').toLowerCase().replaceAll('_',' ');
 if(/restaurant|cafe|coffee|bakery|tea house|dessert|food court|bistro|meal/.test(kind))return 'dining';
 if(/museum|tourist attraction|amusement|aquarium|zoo|gallery|landmark|theme park|historical/.test(kind))return 'attraction';
 if(/concert hall|performing arts theater|performing arts theatre|event venue/.test(kind))return 'event';
 return '';
}
function venueAliases(place){
 const generic=/^(?:restaurant|cafe|coffee|museum|attraction|park|shanghai|singapore|bangkok|意大利餐厅|餐厅|咖啡厅|博物馆|景点|上海|新加坡|曼谷)$/i;
 const genericDining=value=>{if(categoryOf(place)!=='dining')return false;return !normalized(value).replace(/shanghai|singapore|bangkok|上海|新加坡|曼谷|italian|chinese|japanese|thai|local|popular|best|italy|意大利|中式|日式|泰式|当地|热门|restaurant|dining|food|cafe|coffee|餐厅|餐馆|餐饮|美食|咖啡厅|咖啡馆|西餐|中餐|日本料理/g,'');};
 return [...new Set([place?.originalName,place?.name].flatMap(name=>{
  if(typeof name!=='string'||name.length>240)return [];
  // Remove only a trailing category, never a branch/location qualifier.
  const core=name.trim().replace(/(?:意大利餐厅|意大利餐|中餐厅|西餐厅|餐厅|餐馆|大酒家|咖啡厅|咖啡馆|\s+restaurant|\s+cafe)$/i,'').trim();
  return [name,core].filter(v=>!generic.test(v)&&!genericDining(v)&&normalized(v).length>=3);
 }))];
}
function includesVenue(title,alias){
 if(/^[a-z0-9\s.'’&-]+$/i.test(alias)){
  const words=alias.normalize('NFKC').toLowerCase().match(/[a-z0-9]+/g)||[];
  return words.length&&new RegExp('(^|[^a-z0-9])'+words.join('[\\s\\p{P}]+')+'(?=$|[^a-z0-9])','u').test(title.normalize('NFKC').toLowerCase());
 }
 return normalized(title).includes(normalized(alias));
}
function validCategory(title,category){
 if(unrelated.test(title))return false;
 if(category==='dining')return !events.test(title)&&dining.test(title);
 if(category==='attraction')return !events.test(title)&&!dining.test(title)&&attraction.test(title);
 return category==='event'&&events.test(title)&&attraction.test(title);
}
export function matchFlyaiOffer(title,place){
 if(typeof title!=='string'||title.length>500)return false;
 const category=categoryOf(place),city=CITY_NAMES[place?.city];
 return !!category&&!!city&&city.some(n=>normalized(title).includes(normalized(n)))&&validCategory(title,category)&&venueAliases(place).some(alias=>includesVenue(title,alias));
}
export function sanitizeFlyaiResult(search,placeId){
 if(!search||typeof search!=='object')return null;
 const relevance=search.relevance,valid=relevance?.version===RELEVANCE_VERSION&&relevance.placeId===placeId&&['dining','attraction','event'].includes(relevance.category);
 // Older rows contain raw keyword results. Never render or reuse them as vetted offers.
 const offers=valid?(Array.isArray(search.offers)?search.offers:[]).filter(p=>typeof p?.title==='string'&&p.title.length<=140&&flyaiURL(p.url)&&validCategory(p.title,relevance.category)).slice(0,2).map(p=>({title:p.title,url:flyaiURL(p.url),price:Number.isFinite(p.price)&&p.price>=0?p.price:null,currency:'CNY'})):[];
 return {status:offers.length?'ready':['unavailable','not_configured'].includes(search.status)?search.status:'no_results',offers,...(valid?{relevance:{version:RELEVANCE_VERSION,placeId,category:relevance.category}}:{}),...(typeof search.checkedAt==='string'&&Number.isFinite(Date.parse(search.checkedAt))?{checkedAt:search.checkedAt}:{})};
}
export async function searchFlyai(place,env,fetcher=fetch){
 const key=env('FLYAI_API_KEY');if(!key)return {status:'not_configured',offers:[]};
 const category=categoryOf(place),names=venueAliases(place);
 if(!category||!CITY_NAMES[place?.city]||!names.length||typeof place.id!=='string')return {status:'no_results',offers:[]};
 const relevance={version:RELEVANCE_VERSION,placeId:place.id,category};
 const query=[place.city,place.originalName||place.name,category==='dining'?'餐厅 订位 餐饮套餐':category==='event'?'演出 门票':'门票 admission',/^\d{4}-\d{2}-\d{2}$/.test(place.date||'')?place.date:''].filter(Boolean).join(' ');
 try{
  const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'fliggy_fast_search',arguments:{query:query.slice(0,220)}}});
  const authorization='Bearer '+key,ts=Date.now().toString(),nonce=randomBytes(16).toString('hex'),hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
  // The default signing constant is published in the official CLI; the user's API key is always required.
  const sign=createHmac('sha256',env('FLYAI_SIGN_SECRET')||'XSbdYnucPARDc9knhD8+X6hxdD1Nh6ZGI6Hadg25kBw=').update(['POST','/mcp',ts,nonce,hash(body),hash(authorization)].join('\n')).digest('base64url');
  const r=await fetcher('https://flyai.open.fliggy.com/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:authorization,'x-ttid':'ai2c(sk.clawhub)','User-Agent':'JourneyHub/1.0','x-flyai-sign-ver':'7','x-flyai-sign-alg':'hmac-sha256','x-flyai-nonce':nonce,'x-flyai-ts':ts,'x-flyai-sign':sign},body,signal:AbortSignal.timeout(25000),redirect:'error'});
  if(!r.ok){await r.body?.cancel();return {status:'unavailable',offers:[]};}
  const reader=r.body.getReader(),parts=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();throw Error();}parts.push(value);}const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}const text=new TextDecoder().decode(bytes);
  let data;try{data=JSON.parse(text);}catch{for(const line of text.split('\n'))if(line.startsWith('data:'))try{const p=JSON.parse(line.slice(5));if(p.result||p.error)data=p;}catch{}}
  if(data?.error||data?.result?.isError)throw Error();const payload=JSON.parse(data.result.content.find(c=>c.type==='text').text);if(payload.status!==0)throw Error();
  const offers=(payload.data?.itemList||[]).map(item=>item.info).filter(p=>p&&typeof p.title==='string'&&p.title.length<=140&&flyaiURL(p.jumpUrl)&&matchFlyaiOffer(p.title,place)).filter((p,i,a)=>a.findIndex(q=>q.jumpUrl===p.jumpUrl)===i).slice(0,2).map(p=>({title:p.title,url:flyaiURL(p.jumpUrl),price:/^\d+(\.\d{1,2})?$/.test(p.price||'')?Number(p.price):null,currency:'CNY'}));
  return {status:offers.length?'ready':'no_results',offers,relevance,checkedAt:new Date().toISOString()};
 }catch{return {status:'unavailable',offers:[]};}
}
