import {careAction} from '../journeyhub-agent/care.mjs';
const key=(env,name,fallback)=>{try{const value=JSON.parse(env(name)||'{}').default;if(value)return value;}catch{}return env(fallback)||'';};
export function createCareWorker({env,fetcher=fetch,rpc:injectedRPC,now=()=>new Date()}){
 const rpc=injectedRPC||(async(name,args={})=>{
  const secret=key(env,'SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY'),headers={apikey:secret,'Content-Type':'application/json'};
  if(!secret.startsWith('sb_secret_'))headers.Authorization='Bearer '+secret;
  const r=await fetcher((env('SUPABASE_URL')||'')+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!r.ok){await r.body?.cancel();throw Error('database_unavailable');}const text=await r.text();return text?JSON.parse(text):null;
 });
 return async req=>{
  const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
  const bearer=req.headers.get('Authorization')?.match(/^Bearer ([^\s]{32,256})$/i)?.[1];if(!bearer)return reply({error:'unauthorized'},401);
  try{
   const secret=env('JOURNEYHUB_AGENT_WORKER_SECRET')||(await rpc('journeyhub_agent_worker_config'))?.worker_secret;
   if(typeof secret!=='string'||secret.length<32)return reply({error:'worker_not_configured'},503);
   const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
   const [a,b]=await Promise.all([hash(bearer),hash(secret)]);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];if(difference)return reply({error:'unauthorized'},401);
   const due=await rpc('journeyhub_care_due',{p_limit:2});if(!Array.isArray(due)||due.length>2)throw Error('invalid_queue');
   const results=await Promise.all(due.map(async item=>{try{await careAction({value:{action:'care_check',id:item.id},user:{id:item.userId},env,fetcher,rpc,now:now()});return true;}catch{return false;}}));
   return reply({checked:results.filter(Boolean).length,failed:results.filter(x=>!x).length});
  }catch{return reply({error:'care_worker_unavailable'},503);}
 };
}
