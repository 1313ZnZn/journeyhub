import {officialTLS} from './public-tls.mjs';
// URLs are discovered from official directories. Never retrieve a URL supplied by a traveler or model.
const portals={Shanghai:['english.shanghai.gov.cn','shanghai.gov.cn','sh.gov.cn','meet-in-shanghai.net'],Singapore:['visitsingapore.com','nparks.gov.sg','nhb.gov.sg','roots.gov.sg'],Bangkok:['tourismthailand.org','bangkok.go.th','tatnews.org']};
const trusted=['shanghaimuseum.cn','snhm.org.cn','sstm.org.cn','yugarden.com.cn','rockbundartmuseum.org','gardensbythebay.com.sg','watpho.com','watpho.org','royalgrandpalace.th','nationalgallery.sg','marinabaysands.com','mandai.com','nparks.gov.sg','nhb.gov.sg',...Object.values(portals).flat()];
export const cleanUrl=(value,base)=>{try{const u=new URL(value,base);if(u.protocol==='http:')u.protocol='https:';if(u.protocol!=='https:'||u.port||u.username||u.password||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(u.hostname)||/\.(?:internal|localhost|local|test|invalid|example)$/.test(u.hostname)||/\.(?:jpg|png|svg|pdf|zip|mp4)(?:$|\?)/i.test(u.pathname))return '';u.hash='';return u.href;}catch{return '';}};
const host=u=>new URL(u).hostname,within=(h,d)=>h===d||h.endsWith('.'+d);
export const isApproved=u=>!!cleanUrl(u)&&trusted.some(d=>within(host(u),d));
const ua='JourneyHub-Visitor/1.0 (+https://journeyhub-travel.youranxin2006.chatgpt.site/)';
export async function limited(r,max=950000) {if(!r.ok){await r.body?.cancel();throw Error('http_'+r.status);}let n=0,s='',dec=new TextDecoder(),reader=r.body?.getReader();if(!reader)return '';try{for(;;){const x=await reader.read();if(x.done)break;const b=x.value.subarray(0,max-n);s+=dec.decode(b,{stream:true});n+=b.length;if(n>=max)break;}return s+dec.decode();}finally{await reader.cancel().catch(()=>{});}}
const get=async(f,u,extra={})=>limited(await f(u,{redirect:'error',signal:AbortSignal.timeout(8500),...extra,headers:{'User-Agent':ua,...extra.headers}}));
const decoded=s=>String(s||'').replace(/&#x([0-9a-f]{1,6});|&#(\d{1,7});/gi,(_,h,n)=>{const k=h?parseInt(h,16):+n;return k<=1114111?String.fromCodePoint(k):' ';}).replace(/&(amp|quot|apos|lt|gt|nbsp|ndash|mdash);/g,(_,x)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—'}[x]));
const flat=s=>decoded(s).replace(/\s+/g,' ').trim();
const interesting=/visit|hour|open|ticket|admission|reservation|booking|price|passport|identif|entry|closure|notice|holiday|practical|参观|开放|门票|证件|预约|公告|入馆/i;
export function pageData(html,url) {
 const stripped=html.replace(/<!--[\s\S]*?-->|<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
 const links=Array.from(stripped.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)).map(m=>({u:cleanUrl(decoded(m[1]),url),label:flat(m[2].replace(/<[^>]*>/g,' '))})).filter(x=>x.u&&host(x.u).replace(/^www\./,'')===host(url).replace(/^www\./,'')&&x.u!==url&&interesting.test(x.label+' '+x.u));
 const lines=stripped.replace(/<\/?(?:p|div|li|tr|h[1-6]|section|br|td|dt|dd)[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ').split('\n').map(flat).filter(Boolean);
 const selected=new Set(lines.slice(0,18));lines.forEach((s,i)=>{if(interesting.test(s)||/\d{1,2}:\d{2}|[$฿¥￥]/.test(s))for(let j=Math.max(0,i-2);j<=Math.min(i+2,lines.length-1);j++)selected.add(lines[j]);});
 return {url,text:flat([...selected,...lines.slice(18,65)].join(' | ')).slice(0,9800),links:[...new Set(links.map(x=>x.u))]};
}
const deniedHost=/(^|\.)(wikipedia\.org|wikidata\.org|facebook\.com|instagram\.com|weibo\.com|wechat\.com|tripadvisor\.[a-z.]+|trip\.com|ctrip\.com|klook\.com|agoda\.com|booking\.com|google\.[a-z.]+|amap\.com|youtube\.com|linktr\.ee|tiktok\.com)$/i;
export async function readPage(f,url,authority,depth=0){
 url=cleanUrl(url);if(!url||depth>2||deniedHost.test(host(url))||(!isApproved(url)&&(!authority||host(url).replace(/^www\./,'')!==authority)))return null;
 try{
  // New independent operator domains are read through a fixed public reader, not an unrestricted server-side fetch.
  if(!isApproved(url)){
   const html=await officialTLS(url,f).catch(()=>null);
   if(html){const p=pageData(html,url);if(p.text.length>100&&!/just a moment|access denied|captcha/i.test(p.text.slice(0,220)))return p;}
   const md=await get(f,'https://r.jina.ai/'+url,{headers:{Accept:'text/plain','X-Timeout':'7'}});
   if(!md.includes('Markdown Content:')||/Target URL returned error|Waiting for verification/i.test(md.slice(0,600)))return null;
   const content=md.split('Markdown Content:').slice(1).join(' '),lines=content.split('\n').map(flat).filter(Boolean);
   const selected=lines.flatMap((s,i)=>interesting.test(s)?lines.slice(Math.max(0,i-1),i+3):[]);
   const links=[...content.matchAll(/\[([^\]]{1,130})\]\((https?:\/\/[^)\s]+)\)/g)].filter(m=>interesting.test(m[1])).map(m=>cleanUrl(m[2])).filter(v=>v&&host(v).replace(/^www\./,'')===authority);
   return {url,text:flat([...lines.slice(0,10),...new Set(selected),...lines.slice(10,85)].join(' | ')).slice(0,9800),links};
  }
  const r=await f(url,{headers:{'User-Agent':ua,'Accept':'text/html','Accept-Language':'en,zh;q=0.8'},redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(r.status>=300&&r.status<400){const to=cleanUrl(r.headers.get('location'),url);await r.body?.cancel();if(to&&host(to).replace(/^www\./,'')===host(url).replace(/^www\./,''))return readPage(f,to,authority,depth+1);return null;}
  if(!/html|text\/plain/i.test(r.headers.get('content-type')||'')){await r.body?.cancel();return null;}
  const p=pageData(await limited(r),url);return p.text.length>75&&!/Just a moment|Access Denied|Verify you are human/i.test(p.text.slice(0,200))?p:null;
 }catch{return null;}
}
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export async function wikiSite(f,venue){
 for(const [q,lang] of [[venue.name,'en'],[venue.native,'zh']]){
 if(!q)continue;try{
 const wb=async params=>JSON.parse(await get(f,'https://www.wikidata.org/w/api.php?'+new URLSearchParams({format:'json',...params})));
 const hits=(await wb({action:'wbsearchentities',search:q,language:lang,limit:'4'})).search||[];
 const ids=hits.map(x=>x.id).filter(id=>/^Q\d+$/.test(id));if(!ids.length)continue;
 const entities=(await wb({action:'wbgetentities',ids:ids.join('|'),props:'labels|aliases|claims',languages:'en|zh|zh-hans|th'})).entities;
 for(const e of Object.values(entities||{})){const names=[...Object.values(e.labels||{}),...Object.values(e.aliases||{}).flat()].map(x=>norm(x.value));
 if(![venue.name,venue.native].some(n=>n&&names.includes(norm(n))))continue;
 const coord=e.claims?.P625?.find(x=>x.rank!=='deprecated')?.mainsnak?.datavalue?.value;
 if(!coord||!Number.isFinite(venue.lat)||Math.abs(coord.latitude-venue.lat)>.035||Math.abs(coord.longitude-venue.lng)>.035)continue;
 const sites=(e.claims?.P856||[]).filter(x=>x.rank!=='deprecated'&&!x.qualifiers?.P582).map(x=>cleanUrl(x.mainsnak?.datavalue?.value)).filter(x=>x&&!deniedHost.test(host(x)));if(sites.length)return sites[0];
 }
 }catch{}}
 return '';
}
export async function portalSearch(f,v){
 const ds=portals[v.city]||[];if(!ds.length||!v.name)return [];
 const q='"'+v.name+'" '+v.city+' opening hours tickets ('+ds.map(d=>'site:'+d).join(' OR ')+')';
 try{const xml=await get(f,'https://www.bing.com/search?'+new URLSearchParams({q,format:'rss'}));
 return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m=>cleanUrl(decoded(m[1].match(/<link>([^<]+)<\/link>/i)?.[1]))).filter(u=>u&&ds.some(d=>within(host(u),d))).slice(0,3);}catch{return [];}
}
export async function discoverPages(f,v,hints=[]){
 const explicit=hints.map(x=>cleanUrl(x)).filter(u=>u&&isApproved(u));
 let site=cleanUrl(v.website);if(!site&&!explicit.length)site=await wikiSite(f,v);if(site&&deniedHost.test(host(site)))site='';
 const authority=site?host(site).replace(/^www\./,''):'';
 const collect=async urls=>(await Promise.all([...new Set(urls)].slice(0,4).map(u=>readPage(f,u,authority)))).filter(Boolean);
 let pages=await collect([...explicit,...(site?[site]:[])]);
 if(!pages.length||(!explicit.length&&!site))pages.push(...await collect(await portalSearch(f,v)));
 const seen=new Set(pages.map(p=>p.url));const kids=pages.flatMap(p=>p.links).filter(u=>!seen.has(u)).sort((a,b)=>Number(/ticket|admission|opening|visitor|practical/i.test(b))-Number(/ticket|admission|opening|visitor|practical/i.test(a)));
 if(kids.length)pages.push(...await collect(kids.slice(0,3)));
 return pages.filter((p,i,a)=>a.findIndex(o=>o.url===p.url)===i).slice(0,6);
}
