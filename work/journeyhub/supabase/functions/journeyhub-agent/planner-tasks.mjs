import {WorkflowError,fail,providerConfig} from './planner.mjs';
import {validateDiscovery,readSelection} from './discovery.mjs';
import {historyId,historyChoices} from './history.mjs';
import {plannerStep,dayPlanFor} from './traveler-planner.mjs';

const key=(env,name,fallback)=>{try{const value=JSON.parse(env(name)||'{}').default;if(typeof value==='string'&&value)return value;}catch{}return env(fallback)||'';};
// Fixes offered after a trip could not be planned: a different budget, later daily
// end time or one more day. Only these fields change; the whole input is revalidated.
export function plannerAdjust(raw){
 if(raw==null)return null;
 if(typeof raw!=='object'||Array.isArray(raw))fail('INVALID_INPUT','Choose a valid change to your trip.');
 const allowed=['budgetAmount','budgetCurrency','budgetScope','dayEnd','days','date'],out={};
 for(const [k,v] of Object.entries(raw)){if(!allowed.includes(k))fail('INVALID_INPUT','Choose a valid change to your trip.');out[k]=v;}
 return Object.keys(out).length?out:null;
}
const dateOf=now=>typeof now==='function'?now():now instanceof Date?now:new Date();
export function plannerRPCError(error){
 const message=String(error?.message||'');
 if(message.includes('PLANNER_ALREADY_RUNNING'))return new WorkflowError('PLANNER_ALREADY_RUNNING','Another planning task is still running. Resume it before starting a new one.',409);
 if(message.includes('PLANNER_REQUEST_CONFLICT'))return new WorkflowError('PLANNER_REQUEST_CONFLICT','This request belongs to different preferences. Start a new request.',409);
 if(message.includes('PLANNER_RETRY_LIMIT'))return new WorkflowError('PLANNER_RETRY_LIMIT','This task cannot be retried again. Review its progress and start a new request.',409);
 if(message.includes('PLANNER_INVALID')||message.includes('PLANNER_RESULT_REQUIRED'))return new WorkflowError('PLANNER_INVALID','The planning task could not be validated. Please retry.',400);
 const conflict=message.match(/\bPLAN_DATE_CONFLICT(?::(\d{4}-\d{2}-\d{2}))?/);
 if(conflict)return new WorkflowError('PLAN_DATE_CONFLICT','You already have a plan'+(conflict[1]?' for '+conflict[1]:' for these dates')+'. Open Calendar or choose other dates.',409);
 if(/rate.limit|too many|limit reached/i.test(message))return new WorkflowError('RATE_LIMIT','You have reached the planning limit. Please try again later.',429);
 if(/verified account|required.*sign in/i.test(message))return new WorkflowError('SIGN_IN_REQUIRED','Please sign in again to plan your journey.',401);
 return null;
}
export function createPlannerRPC(env,fetcher=fetch){
 return async(name,args={})=>{
  const secret=key(env,'SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY'),url=(env('SUPABASE_URL')||'').replace(/\/+$/,'');
  if(!secret||!url)fail('BACKEND_NOT_CONFIGURED','The planning backend is not configured.',503);
  const headers={apikey:secret,'Content-Type':'application/json'};if(!secret.startsWith('sb_secret_'))headers.Authorization='Bearer '+secret;
  let response;try{response=await fetcher(url+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(20000),redirect:'error'});}catch{fail('DATABASE_UNAVAILABLE','Saved planning progress could not be reached. Please retry.',503);}
  let body;try{const text=await response.text();body=text.trim()?JSON.parse(text):null;}catch{fail('DATABASE_UNAVAILABLE','Saved planning progress could not be read. Please retry.',503);}
  if(!response.ok)throw plannerRPCError(body)||new WorkflowError('DATABASE_UNAVAILABLE','Saved planning progress could not be updated. Please retry.',503);
  return body;
 };
}
function publicTask(task){
 if(!task)return null;
 // Do not forward implementation state, signed request input or model messages.
 return Object.fromEntries(['id','kind','status','stage','message','events','result','error','input','createdAt','updatedAt','stepCount','retryCount','canRetry'].filter(k=>Object.hasOwn(task,k)).map(k=>[k,task[k]]));
}
export async function plannerTaskAction(context){
 const {value,user,env,fetcher=fetch}=context,now=dateOf(context.now),rpc=context.rpc||createPlannerRPC(env,fetcher);
 if(!user?.id)fail('SIGN_IN_REQUIRED','Sign in to plan your journey.',401);
 let task;
 if(value.action==='planner_start'){
  const requestId=historyId(value.requestId),kind=value.kind,raw=value.payload;
  if(!['discover','discover_plan'].includes(kind)||!raw||typeof raw!=='object'||Array.isArray(raw))fail('INVALID_INPUT','Choose a valid planning task.');
  let payload,input;
  if(kind==='discover'){
   input=validateDiscovery(raw,now);payload={...input,action:'discover',requestId};
  }else{
   let selection=await readSelection(raw.token,context.secret,user.id,now);
   if(selection.sample||selection.ids.some(id=>id.startsWith('jh_sample_')))fail('SAMPLE_TRIP_READ_ONLY','Start a new search to plan your own journey.',409);
   const adjust=plannerAdjust(raw.adjust);
   if(adjust){
    const base=selection.input,merged={...base,...adjust};
    // Older inputs carry only a THB budget; a new amount replaces it.
    if(Object.hasOwn(adjust,'budgetAmount')){delete merged.budgetThb;delete merged.budgetCnyMinor;merged.budgetCurrency=adjust.budgetCurrency||base.budgetCurrency||'CNY';merged.budgetScope=adjust.budgetScope||base.budgetScope||'group';}
    selection={...selection,input:validateDiscovery(merged,now)};
   }
   input=validateDiscovery(selection.input,now);
   const {wanted,skipped}=historyChoices(selection.ids,raw.wanted||[],raw.skipped||[]),eligible=selection.ids.filter(id=>!skipped.includes(id));
   if(!eligible.length)fail('INSUFFICIENT_PLACES','Keep at least one place available to plan.');
   if(wanted.length>16)fail('INVALID_INPUT','Choose no more than 16 places.');
   // Persist the server-validated selection so a resumed task is not broken by
   // its original browser token expiring while the worker is still running.
   const dayPlan=dayPlanFor(raw.dayPlan,wanted,input.days);
   payload={action:'discover_plan',token:raw.token,wanted,skipped,selection,...(dayPlan?{dayPlan}:{})};
  }
  if(!providerConfig(env).ready)fail('AI_NOT_CONFIGURED','The AI service is not configured.',503);
  const useAmap=input.city==='Shanghai'&&!!env('AMAP_WEB_SERVICE_KEY');
  if(!(useAmap?env('AMAP_WEB_SERVICE_KEY'):env('GOOGLE_PLACES_API_KEY')))fail('PLACES_NOT_CONFIGURED','Live place search is not configured.',503);
  try{task=await rpc('journeyhub_planner_start',{p_user_id:user.id,p_request_id:requestId,p_kind:kind,p_payload:payload,p_input:input});}catch(error){throw plannerRPCError(error)||error;}
 }else if(value.action==='planner_status'){
  task=await rpc('journeyhub_planner_status',{p_user_id:user.id,p_id:value.id==null?null:historyId(value.id)});
  if(value.id&&!task)fail('PLANNER_NOT_FOUND','This planning task is not available for your account.',404);
 }else if(value.action==='planner_retry'){
  try{task=await rpc('journeyhub_planner_retry',{p_user_id:user.id,p_id:historyId(value.id)});}catch(error){throw plannerRPCError(error)||error;}
  if(!task)fail('PLANNER_NOT_FOUND','This planning task is not available for your account.',404);
 }else fail('INVALID_INPUT','Choose a valid planning task action.');
 task=publicTask(task);
 return {body:{task},kickoff:task?.status==='running'?{id:task.id,userId:user.id}:null};
}

