import {amapBrowserConfig,amapBrowserProxy} from './amap-browser.mjs';
import {WorkflowError,fail,validateInput,providerConfig,generatePlan} from './planner.mjs';
import {decisionConfig} from './decision-runtime.mjs';
import {getMailReadiness} from '../_shared/agent-mail.mjs';
import {discoveryAction,historyAction} from './discovery.mjs';
import {careAction} from './care.mjs';
import {careChatAction,runCareChat,careChatRPCError} from './care-chat.mjs';
import {demoAction,demoDatabaseError} from './demo-wallet.mjs';
import {revisionAction} from './revisions.mjs';
import {requestTiming} from './timing.mjs';
import {createCalendarWeather} from './calendar-weather.mjs';
import {plannerTaskAction,runPlannerTask,plannerRPCError} from './planner-tasks.mjs';
import {pipChat} from './pip-chat.mjs';
import {placeDebate} from './pip-debate.mjs';
import {memoryRecap} from './pip-memory.mjs';
import {leaderboard,debateResult} from './leaderboard.mjs';

function keyFrom(env,name,fallback){try{const value=JSON.parse(env(name)||'{}').default;if(typeof value==='string'&&value)return value;}catch{}return env(fallback)||'';}
function backendConfig(env){return {url:(env('SUPABASE_URL')||'').replace(/\/+$/,''),publicKey:keyFrom(env,'SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY'),serviceKey:keyFrom(env,'SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY')};}
export async function boundedJSON(req) {
  if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail('INVALID_INPUT','Send an application/json request.');
  if(Number(req.headers.get('content-length'))>12000)fail('REQUEST_TOO_LARGE','The request is too large.',413);
  const reader=req.body?.getReader();if(!reader)fail('INVALID_INPUT','The request is empty.');
  let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12000){await reader.cancel();fail('REQUEST_TOO_LARGE','The request is too large.',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('INVALID_INPUT','Send a valid JSON request.');}
}
function databaseError(error){
  const chat=careChatRPCError(error);if(chat)return chat;
  const planner=plannerRPCError(error);if(planner)return planner;
  const demo=demoDatabaseError(error);if(demo)return demo;
  const message=String(error?.message||'');
  if(message.includes('CARE_PROPOSAL_STALE'))return new WorkflowError('CARE_PROPOSAL_STALE','This adjustment changed or expired. Refresh checks and review a new proposal.',409);
  if(message.includes('CARE_UNSAFE_ADJUSTMENT'))return new WorkflowError('CARE_UNSAFE_ADJUSTMENT','This adjustment cannot keep a complete, valid itinerary. Review the plan.',409);
  if(message.includes('CARE_RESERVATION_PROTECTED'))return new WorkflowError('CARE_RESERVATION_PROTECTED','A confirmed reservation now protects this stop. Review its ticket before changing the plan.',409);
  if(message.includes('EDIT_STALE'))return new WorkflowError('EDIT_STALE','This trip changed in another tab. Reopen it and preview your edit again.',409);
  if(message.includes('EDIT_REQUEST_REUSED'))return new WorkflowError('EDIT_REQUEST_REUSED','This edit request was already used. Create a new preview.',409);
  if(message.includes('EDIT_NOT_FOUND'))return new WorkflowError('EDIT_NOT_FOUND','This trip is unavailable or deleted. Restore it before editing.',404);
  if(message.includes('EDIT_INVALID'))return new WorkflowError('EDIT_INVALID','This edit does not match your saved trip. Preview it again.',400);
  const dateConflict=message.match(/\bPLAN_DATE_CONFLICT(?::(\d{4}-\d{2}-\d{2}))?/);
  if(dateConflict)return new WorkflowError('PLAN_DATE_CONFLICT','You already have a plan'+(dateConflict[1]?' for '+dateConflict[1]:' for these dates')+'. Open Calendar, or delete the existing plan before creating another.',409);
  if(/rate.limit|too many|limit reached/i.test(message))return new WorkflowError('RATE_LIMIT','You have reached the planning limit. Please try again later.',429);
  if(/sign in|authentication|verified|verify.*email|confirm.*email|profile.*missing/i.test(message))return new WorkflowError('ACCOUNT_REQUIRED','Please sign in with a verified traveler account.',403);
  if(/request.*used|different.*request|conflict|planning.*progress/i.test(message))return new WorkflowError('REQUEST_CONFLICT','This request is already being processed or has changed. Refresh your trip status.',409);
  if(/available|capacity|closed|seat|date|price|overlap|travel.time|budget|session|activity.hours|trip.input|preference/i.test(message))return new WorkflowError('CATALOG_CHANGED','The itinerary no longer matches your preferences, available sessions or prices. Please generate a new plan.',409);
  return new WorkflowError('WORKFLOW_UNAVAILABLE','JourneyHub could not save this workflow. Please retry.',503);
}
export function createAgentHandler({envGet,fetchImpl=fetch,rpc:injectedRPC,authenticate:injectedAuth,generate:injectedGenerate,now=()=>new Date(),logMetric,waitUntil}={}) {
  const env=envGet||(()=>undefined),db=backendConfig(env);
  const calendarWeather=createCalendarWeather();
  const baseRPC=injectedRPC||async function(name,args){
    if(!db.url||!db.serviceKey)fail('BACKEND_NOT_CONFIGURED','The workflow backend is not configured.',503);
    const headers={apikey:db.serviceKey,'Content-Type':'application/json'};
    if(!db.serviceKey.startsWith('sb_secret_'))headers.Authorization='Bearer '+db.serviceKey;
    let response;try{response=await fetchImpl(db.url+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(20000),redirect:'error'});}catch{fail('DATABASE_UNAVAILABLE','JourneyHub could not reach the workflow database.',503);}
    let body;try{const text=await response.text();body=text.trim()?JSON.parse(text):null;}catch{fail('DATABASE_UNAVAILABLE','JourneyHub could not read the workflow status.',503);}
    if(!response.ok)throw databaseError(body);return body;
  };
  const authenticate=injectedAuth||async function(req){
    const authorization=req.headers.get('authorization')||'';
    if(!/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)||authorization.length>12000)fail('SIGN_IN_REQUIRED','Sign in to create an AI itinerary.',401);
    if(!db.url||!db.publicKey)fail('BACKEND_NOT_CONFIGURED','The workflow backend is not configured.',503);
    let response;try{response=await fetchImpl(db.url+'/auth/v1/user',{headers:{apikey:db.publicKey,Authorization:authorization},signal:AbortSignal.timeout(15000),redirect:'error'});}catch{fail('AUTH_UNAVAILABLE','Could not verify your sign-in. Please retry.',503);}
    if(!response.ok){await response.body?.cancel();fail('SIGN_IN_REQUIRED','Your session has expired. Please sign in again.',401);}
    const user=await response.json();
    if(!user?.id||user.is_anonymous||!user.email_confirmed_at)fail('VERIFIED_ACCOUNT_REQUIRED','Confirm your email and sign in to create an AI itinerary.',403);
    return user;
  };
  return async function(req){
    const timing=requestTiming({log:logMetric}),measure=(stage,task)=>timing.measure(stage,task),rpc=(...args)=>measure('database',()=>baseRPC(...args));
    const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Cache-Control':'no-store'};
    const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,...(req.method==='POST'?{'Server-Timing':'workflow;dur='+timing.finish(status)}:{}),'Content-Type':'application/json; charset=utf-8'}});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    let runId,planningToken;
    try{
      if(new URL(req.url).pathname.includes('/amap/'))return amapBrowserProxy(req,env,db.serviceKey,fetchImpl,now());
      if(req.method==='GET'&&new URL(req.url).searchParams.get('action')==='maps_config'){
        // This is deliberately a separate, HTTP-referrer-restricted public browser key.
        // NEVER fall back to a Places/Routes/server key here.
        const candidate=env('GOOGLE_MAPS_BROWSER_KEY')||'';
        const key=[env('GOOGLE_PLACES_API_KEY'),env('GOOGLE_ROUTES_API_KEY'),db.serviceKey].includes(candidate)?'':candidate;
        return reply({browserKey:key,ready:!!key});
      }
      if(req.method==='GET'&&new URL(req.url).searchParams.get('action')==='health'){
        const ai=providerConfig(env),decision=decisionConfig(env),mail=getMailReadiness(env);let worker={ready:false};
        try{const config=await rpc('journeyhub_agent_worker_config',{});worker={ready:!!config?.scheduled};}catch{}
        return reply({ai:{ready:ai.ready,provider:ai.provider,model:ai.model},agentRuntime:{configured:decision.ready,runtime:decision.runtime},discovery:{ready:!!(env('GOOGLE_PLACES_API_KEY')||env('AMAP_WEB_SERVICE_KEY'))&&decision.ready,provider:'Amap (Shanghai) / Google Places (overseas)',amap:!!env('AMAP_WEB_SERVICE_KEY'),google:!!env('GOOGLE_PLACES_API_KEY')},email:{ready:mail.ready,provider:mail.provider||'Not configured'},worker,booking:{mode:'journeyhub_catalog',sample:true}});
      }
      if(req.method!=='POST')return reply({error:{code:'METHOD_NOT_ALLOWED',message:'Use POST to create an itinerary.'}},405);
      const user=await measure('auth',()=>authenticate(req)),value=await boundedJSON(req);timing.action(value?.action);
      if(value?.action==='amap_config')return reply(amapBrowserConfig(env,db.serviceKey,now()));
      if(value?.action==='pip_chat')return reply(await pipChat({value,user,env,fetcher:fetchImpl,rpc,now:now()}));
      if(value?.action==='leaderboard')return reply(await leaderboard({value,rpc}));
      if(value?.action==='debate_result')return reply(await debateResult({value,user,rpc,now:now(),secret:env('JOURNEYHUB_DISCOVERY_SIGNING_KEY')||db.serviceKey}));
      if(value?.action==='memory_recap')return reply(await memoryRecap({value,user,env,fetcher:fetchImpl,rpc}));
    if(value?.action==='place_debate')return reply(await placeDebate({value,user,env,fetcher:fetchImpl,rpc,now:now(),secret:env('JOURNEYHUB_DISCOVERY_SIGNING_KEY')||db.serviceKey}));
      if(value?.action==='calendar_weather')return reply(await calendarWeather(value.city,{env,fetcher:fetchImpl,now:now()}));
      if(['planner_start','planner_status','planner_retry'].includes(value?.action)){
        const context={value,user,env,fetcher:fetchImpl,rpc,now:now(),secret:env('JOURNEYHUB_DISCOVERY_SIGNING_KEY')||db.serviceKey};
        const {body,kickoff}=await plannerTaskAction(context);
        // A durable queue remains authoritative if the browser closes or this
        // instance stops. Status responses never wait for AI/provider work.
        if(kickoff&&waitUntil)waitUntil(runPlannerTask(kickoff,context).catch(()=>{}));
        return reply(body,['queued','running'].includes(body.task?.status)?202:200);
      }
      if(['care_chat_history','care_chat','care_chat_apply','care_chat_pay'].includes(value?.action)){
        const context={value,user,env,fetcher:fetchImpl,rpc,now:now()};
        const {body,kickoff}=await careChatAction(context);
        // Replies and proposed edits are persisted before a client sees them.
        // Polling can reclaim an expired request; model work never blocks status.
        if(kickoff&&waitUntil)waitUntil(runCareChat(kickoff,context).catch(()=>{}));
        return reply(body,['queued','pending','running'].includes(body.conversation?.pending?.status)?202:200);
      }
      if(['demo_state','demo_topup','demo_quote','demo_session_quote','demo_book','demo_cancel'].includes(value?.action))return reply(await demoAction({value,user,env,fetcher:fetchImpl,rpc,now:now()}));
      if(['discover_revise','discover_revise_apply'].includes(value?.action))return reply(await revisionAction({value,user,env,fetcher:fetchImpl,rpc,measure,now:now(),secret:env('JOURNEYHUB_DISCOVERY_SIGNING_KEY')||db.serviceKey}));
      if(['care_confirm','care_status','care_check','care_event','care_accept','care_stop'].includes(value?.action))return reply(await careAction({value,user,env,fetcher:fetchImpl,rpc,now:now()}));
      if(['history_list','history_open','history_refresh','history_choices','history_import'].includes(value?.action))return reply(await historyAction({value,user,env,fetcher:fetchImpl,rpc,measure,now:now(),secret:env('JOURNEYHUB_DISCOVERY_SIGNING_KEY')||db.serviceKey}));
      if(['discover','discover_plan'].includes(value?.action))return reply(await discoveryAction({value,user,env,fetcher:fetchImpl,rpc,measure,now:now(),secret:env('JOURNEYHUB_DISCOVERY_SIGNING_KEY')||db.serviceKey}));
      const {requestId,input}=validateInput(value,now()),config=providerConfig(env);
      if(!config.ready)fail('AI_NOT_CONFIGURED','The AI service has not been configured yet. Your existing JourneyHub features remain available.',503);
      const started=await rpc('journeyhub_agent_begin',{p_user_id:user.id,p_request_id:requestId,p_input:input});
      if(started.cached)return reply({run:started.run},started.status==='planning'?202:200);
      runId=started.id;planningToken=started.planning_token;
      if(!runId||!planningToken)fail('WORKFLOW_UNAVAILABLE','JourneyHub could not start this workflow.',503);
      const progress=stage=>rpc('journeyhub_agent_progress',{p_run_id:runId,p_planning_token:planningToken,p_stage:stage});
      await progress('checking_catalog');
      const catalog=await rpc('journeyhub_agent_catalog_trip',{p_input:input});
      if(!Array.isArray(catalog)||!catalog.length)fail('NO_AVAILABILITY','No sessions match these dates, activity hours and preferences. Try another date or wider hours.',409);
      await progress('planning');
      // The database lease lasts two minutes. Stop provider work after 90 seconds
      // from its actual claim time, leaving time for validation/finalization RPCs.
      const claimedAt=Date.parse(started.run?.updatedAt);
      const deadlineAt=(Number.isFinite(claimedAt)?claimedAt:Date.now())+90000;
      const result=await measure('catalog_schedule',()=>(injectedGenerate||generatePlan)(config,input,()=>Promise.resolve(catalog),fetchImpl,{deadlineAt}));
      await progress('validating');
      const run=await rpc('journeyhub_agent_finalize',{p_run_id:runId,p_planning_token:planningToken,p_plan:result.plan,p_model:result.model,p_response_id:result.responseId});
      return reply({run});
    }catch(error){
      const safe=error instanceof WorkflowError?error:new WorkflowError('WORKFLOW_UNAVAILABLE','The workflow could not complete. Please retry.',503);
      if(runId&&planningToken){try{await rpc('journeyhub_agent_fail',{p_run_id:runId,p_planning_token:planningToken,p_code:safe.code});}catch{}}
      // Never return provider response bodies, request prompts, tokens or SQL diagnostics.
      return reply({error:{code:safe.code,message:safe.message}},safe.status);
    }
  };
}
