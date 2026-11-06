const assert=require('node:assert/strict');
(async()=>{
  const {validateInput,providerConfig,validatePlan,generatePlan,estimateTravel,parsePlanResponse,requiredActivityDates}=await import('./supabase/functions/journeyhub-agent/planner.mjs');
  const {createAgentHandler}=await import('./supabase/functions/journeyhub-agent/handler.mjs');
  const now=new Date('2026-10-23T10:00:00Z'),reqId='c7e6a003-82c2-4fa6-8e7a-cb7e9601e111';
  const body={action:'plan',requestId:reqId,city:'Shanghai',date:'2026-10-24',guests:2,prompt:'A relaxed day with tea',budgetThb:6000};
  const input=validateInput(body,now).input;
  assert.equal(input.days,1);assert.equal(input.dayStart,'09:00');assert.equal(input.dayEnd,'21:00');assert.equal(input.transport,'drive');
  assert.deepEqual(input.preferredExperienceIds,[]);assert.deepEqual(input.excludedExperienceIds,[]);
  for(const bad of [{...body,city:'__proto__'},{...body,date:'2026-02-31'},{...body,guests:0},{...body,date:'2020-01-01'},{...body,budgetThb:'100'},{...body,requestId:'not-uuid'},{...body,prompt:'a'.repeat(2001)}])assert.throws(()=>validateInput(bad,now));
  for(const extra of [{days:0},{days:5},{days:1.5},{dayStart:'9:00'},{dayEnd:'24:00'},{dayStart:'18:00',dayEnd:'09:00'},{transport:'teleport'},{preferredExperienceIds:['sh-tea','sh-tea']},{excludedExperienceIds:[1]},{preferredExperienceIds:['sh-tea'],excludedExperienceIds:['sh-tea']},{preferredExperienceIds:['<script>']}])assert.throws(()=>validateInput({...body,...extra},now));
  assert.equal(providerConfig(()=>undefined).ready,false);
  const secrets={JOURNEYHUB_AI_PROVIDER:'openai',OPENAI_API_KEY:'test-only-not-a-real-key'};
  const env=n=>secrets[n],config=providerConfig(env);
  assert.equal(config.ready,true);assert.equal(config.protocol,'responses');
  assert.equal(providerConfig(n=>({...secrets,JOURNEYHUB_AI_BASE_URL:'http://localhost/'}[n])).ready,false);
  const catalog=[{sessionId:'sh-1',title:'Bund walk',city:'Shanghai',startsAt:'2026-10-24T01:00:00Z',endsAt:'2026-10-24T03:00:00Z',unitPriceThb:1200,seatsLeft:8},{sessionId:'sh-2',title:'Tea',city:'Shanghai',startsAt:'2026-10-24T04:00:00Z',endsAt:'2026-10-24T05:00:00Z',unitPriceThb:1100,seatsLeft:8}];
  const plan={summary:'A relaxed day.',stops:[{sessionId:'sh-1',reason:'River views.'},{sessionId:'sh-2',reason:'Tea to finish.'}],tips:['Allow time between sessions.']};
  assert.deepEqual(validatePlan(plan,catalog,input),plan);
  assert.throws(()=>validatePlan({...plan,stops:[{sessionId:'invented',reason:''}]},catalog,input));
  assert.throws(()=>validatePlan({...plan,stops:[plan.stops[0],plan.stops[0]]},catalog,input));
  assert.deepEqual(validatePlan({...plan,stops:[...plan.stops].reverse()},catalog,input),plan);
  assert.throws(()=>validatePlan(plan,catalog,{...input,budgetThb:100}));
  assert.throws(()=>validatePlan(plan,[catalog[0],{...catalog[1],startsAt:'2026-10-24T03:15:00Z'}],input));
  const multiInput=validateInput({...body,days:2,transport:'walk',preferredExperienceIds:['sh-tea'],excludedExperienceIds:['sh-skip']},now).input;
  const multiCatalog=[{...catalog[0],experienceId:'sh-bund',lat:31.238028,lng:121.486139},{...catalog[1],experienceId:'sh-tea',lat:31.229167,lng:121.4875},{...catalog[0],sessionId:'day-2',experienceId:'sh-day2',startsAt:'2026-10-25T01:00:00Z',endsAt:'2026-10-25T03:00:00Z'}];
  const multiPlan={...plan,stops:[...plan.stops,{sessionId:'day-2',reason:'Second day.'}]};
  assert.deepEqual(validatePlan(multiPlan,multiCatalog,{...multiInput,budgetThb:9000}),multiPlan);
  const unorderedMulti={...multiPlan,stops:[multiPlan.stops[2],multiPlan.stops[1],multiPlan.stops[0]]};
  const unorderedSnapshot=JSON.stringify(unorderedMulti),catalogSnapshot=JSON.stringify(multiCatalog);
  assert.deepEqual(validatePlan(unorderedMulti,multiCatalog,{...multiInput,budgetThb:9000}),multiPlan,'catalog times normalize cross-day array order while preserving selected IDs/reasons');
  assert.equal(JSON.stringify(unorderedMulti),unorderedSnapshot,'normalization does not mutate the provider input');
  assert.equal(JSON.stringify(multiCatalog),catalogSnapshot,'normalization does not mutate the authoritative catalog');
  assert.throws(()=>validatePlan(unorderedMulti,[multiCatalog[0],{...multiCatalog[1],startsAt:'2026-10-24T02:30:00Z'},multiCatalog[2]],{...multiInput,budgetThb:9000}),e=>e.code==='AI_INVALID_PLAN','sorting cannot make a genuine overlapping selection valid');
  assert.throws(()=>validatePlan(multiPlan,multiCatalog,{...multiInput,days:1,budgetThb:9000}));
  assert.throws(()=>validatePlan(plan,multiCatalog,{...multiInput,excludedExperienceIds:['sh-tea']}));
  assert.throws(()=>validatePlan(plan,multiCatalog,{...multiInput,dayStart:'10:00'}));
  assert.throws(()=>validatePlan(plan,multiCatalog,{...multiInput,dayEnd:'12:30'}));
  assert.throws(()=>validatePlan(plan,[multiCatalog[0],{...multiCatalog[1],city:'Bangkok'}],multiInput));
  assert.equal(estimateTravel({},{}).basis,'fallback');assert.equal(estimateTravel({},{}).durationMinutes,30);
  assert.equal(estimateTravel({lat:31.2,lng:121.4},{lat:31.2,lng:121.4},'walk').durationMinutes,15);
  const walk=estimateTravel({lat:31.2,lng:121.4},{lat:31.3,lng:121.5},'walk'),drive=estimateTravel({lat:31.2,lng:121.4},{lat:31.3,lng:121.5},'drive');
  assert(walk.durationMinutes>drive.durationMinutes);assert.equal(walk.estimated,true);assert.equal(walk.distanceKm,drive.distanceKm);
  assert.throws(()=>validatePlan(plan,[multiCatalog[0],{...multiCatalog[1],lat:32,lng:122}],multiInput));
  let requests=[],reads=0;
  const response=v=>new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}});
  const fetcher=async(url,options)=>{requests.push({url,body:JSON.parse(options.body),headers:options.headers});return requests.length===1?response({output:[{type:'function_call',name:'get_available_sessions',call_id:'call-1',arguments:'{}'}]}):response({id:'response-2',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(plan)}]}]});};
  const generated=await generatePlan(config,input,async()=>{reads++;return catalog;},fetcher);
  assert.equal(reads,1);assert.equal(requests.length,2);assert.deepEqual(generated.plan,plan);
  assert.equal(requests[0].body.tools[0].name,'get_available_sessions');
  assert.equal(requests[0].body.store,false);assert.equal(requests[1].body.store,false);
  assert.equal(requests[1].body.input.at(-1).type,'function_call_output');
  assert(!JSON.stringify(requests).includes('service_role'));
  // Provider cannot request a booking tool, skip the catalog, or fabricate success.
  await assert.rejects(generatePlan(config,input,async()=>catalog,async()=>response({output:[{type:'function_call',name:'book_ticket',call_id:'x',arguments:'{}'}]})),e=>e.code==='AI_INVALID_RESPONSE');
  await assert.rejects(generatePlan(config,input,async()=>catalog,async()=>new Response('private-provider-details',{status:401})),e=>e.code==='AI_CONFIGURATION'&&!e.message.includes('private-provider'));
  requests=[];
  const chatConfig=providerConfig(name=>({DEEPSEEK_API_KEY:'test-only-not-a-real-key'}[name]));
  assert.equal(chatConfig.provider,'deepseek');assert.equal(chatConfig.model,'deepseek-flash');
  const chat=await generatePlan(chatConfig,input,async()=>catalog,async(url,options)=>{requests.push(JSON.parse(options.body));return requests.length===1?response({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'tool-1',type:'function',function:{name:'get_available_sessions',arguments:'{}'}}]}}]}):response({id:'chat-2',choices:[{finish_reason:'stop',message:{content:JSON.stringify(plan)}}]});});
  assert.deepEqual(chat.plan,plan);assert.equal(requests[1].response_format.type,'json_object');
  assert.equal(requests[1].messages.at(-2).role,'tool');assert.equal(requests[1].messages.at(-1).role,'system');
  assert.equal(requests[0].thinking.type,'disabled');assert.equal(requests[1].thinking.type,'disabled');
  assert.equal(requests[1].tool_choice,'none');assert.equal(requests[1].tools[0].function.name,'get_available_sessions');
  assert.deepEqual(parsePlanResponse('\uFEFF '+JSON.stringify(plan)+'\n'),plan);
  assert.deepEqual(parsePlanResponse('```json\n'+JSON.stringify(plan)+'\n```'),plan);
  assert.throws(()=>parsePlanResponse('Here is your itinerary: '+JSON.stringify(plan)),e=>e.code==='AI_INVALID_RESPONSE');
  assert.throws(()=>parsePlanResponse('{"summary":'),e=>e.code==='AI_INVALID_RESPONSE');
  for(const empty of [null,undefined,'','  ','```json\n\n```'])assert.throws(()=>parsePlanResponse(empty),e=>e.code==='AI_EMPTY_RESPONSE');
  assert.throws(()=>parsePlanResponse(plan),e=>e.code==='AI_INVALID_RESPONSE');
  // JSON-mode can return empty content: retry only generation once, using the same
  // real catalog, and still reject an invented session or an invalid itinerary.
  const toolReply={choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'tool-1',type:'function',function:{name:'get_available_sessions',arguments:'{}'}}]}}]};
  for(const unreadable of ['',null,'{bad json']){
    let attempts=0,catalogReads=0;
    const retry=await generatePlan(chatConfig,input,async()=>{catalogReads++;return catalog;},async(url,options)=>{
      attempts++;const sent=JSON.parse(options.body);if(attempts===1)return response(toolReply);
      assert.equal(sent.tool_choice,'none');
      if(attempts===3)assert(sent.messages.at(-1).content.includes('previous response'));
      return response({id:'retry',choices:[{finish_reason:'stop',message:{content:attempts===2?unreadable:JSON.stringify(plan)}}]});
    });
    assert.deepEqual(retry.plan,plan);assert.equal(attempts,3);assert.equal(catalogReads,1);
  }
  for(const finish of ['stop','length']){
    let attempts=0;
    await assert.rejects(generatePlan(chatConfig,input,async()=>catalog,async()=>{attempts++;return attempts===1?response(toolReply):response({choices:[{finish_reason:finish,message:{content:''}}]});}),e=>e.code===(finish==='stop'?'AI_EMPTY_RESPONSE':'AI_INCOMPLETE'));
    assert.equal(attempts,finish==='stop'?3:2);
  }
  let invalidCalls=0;
  await assert.rejects(generatePlan(chatConfig,input,async()=>catalog,async()=>{invalidCalls++;return invalidCalls===1?response(toolReply):response({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...plan,stops:[{sessionId:'invented',reason:''}]})}}]});}),e=>e.code==='AI_INVALID_PLAN');
  assert.equal(invalidCalls,2);
  let expiredCalls=0;
  await assert.rejects(generatePlan(chatConfig,input,async()=>catalog,async()=>{expiredCalls++;return response(toolReply);},{deadlineAt:Date.now()-1}),e=>e.code==='PLANNER_TIMEOUT');
  assert.equal(expiredCalls,0);
  let shortBudgetCalls=0;
  await assert.rejects(generatePlan(chatConfig,input,async()=>catalog,async()=>{shortBudgetCalls++;return shortBudgetCalls===1?response(toolReply):response({choices:[{finish_reason:'stop',message:{content:''}}]});},{deadlineAt:Date.now()+4000}),e=>e.code==='AI_EMPTY_RESPONSE');
  assert.equal(shortBudgetCalls,2,'no extra call when less than five seconds of the lease budget remain');
  const coverageInput={...input,days:2,budgetThb:600};
  const coverageCatalog=[
    {sessionId:'cover-a1',experienceId:'a',city:'Shanghai',startsAt:'2026-10-24T01:00:00Z',endsAt:'2026-10-24T02:00:00Z',unitPriceThb:100,seatsLeft:8},
    {sessionId:'cover-b1',experienceId:'b',city:'Shanghai',startsAt:'2026-10-24T04:00:00Z',endsAt:'2026-10-24T05:00:00Z',unitPriceThb:100,seatsLeft:8},
    {sessionId:'cover-c1',experienceId:'c',city:'Shanghai',startsAt:'2026-10-24T07:00:00Z',endsAt:'2026-10-24T08:00:00Z',unitPriceThb:100,seatsLeft:8},
    {sessionId:'cover-a2',experienceId:'a',city:'Shanghai',startsAt:'2026-10-25T01:00:00Z',endsAt:'2026-10-25T02:00:00Z',unitPriceThb:100,seatsLeft:8},
    {sessionId:'cover-b2',experienceId:'b',city:'Shanghai',startsAt:'2026-10-25T04:00:00Z',endsAt:'2026-10-25T05:00:00Z',unitPriceThb:100,seatsLeft:8},
    {sessionId:'cover-c2',experienceId:'c',city:'Shanghai',startsAt:'2026-10-25T07:00:00Z',endsAt:'2026-10-25T08:00:00Z',unitPriceThb:100,seatsLeft:8}
  ];
  const packedPlan={summary:'Culture.',stops:['cover-a1','cover-b1','cover-c1'].map(sessionId=>({sessionId,reason:'Fits your interests.'})),tips:[]};
  const coveredPlan={...packedPlan,stops:['cover-a1','cover-b2','cover-c2'].map(sessionId=>({sessionId,reason:'Fits your interests.'}))};
  const oneStop={...packedPlan,stops:[packedPlan.stops[0]]};
  assert.deepEqual(requiredActivityDates(coverageCatalog,coverageInput),['2026-10-24','2026-10-25']);
  assert.throws(()=>validatePlan(packedPlan,coverageCatalog,coverageInput),e=>e.code==='AI_MISSING_DAY');
  assert.deepEqual(validatePlan(coveredPlan,coverageCatalog,coverageInput),coveredPlan);
  assert.deepEqual(requiredActivityDates(coverageCatalog,{...coverageInput,budgetThb:399}),[]);
  assert.deepEqual(validatePlan(oneStop,coverageCatalog,{...coverageInput,budgetThb:399}),oneStop,'a free day is allowed when party budget cannot cover two dates');
  assert.deepEqual(requiredActivityDates(coverageCatalog.filter(s=>s.experienceId==='a'),coverageInput),[],'repeating the same experience is not evidence of a distinct-experience assignment');
  assert.deepEqual(validatePlan(oneStop,coverageCatalog.filter(s=>s.experienceId==='a'),coverageInput),oneStop);
  assert.deepEqual(requiredActivityDates(coverageCatalog.slice(0,3),coverageInput),['2026-10-24'],'a date with no available sessions is not required');
  assert.deepEqual(validatePlan(packedPlan,coverageCatalog.slice(0,3),coverageInput),packedPlan);
  const constrainedCatalog=[coverageCatalog[0],{...coverageCatalog[1],unitPriceThb:200},coverageCatalog[3]];
  assert.deepEqual(requiredActivityDates(constrainedCatalog,coverageInput),['2026-10-24','2026-10-25'],'matching can choose costlier day-one B to leave unique A for day two');
  assert.deepEqual(requiredActivityDates(constrainedCatalog,{...coverageInput,budgetThb:599}),[],'minimum assignment price includes every guest');
  assert.deepEqual(requiredActivityDates(constrainedCatalog,{...coverageInput,excludedExperienceIds:['b']}),[],'skips are respected when proving coverage');
  for(const caseName of ['repair','still-missing','empty-then-missing','budget-limited']){
    let coverageCalls=0;
    const generate=generatePlan(chatConfig,caseName==='budget-limited'?{...coverageInput,budgetThb:399}:coverageInput,async()=>coverageCatalog,async(url,options)=>{
      coverageCalls++;if(coverageCalls===1)return response(toolReply);
      const sent=JSON.parse(options.body),toolData=JSON.parse(sent.messages.find(m=>m.role==='tool').content);
      assert.deepEqual(toolData.requiredActivityDates,caseName==='budget-limited'?[]:['2026-10-24','2026-10-25']);
      if(coverageCalls===3&&caseName!=='empty-then-missing')assert(sent.messages.at(-1).content.includes('2026-10-25'));
      const content=caseName==='budget-limited'?JSON.stringify(oneStop):caseName==='empty-then-missing'&&coverageCalls===2?'':caseName==='repair'&&coverageCalls===3?JSON.stringify(coveredPlan):JSON.stringify(packedPlan);
      return response({choices:[{finish_reason:'stop',message:{content}}]});
    });
    if(caseName==='repair')assert.deepEqual((await generate).plan,coveredPlan);
    else if(caseName==='budget-limited')assert.deepEqual((await generate).plan,oneStop);
    else await assert.rejects(generate,e=>e.code==='AI_MISSING_DAY');
    assert.equal(coverageCalls,caseName==='budget-limited'?2:3,'missing-day repair shares the same single retry budget as empty JSON');
  }
  const repeatedPlacePlan={...packedPlan,stops:[...packedPlan.stops,{sessionId:'cover-b2',reason:'Food without repeating places.'}]};
  assert.throws(()=>validatePlan(repeatedPlacePlan,coverageCatalog,{...coverageInput,budgetThb:1000}),e=>e.code==='AI_REPEATED_PLACE');
  for(const repaired of [true,false]){
    let repeatCalls=0;
    const generated=generatePlan(chatConfig,{...coverageInput,budgetThb:1000},async()=>coverageCatalog,async(url,options)=>{
      repeatCalls++;if(repeatCalls===1)return response(toolReply);
      const sent=JSON.parse(options.body);
      if(repeatCalls===3){assert(sent.messages.at(-1).content.includes('at most ONE session per experienceId'));assert(sent.messages.at(-1).content.includes('2026-10-25'));}
      return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(repaired&&repeatCalls===3?coveredPlan:repeatedPlacePlan)}}]});
    });
    if(repaired)assert.deepEqual((await generated).plan,coveredPlan,'duplicate food on a later day is repaired into three distinct places across two days');
    else await assert.rejects(generated,e=>e.code==='AI_REPEATED_PLACE');
    assert.equal(repeatCalls,3,'repeated places receive only the shared one final-generation repair');
  }
  const send=(handler,data=body,headers={})=>handler(new Request('https://example.test/agent',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)}));
  let calls=[];
  const rpc=async(name,args)=>{calls.push({name,args});if(name==='journeyhub_agent_begin')return{id:'run-1',planning_token:'lease-1',cached:false};if(name==='journeyhub_agent_catalog_trip')return catalog;if(name==='journeyhub_agent_finalize')return{id:'run-1',status:'draft',plan};if(name==='journeyhub_agent_worker_config')return{worker_secret:'must-never-leak',scheduled:true};return{};};
  const handler=createAgentHandler({envGet:env,rpc,authenticate:async()=>({id:'verified-user'}),generate:async()=>generated,now:()=>now});
  let result=await send(handler);assert.equal(result.status,200);assert.equal((await result.json()).run.status,'draft');
  assert.deepEqual(calls.map(c=>c.name),['journeyhub_agent_begin','journeyhub_agent_progress','journeyhub_agent_catalog_trip','journeyhub_agent_progress','journeyhub_agent_progress','journeyhub_agent_finalize']);
  assert.deepEqual(calls.filter(c=>c.name==='journeyhub_agent_progress').map(c=>c.args.p_stage),['checking_catalog','planning','validating']);
  assert.equal(calls[0].args.p_user_id,'verified-user');assert(!calls.some(c=>/confirm|book|mail/i.test(c.name)));
  result=await handler(new Request('https://example.test/agent?action=health'));const health=await result.text();assert(!health.includes('must-never-leak'));assert(!health.includes(secrets.OPENAI_API_KEY));assert.equal(JSON.parse(health).worker.ready,true);
  const noAuth=createAgentHandler({envGet:env,rpc:()=>{throw Error('must not reach database');},now:()=>now});
  result=await send(noAuth);assert.equal(result.status,401);
  calls=[];
  const missing=createAgentHandler({envGet:()=>undefined,rpc,authenticate:async()=>({id:'verified-user'}),now:()=>now});
  result=await send(missing);assert.equal(result.status,503);assert.equal((await result.json()).error.code,'AI_NOT_CONFIGURED');assert.equal(calls.length,0);
  const cache=createAgentHandler({envGet:env,authenticate:async()=>({id:'verified-user'}),rpc:async()=>({cached:true,status:'draft',run:{id:'cached',status:'draft'}}),generate:()=>{throw Error('cached request must not charge AI');},now:()=>now});
  result=await send(cache);assert.equal((await result.json()).run.id,'cached');
  calls=[];
  const failed=createAgentHandler({envGet:env,rpc,authenticate:async()=>({id:'verified-user'}),generate:()=>{throw Error('secret-private-error');},now:()=>now});
  result=await send(failed);assert.equal(result.status,503);assert(!(await result.text()).includes('secret-private-error'));assert.equal(calls.at(-1).name,'journeyhub_agent_fail');
  // Progress is saved before the awaited provider completes; there is no timer-based completion.
  calls=[];let releaseProvider,providerEntered;
  const entered=new Promise(resolve=>providerEntered=resolve),held=new Promise(resolve=>releaseProvider=resolve);
  const inFlight=createAgentHandler({envGet:env,rpc,authenticate:async()=>({id:'verified-user'}),generate:async()=>{providerEntered();return held;},now:()=>now});
  const pending=send(inFlight);await entered;
  assert.deepEqual(calls.filter(c=>c.name==='journeyhub_agent_progress').map(c=>c.args.p_stage),['checking_catalog','planning']);
  assert(!calls.some(c=>c.name==='journeyhub_agent_finalize'));
  releaseProvider(generated);assert.equal((await pending).status,200);
  assert.deepEqual(calls.filter(c=>c.name==='journeyhub_agent_progress').map(c=>c.args.p_stage),['checking_catalog','planning','validating']);
  let providerCalled=false;calls=[];
  const empty=createAgentHandler({envGet:env,rpc:async(name,args)=>name==='journeyhub_agent_catalog_trip'?[]:rpc(name,args),authenticate:async()=>({id:'verified-user'}),generate:async()=>{providerCalled=true;return generated;},now:()=>now});
  result=await send(empty);assert.equal(result.status,409);assert.equal((await result.json()).error.code,'NO_AVAILABILITY');assert.equal(providerCalled,false);assert.equal(calls.at(-1).name,'journeyhub_agent_fail');
  result=await send(handler,{...body,prompt:'x'.repeat(13000)});assert.equal(result.status,413);
  console.log('PASS: mocked provider adapters, strict/bounded JSON recovery, feasible multi-day coverage with one shared repair attempt, preferences/hours/travel validation, real in-flight persisted progress, no pre-confirm side effects, idempotent cache, authentication and secret-safe errors. No live AI or email calls.');
})().catch(e=>{console.error(e);process.exitCode=1;});
