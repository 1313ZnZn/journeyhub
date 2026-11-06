const assert=require('node:assert/strict');
(async()=>{
  const {discoveryAction,signSelection,readSelection,validateFreePlan}=await import('./supabase/functions/journeyhub-agent/discovery.mjs');
  const {createAgentHandler}=await import('./supabase/functions/journeyhub-agent/handler.mjs');
  const now=new Date('2026-10-26T00:00:00Z'),user={id:'fixture-owner'},secret='fixture-signing-key';
  const secrets={GOOGLE_PLACES_API_KEY:'fixture-map-key',DEEPSEEK_API_KEY:'fixture-ai-key',JOURNEYHUB_DISCOVERY_SIGNING_KEY:secret};
  const env=n=>secrets[n],input={city:'Shanghai',date:'2026-10-28',prompt:'Quiet gardens',guests:2,days:1,dayStart:'09:00',dayEnd:'18:00',transport:'walk'};
  const raw=(id,lat=31.23)=>({id,displayName:{text:'Verified '+id},location:{latitude:lat,longitude:121.48},formattedAddress:'Provider address',businessStatus:'OPERATIONAL',primaryType:'park',photos:[{name:'places/'+id+'/photos/reference_1',authorAttributions:[{displayName:'Fixture author',uri:'https://maps.google.com/'}]}],regularOpeningHours:{weekdayDescriptions:['Monday: 9 am–5 pm']}});
  let queue=[],calls=[],quotas=0;
  const fetcher=async(url,init)=>{calls.push({url,body:init.body?JSON.parse(init.body):null});if(url.includes('deepseek'))return Response.json({choices:[{message:{content:JSON.stringify(queue.shift())}}]});if(url.includes('/media?'))return Response.json({photoUri:'https://lh3.googleusercontent.com/fixture-photo'});if(url.includes('searchText'))return Response.json({places:[raw('place_a'),raw('place_b'),raw('outside',0),{...raw('closed'),businessStatus:'CLOSED_PERMANENTLY'}]});return Response.json(raw(url.includes('place_a')?'place_a':'place_b'));};
  const rpc=async(name)=>{if(name==='journeyhub_plan_dates_check')return {available:true};assert.equal(name,'journeyhub_discovery_quota');quotas++;};
  const call=value=>discoveryAction({value,user,env,fetcher,rpc,now,secret});
  for(const provider of ['AI','Google Places']){
    await assert.rejects(()=>discoveryAction({value:{action:'discover',...input},user,env,rpc,now,secret,fetcher:async url=>{
      if(provider==='Google Places'&&url.includes('deepseek'))return Response.json({choices:[{message:{content:'{"query":"gardens"}'}}]});
      return Response.json({error:{message:'private diagnostic must not leak',details:[{reason:'API_KEY_HTTP_REFERRER_BLOCKED'}]}},{status:403});
    }}),e=>e.message.startsWith(provider+' search failed')&&e.message.includes('API_KEY_HTTP_REFERRER_BLOCKED')&&!e.message.includes('private diagnostic'));
  }
  queue=[{query:'quiet gardens'},{places:[{id:'place_a',reason:'Quiet greenery'},{id:'place_b',reason:'Walking paths'}]}];
  const result=await call({action:'discover',...input});assert.equal(result.places.length,2);assert.equal(result.places[0].photo.authors[0].name,'Fixture author');assert.equal(result.places[0].photo.url,'https://lh3.googleusercontent.com/fixture-photo');assert(result.places.every(p=>p.bookable===false));assert.equal(result.places[0].address,'Provider address');
  const searchCall=calls.find(c=>c.url.includes('searchText'));assert(searchCall.body.locationRestriction.rectangle);assert.equal(searchCall.body.languageCode,'en');
  const decoded=await readSelection(result.token,secret,user.id,now);assert.deepEqual(decoded.ids,['place_a','place_b']);assert(!JSON.stringify(decoded).includes('Provider address'),'signed token never stores Google content');
  await assert.rejects(()=>readSelection(result.token,secret,'other-user',now),e=>e.code==='SEARCH_EXPIRED');
  await assert.rejects(()=>readSelection(result.token+'x',secret,user.id,now),e=>e.code==='SEARCH_EXPIRED');
  await assert.rejects(()=>readSelection(result.token,secret,user.id,new Date(now.getTime()+3600001)),e=>e.code==='SEARCH_EXPIRED');
  queue=[{summary:'A calm outing.',stops:[{placeId:'place_a',day:1,start:'09:00',end:'10:00',reason:'Gardens'}]}];
  const planned=await call({action:'discover_plan',token:result.token,wanted:['place_a'],skipped:['place_b']});assert.equal(planned.plan.stops.length,1);assert.equal(planned.plan.stops[0].address,'Provider address');assert.equal(planned.plan.bookable,false);
  queue=[undefined,{summary:'Recovered complete JSON.',stops:[{placeId:'place_a',day:1,start:'09:00',end:'10:00',reason:'Gardens'}]}];
  const recovered=await call({action:'discover_plan',token:result.token,wanted:['place_a'],skipped:[]});assert.equal(recovered.plan.stops.length,1);
  assert(calls.filter(c=>c.url.includes('deepseek')).every(c=>c.body.thinking.type==='disabled'&&c.body.max_tokens===4000));
  await assert.rejects(()=>call({action:'discover_plan',token:result.token,wanted:['invented'],skipped:[]}),e=>e.code==='INVALID_INPUT');
  await assert.rejects(()=>call({action:'discover_plan',token:result.token,wanted:['place_a'],skipped:['place_a']}),e=>e.code==='INVALID_INPUT');
  await assert.rejects(()=>call({action:'discover_plan',token:result.token,wanted:[],skipped:['place_a','place_b']}),e=>e.code==='NO_PLACES');
  queue=[{query:'gardens'},{places:[{id:'outside',reason:'bad'}]}];await assert.rejects(()=>call({action:'discover',...input}),e=>e.code==='AI_INVALID_RESPONSE');
  const base={summary:'Trip',stops:[{placeId:'place_a',day:1,start:'09:00',end:'10:00'}]};
  assert.throws(()=>validateFreePlan({...base,stops:[{...base.stops[0],placeId:'fake'}]},result.places,input));
  assert.throws(()=>validateFreePlan({...base,stops:[base.stops[0],base.stops[0]]},result.places,input));
  assert.throws(()=>validateFreePlan({...base,stops:[{...base.stops[0],start:'08:00'}]},result.places,input));
  assert.throws(()=>validateFreePlan({...base,stops:[base.stops[0],{placeId:'place_b',day:1,start:'10:00',end:'11:00'}]},result.places,input),'transfer buffer required');
  const authHandler=createAgentHandler({envGet:env,authenticate:async()=>{throw Error('no auth');},rpc,fetchImpl:fetcher});
  const before=calls.length;const denied=await authHandler(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'discover',...input})}));assert.equal(denied.status,503);assert.equal(calls.length,before);
  const unconfigured=createAgentHandler({envGet:n=>n==='DEEPSEEK_API_KEY'?'fixture':undefined,authenticate:async()=>user,rpc,fetchImpl:fetcher});const response=await unconfigured(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'discover',...input})}));assert.equal((await response.json()).error.code,'PLACES_NOT_CONFIGURED');assert.equal(calls.length,before);
  queue=[{query:'gardens'},{places:[{id:'place_a',reason:'Quiet greenery'}]}];
  const emptyQuota=createAgentHandler({envGet:n=>({...secrets,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'}[n]),authenticate:async()=>user,now:()=>now,fetchImpl:async(url,init)=>url.includes('/rest/v1/rpc/')?new Response(null,{status:204}):fetcher(url,init)});
  const emptyResult=await emptyQuota(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'discover',...input})}));assert.equal(emptyResult.status,200,'void quota RPC must not break discovery');assert.equal((await emptyResult.json()).places.length,1);
  for(const browserKey of ['',secrets.GOOGLE_PLACES_API_KEY,'public-browser-fixture']){
    const configHandler=createAgentHandler({envGet:n=>({...secrets,GOOGLE_MAPS_BROWSER_KEY:browserKey}[n])});
    const body=await (await configHandler(new Request('https://example.test?action=maps_config'))).json();
    assert.equal(body.browserKey,browserKey==='public-browser-fixture'?browserKey:'','server key must never be exposed by public map configuration');
  }
  assert(quotas>=3);assert(calls.every(c=>!c.url.includes('booking')&&!c.url.includes('mail')));
  console.log('PASS: real-place adapter contracts, bounded city search, AI ID validation, owner-bound/tamper-proof/expiring shortlist, authoritative details refresh, exclusions, time/travel validation, auth/config gates. All provider calls mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
