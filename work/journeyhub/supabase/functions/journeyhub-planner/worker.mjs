import {createPlannerRPC,runPlannerTask} from '../journeyhub-agent/planner-tasks.mjs';
export function createPlannerWorker({env,fetcher=fetch,rpc:injectedRPC,run=runPlannerTask,now=()=>new Date()}={}){
 const rpc=injectedRPC||createPlannerRPC(env,fetcher);
 return async req=>{
  const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
  const bearer=req.headers.get('Authorization')?.match(/^Bearer ([^\s]{32,256})$/i)?.[1];if(!bearer)return reply({error:'unauthorized'},401);
  try{
   const secret=env('JOURNEYHUB_AGENT_WORKER_SECRET')||(await rpc('journeyhub_agent_worker_config',{}))?.worker_secret;
   if(typeof secret!=='string'||secret.length<32)return reply({error:'worker_not_configured'},503);
   const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
   const [a,b]=await Promise.all([hash(bearer),hash(secret)]);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];if(difference)return reply({error:'unauthorized'},401);
   const due=await rpc('journeyhub_planner_due',{p_limit:2});if(!Array.isArray(due)||due.length>2)throw Error('invalid_queue');
   const outcomes=await Promise.all(due.map(async kickoff=>{try{return await run(kickoff,{env,fetcher,rpc,now});}catch{return {failed:true};}}));
   return reply({processed:outcomes.reduce((n,x)=>n+(x.processed||0),0),failed:outcomes.filter(x=>x.failed).length});
  }catch{return reply({error:'planner_worker_unavailable'},503);}
 };
}