function safeError(error){
 if(error instanceof WorkflowError)return {code:String(error.code).slice(0,80),message:String(error.message).slice(0,500)};
 return {code:'PLANNER_UNAVAILABLE',message:'The planning task paused because a service could not complete. Retry to continue from saved progress.'};
}
export async function runPlannerTask(kickoff,context={}){
 const {env,fetcher=fetch}=context,rpc=context.rpc||createPlannerRPC(env,fetcher),step=context.step||plannerStep;
 const clock=context.clock||Date.now,deadlineAt=clock()+85000;
 let task=await rpc('journeyhub_planner_claim',{p_user_id:kickoff.userId,p_id:kickoff.id});
 if(!task)return {processed:0,claimed:false};
 const lease=task.leaseToken;let processed=0;
 try{
  for(let i=0;i<4&&(i===0||deadlineAt-clock()>=45000);i++){
   let outcome;
   try{
    outcome=await step(task,{...context,env,fetcher,rpc,now:dateOf(context.now),user:{id:task.userId},secret:context.secret||env('JOURNEYHUB_DISCOVERY_SIGNING_KEY')||key(env,'SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY'),deadlineAt});
    if(!outcome||!['running','completed','needs_input','failed'].includes(outcome.status)||!outcome.state||typeof outcome.state!=='object'||Array.isArray(outcome.state))throw Error('invalid_step_result');
   }catch(error){outcome={state:task.state||{},status:'failed',stage:'paused',message:safeError(error).message,error:safeError(error),events:[{kind:'error',tool:'',summary:'The task paused. Successful earlier steps are saved.'}]};}
   const next=await rpc('journeyhub_planner_checkpoint',{p_user_id:task.userId,p_id:task.id,p_lease:lease,p_state:outcome.state,p_status:outcome.status,p_stage:String(outcome.stage||'working').slice(0,80),p_message:String(outcome.message||'Planning your journey.').slice(0,500),p_events:(outcome.events||[]).slice(0,8),p_result:outcome.result||null,p_error:outcome.error||null});
   if(!next)return {processed,claimed:true,stale:true};
   processed++;if(outcome.status!=='running')return {processed,claimed:true,status:outcome.status};
   task={...task,state:outcome.state,stepCount:next.stepCount};
  }
  return {processed,claimed:true,status:'running'};
 }finally{await rpc('journeyhub_planner_release',{p_user_id:task.userId,p_id:task.id,p_lease:lease}).catch(()=>{});}
}
