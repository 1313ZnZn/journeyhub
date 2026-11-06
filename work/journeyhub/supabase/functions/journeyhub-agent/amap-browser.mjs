import {createHmac,timingSafeEqual} from 'node:crypto';
import {fail} from './planner.mjs';
const signature=(value,secret)=>createHmac('sha256',secret).update('journeyhub-amap:'+value).digest('hex');
export function amapBrowserConfig(env,secret,now=new Date()){
 const key=env('AMAP_JS_KEY'),code=env('AMAP_SECURITY_JS_CODE');
 if(!key||!code||!secret||key===env('AMAP_WEB_SERVICE_KEY'))fail('AMAP_NOT_CONFIGURED','Amap browser credentials need configuration.',503);
 const expiry=String(now.getTime()+3600000),ticket=expiry+'.'+signature(expiry,secret);
 return {ready:true,browserKey:key,expires:Number(expiry),serviceHost:env('SUPABASE_URL')+'/functions/v1/journeyhub-agent/amap/'+ticket+'/_AMapService'};
}
export async function amapBrowserProxy(req,env,secret,fetcher=fetch,now=new Date()){
 const url=new URL(req.url),match=url.pathname.match(/\/amap\/(\d{13})\.([a-f0-9]{64})\/_AMapService(\/.*)$/);
 if(!match||!secret||Number(match[1])<now.getTime()||Number(match[1])>now.getTime()+3600000||!timingSafeEqual(new TextEncoder().encode(match[2]),new TextEncoder().encode(signature(match[1],secret))))return new Response('Map session expired',{status:403});
 const path=match[3];if(req.method!=='GET'||!/^\/v[34]\/(vectormap|map\/styles|log\/init)(\/|$)/.test(path)||path.includes('..')||url.search.length>12000)return new Response('Unsupported map request',{status:400});
 const target=new URL(path,path.startsWith('/v4/map/styles')?'https://webapi.amap.com':'https://restapi.amap.com');
 target.search=url.search;target.searchParams.set('key',env('AMAP_JS_KEY'));target.searchParams.set('jscode',env('AMAP_SECURITY_JS_CODE'));
 try{const r=await fetcher(target.href,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok){await r.body?.cancel();return new Response('Map service unavailable',{status:502});}return new Response(r.body,{headers:{'Content-Type':r.headers.get('content-type')||'application/octet-stream','Access-Control-Allow-Origin':'*','Cache-Control':'private, max-age=60'}});}catch{return new Response('Map service unavailable',{status:502});}
}
