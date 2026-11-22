// The Python service owns model decisions and schema repair. Existing workers
// still own authorization, tool execution, deadlines and durable checkpoints.
import {fail,providerConfig} from './planner.mjs';
import {jsonFetch} from './discovery.mjs';

export function decisionConfig(env){
 const runtime=(env('JOURNEYHUB_AGENT_RUNTIME')||'legacy').trim();
 if(runtime==='legacy'){
  const config=providerConfig(env);
  return {...config,runtime,ready:config.ready&&config.protocol==='chat-completions'};
 }
 if(runtime!=='python-langchain')return{runtime,ready:false};
 const base=(env('JOURNEYHUB_AGENT_SERVICE_URL')||'').replace(/\/+$/,''),token=env('JOURNEYHUB_AGENT_SERVICE_TOKEN')||'';
 let valid=false;
 try{
  const u=new URL(base),loopback=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  const local=u.protocol==='http:'&&loopback&&env('JOURNEYHUB_AGENT_ALLOW_LOCAL')==='true';
  valid=(u.protocol==='https:'||local)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'
   &&(!loopback||env('JOURNEYHUB_AGENT_ALLOW_LOCAL')==='true');
 }catch{}
 return{runtime,base,token,ready:valid&&token.length>=32,provider:'python-langchain',model:'Configured in Python service'};
}

async function boundedResponse(response){
 if(!response.body)throw Error('empty_response');
 const reader=response.body.getReader(),parts=[];let bytes=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536)throw Error('large_response');parts.push(value);}
 }finally{await reader.cancel();}
 const buffer=new Uint8Array(bytes);let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.byteLength;}
 return JSON.parse(new TextDecoder().decode(buffer));
}

export async function requestDecision({env,fetcher=fetch,agent,system,observation,tools,maxTokens}){
 const config=decisionConfig(env);
 if(!config.ready)fail('AI_NOT_CONFIGURED','The agent decision service is not configured.',503);
 if(config.runtime==='legacy')return jsonFetch(config.base+'/chat/completions',{
  method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},
  body:JSON.stringify({model:config.model,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(observation)}],tools,tool_choice:'auto',parallel_tool_calls:false,max_tokens:maxTokens,...(config.provider==='deepseek'?{thinking:{type:'disabled'}}:{})})
 },fetcher);
 const body=JSON.stringify({version:1,agent,system,observation,tools,max_output_tokens:maxTokens});
 if(new TextEncoder().encode(body).byteLength>262144)fail('AGENT_CONTEXT_LIMIT','This conversation is too large for one agent decision.',503);
 let data;
 try{
  const response=await fetcher(config.base+'/v1/decide',{
   method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},
   body,signal:AbortSignal.timeout(38000),redirect:'error'
  });
  if(!response.ok){await response.body?.cancel();throw Error('decision_service_error');}
  data=await boundedResponse(response);
 }catch{fail('AGENT_SERVICE_UNAVAILABLE','The agent decision service could not respond. Please retry.',503);}
 const usage=data?.usage,call=data?.call;
 const validUsage=usage&&['input_tokens','output_tokens'].every(k=>Number.isSafeInteger(usage[k])&&usage[k]>=0);
 if(data?.version!==1||!validUsage||![1,2].includes(data.attempts)
  ||(call!==null&&(!call||typeof call.name!=='string'||!call.args||typeof call.args!=='object'||Array.isArray(call.args)||!tools.some(t=>t.function.name===call.name)))
  ||(call!==null&&data.invalid!==null)||(call===null&&typeof data.invalid!=='string'))
  fail('AGENT_SERVICE_RESPONSE','The agent returned an invalid decision. Please retry.',502);
 // Preserve the existing caller's parsing, accounting and semantic validation.
 // No remote prose, credentials or diagnostic text enters the conversation.
 return{choices:[{finish_reason:call?'tool_calls':'stop',message:{tool_calls:call?[{type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]:[]}}],usage:{prompt_tokens:usage.input_tokens,completion_tokens:usage.output_tokens}};
}
