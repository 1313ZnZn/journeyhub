import {research} from './research.mjs';
const env=(name:string)=>Deno.env.get(name),f=fetch;
async function rpc(name:string,args={}){
 let key=env('SUPABASE_SERVICE_ROLE_KEY')||'';try{key=JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}').default||key;}catch{}
 const headers:Record<string,string>={apikey:key,'Content-Type':'application/json'};if(!key.startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
 const r=await f(env('SUPABASE_URL')+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
 if(!r.ok){await r.body?.cancel();throw Error('database');}return r.json();
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return new Response(null,{status:405});
 const bearer=req.headers.get('authorization')?.match(/^Bearer ([^\s]{32,256})$/)?.[1];if(!bearer)return new Response(null,{status:401});
 try{
 const key=env('JOURNEYHUB_AGENT_WORKER_SECRET')||(await rpc('journeyhub_agent_worker_config'))?.worker_secret;if(!key)return new Response(null,{status:503});
 const dig=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const [a,b]=await Promise.all([dig(bearer),dig(key)]);if(a.reduce((d,v,i)=>d|(v^b[i]),0))return new Response(null,{status:401});
 // Read-only operational check: a fixed venue outside the seeded shortlist. No user input or live trip is modified.
 const action=(await req.json().catch(()=>({})))?.action;
 if(action==='self_check'){const trace:any[]=[];const day=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const result=await research({source_type:'run',label:'National Gallery Singapore',city:'Singapore',lat:1.29,lng:103.851,stop_id:'self-check',visit_date:day},{env,trace:x=>trace.push(x)});return Response.json({result,trace});}
 const jobs=await rpc('journeyhub_visit_claim');const done=await Promise.all(jobs.map(async(j:any)=>{let result;try{result=await research(j,{env});}catch{result={state:'unconfirmed',facts:{},transient:true};}return await rpc('journeyhub_visit_finish',{p_lease:j.lease,p_facts:result.facts,p_state:result.state,p_transient:result.transient});}));
 return Response.json({checked:done.filter(Boolean).length});
 }catch{return new Response(null,{status:503});}
});
