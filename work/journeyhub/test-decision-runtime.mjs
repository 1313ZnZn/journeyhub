import assert from 'node:assert/strict';
import {decisionConfig,requestDecision} from './supabase/functions/journeyhub-agent/decision-runtime.mjs';
import {createAgentHandler} from './supabase/functions/journeyhub-agent/handler.mjs';

const secret='fixture-service-token-01234567890123456789';
const settings={JOURNEYHUB_AGENT_RUNTIME:'python-langchain',JOURNEYHUB_AGENT_SERVICE_URL:'https://agent.example.invalid',JOURNEYHUB_AGENT_SERVICE_TOKEN:secret};
const env=k=>settings[k];
const tools=[{type:'function',function:{name:'respond',description:'Reply',parameters:{type:'object',properties:{items:{type:'array',items:{type:'string'}}},required:['items'],additionalProperties:false}}}];
const input={env,agent:'trip_chat',system:'Choose a tool.',observation:{request:'fixture'},tools,maxTokens:2600};
const output={version:1,call:{name:'respond',args:{items:['Verified.']}},invalid:null,usage:{input_tokens:100,output_tokens:20},attempts:1};
assert.equal(decisionConfig(env).ready,true);
assert.equal(decisionConfig(k=>({DEEPSEEK_API_KEY:'fixture'}[k])).runtime,'legacy');
for(const patch of [
 {JOURNEYHUB_AGENT_RUNTIME:'misspelled'},
 {JOURNEYHUB_AGENT_SERVICE_TOKEN:''},
 {JOURNEYHUB_AGENT_SERVICE_URL:'http://agent.example.invalid'},
 {JOURNEYHUB_AGENT_SERVICE_URL:'https://user:secret@agent.example.invalid'},
 {JOURNEYHUB_AGENT_SERVICE_URL:'https://agent.example.invalid?secret=x'},
 {JOURNEYHUB_AGENT_SERVICE_URL:'http://127.0.0.1:8000'},
 {JOURNEYHUB_AGENT_SERVICE_URL:'https://agent.example.invalid/path'},
])assert.equal(decisionConfig(k=>({...settings,...patch}[k])).ready,false);
assert.equal(decisionConfig(k=>({...settings,JOURNEYHUB_AGENT_SERVICE_URL:'http://127.0.0.1:8000',JOURNEYHUB_AGENT_ALLOW_LOCAL:'true'}[k])).ready,true);
let calls=0;
const result=await requestDecision({...input,fetcher:async(url,options)=>{
 calls++;assert.equal(url,settings.JOURNEYHUB_AGENT_SERVICE_URL+'/v1/decide');assert.equal(options.redirect,'error');
 assert.equal(options.headers.Authorization,'Bearer '+secret);assert(options.signal);
 const body=JSON.parse(options.body);assert.equal(body.agent,'trip_chat');assert.equal(body.max_output_tokens,2600);
 assert(!options.body.includes(secret));assert(!options.body.includes('SUPABASE'));return Response.json(output);
}});
assert.equal(calls,1);assert.equal(result.usage.prompt_tokens,100);assert.equal(result.choices[0].message.tool_calls[0].function.name,'respond');
for(const value of [
 {...output,version:2}, {...output,call:{name:'delete_account',args:{}}},
 {...output,call:{name:'respond',args:[]}}, {...output,usage:{input_tokens:-1,output_tokens:0}},
 {...output,call:null}, {...output,invalid:'contradictory'}, {...output,attempts:3},
])await assert.rejects(requestDecision({...input,fetcher:async()=>Response.json(value)}),{code:'AGENT_SERVICE_RESPONSE'});
const invalid=await requestDecision({...input,fetcher:async()=>Response.json({...output,call:null,invalid:'schema_failed',attempts:2})});
assert.deepEqual(invalid.choices[0].message.tool_calls,[]);
for(const response of [new Response('PRIVATE diagnostic',{status:500}),new Response('x'.repeat(65537)),new Response('invalid-json')]){
 await assert.rejects(requestDecision({...input,fetcher:async()=>response}),error=>error.code==='AGENT_SERVICE_UNAVAILABLE'&&!error.message.includes('PRIVATE'));
}
await assert.rejects(requestDecision({...input,observation:{request:'x'.repeat(262144)},fetcher:()=>{throw Error('must not fetch');}}),{code:'AGENT_CONTEXT_LIMIT'});
// Config errors never silently send conversations to the legacy model instead.
await assert.rejects(requestDecision({...input,env:k=>({...settings,JOURNEYHUB_AGENT_SERVICE_TOKEN:'',DEEPSEEK_API_KEY:'fixture'}[k]),fetcher:()=>{throw Error('must not fetch');}}),{code:'AI_NOT_CONFIGURED'});
const handler=createAgentHandler({envGet:env,rpc:async()=>({scheduled:true}),logMetric:()=>{}});
const health=await (await handler(new Request('https://fixture.invalid/?action=health'))).text();
assert(!health.includes(secret));assert(!health.includes(settings.JOURNEYHUB_AGENT_SERVICE_URL));
assert.deepEqual(JSON.parse(health).agentRuntime,{configured:true,runtime:'python-langchain'});
console.log('PASS decision runtime: authenticated contract, bounded transport, config validation, strict responses, no credential leakage or silent provider fallback.');
