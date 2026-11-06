const assert=require('node:assert/strict');
(async()=>{
  const {discoveryAction,historyAction,signSelection,readSelection}=await import('./supabase/functions/journeyhub-agent/discovery.mjs');
  const {historyInput,historyPlan,revisionHistoryId,listHistory}=await import('./supabase/functions/journeyhub-agent/history.mjs');
  const {createAgentHandler}=await import('./supabase/functions/journeyhub-agent/handler.mjs');
  const user={id:'00000000-0000-4000-8000-000000000001'},other={id:'00000000-0000-4000-8000-000000000002'},now=new Date('2026-10-26T00:00:00Z'),secret='test-only-signing-key';
  const input={city:'Shanghai',date:'2026-10-28',guests:2,prompt:'Quiet gardens',days:2,dayStart:'09:00',dayEnd:'18:00',transport:'walk'};
  const env=n=>({GOOGLE_PLACES_API_KEY:'fixture-map',DEEPSEEK_API_KEY:'fixture-ai'}[n]);
  const raw=id=>({id,displayName:{text:'Fresh provider name '+id},formattedAddress:'Fresh provider address',location:{latitude:31.23,longitude:121.48},businessStatus:'OPERATIONAL',regularOpeningHours:{weekdayDescriptions:['Monday 9 am–5 pm']}});
  const rows=new Map(),calls=[];let queue=[],writesFail=false,closed=new Set(),quotas=0,at=0;
  const rpc=async(name,a)=>{
    if(name==='journeyhub_discovery_quota'){quotas++;return null;}
    if(name==='journeyhub_plan_dates_check')return {available:true};
    if(name==='journeyhub_trip_history_get'){const row=rows.get(a.p_id);return row?.userId===a.p_user_id?structuredClone(row):null;}
    if(name==='journeyhub_trip_history_save'){
      if(writesFail)throw Error('database offline');
      if(rows.has(a.p_id)){const row=rows.get(a.p_id);assert.equal(row.userId,a.p_user_id);assert.deepEqual(row.input,a.p_input);assert.deepEqual(row.placeIds,a.p_place_ids);return structuredClone(row);}
      const row={id:a.p_id,userId:a.p_user_id,input:a.p_input,placeIds:a.p_place_ids,wanted:a.p_wanted,skipped:a.p_skipped,plan:a.p_plan,parentId:a.p_parent_id,createdAt:new Date(now.getTime()+at++).toISOString(),updatedAt:now.toISOString()};rows.set(row.id,structuredClone(row));return row;
    }
    if(name==='journeyhub_trip_history_choices'){
      if(writesFail)throw Error('database offline');const row=rows.get(a.p_id);if(!row||row.userId!==a.p_user_id)return null;row.wanted=a.p_wanted;row.skipped=a.p_skipped;return structuredClone(row);
    }
    if(name==='journeyhub_trip_history_list'){
      const all=[...rows.values()].filter(r=>r.userId===a.p_user_id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).filter(r=>!a.p_cursor_at||r.createdAt<a.p_cursor_at||(r.createdAt===a.p_cursor_at&&r.id<a.p_cursor_id));
      const items=all.slice(0,a.p_limit).map(r=>({id:r.id,input:r.input,status:r.plan?'itinerary':'search',createdAt:r.createdAt,updatedAt:r.updatedAt,placeCount:r.placeIds.length,stopCount:r.plan?.stops.length||0})),last=items.at(-1);return {items,nextCursor:all.length>a.p_limit?{createdAt:last.createdAt,id:last.id}:null};
    }
    throw Error('Unexpected RPC '+name);
  };
  const fetcher=async(url,options={})=>{
    calls.push(url);
    if(url.includes('deepseek'))return Response.json({choices:[{message:{content:JSON.stringify(queue.shift())}}]});
    if(url.includes('searchText'))return Response.json({places:[raw('place_a'),raw('place_b')]});
    if(url.includes('routes.googleapis'))return Response.json({routes:[{distanceMeters:500,duration:'600s',polyline:{encodedPolyline:'fixture'},legs:[{distanceMeters:500,duration:'600s'}]}]});
    const id=new URL(url).pathname.split('/').at(-1);if(id==='place_b'&&closed.has(id))return Response.json({...raw(id),businessStatus:'CLOSED_PERMANENTLY'});return Response.json(raw(id));
  };
  const context={user,now,env,fetcher,rpc,secret},discover=value=>discoveryAction({...context,value}),history=(value,overrides={})=>historyAction({...context,...overrides,value});
  const requestId='11111111-1111-4111-8111-111111111111';
  queue=[{query:'quiet gardens'},{places:[{id:'place_a',reason:'Greenery'},{id:'place_b',reason:'Paths'}]}];
  const found=await discover({action:'discover',...input,requestId});assert.equal(found.historyId,requestId);assert.equal(rows.size,1);assert.equal(found.historyError,undefined);
  assert.deepEqual(rows.get(requestId).placeIds,['place_a','place_b']);
  assert(!JSON.stringify([...rows.values()]).includes('Fresh provider'),'Google content is never persisted');
  const aiCount=()=>calls.filter(c=>c.includes('deepseek')).length;
  let before=aiCount();const retry=await discover({action:'discover',...input,requestId});assert.equal(retry.historyId,requestId);assert.equal(aiCount(),before);assert.equal(rows.size,1);
  await assert.rejects(()=>discover({action:'discover',...input,prompt:'Changed',requestId}),e=>e.code==='REQUEST_CONFLICT');
  await history({action:'history_choices',id:requestId,wanted:['place_a','place_b'],skipped:[]});
  queue=[{summary:'AI authored summary',stops:[{placeId:'place_a',day:1,start:'09:00',end:'10:00',reason:'Rest'}, {placeId:'place_b',day:1,start:'10:30',end:'11:30',reason:'Walk'}]}];
  const planned=await discover({action:'discover_plan',token:found.token,wanted:['place_a','place_b'],skipped:[]});
  assert(planned.historyId&&planned.historyId!==requestId);assert.equal(rows.size,2);
  const saved=rows.get(planned.historyId);assert.equal(saved.parentId,requestId);assert.deepEqual(Object.keys(saved.plan),['summary','stops']);assert.deepEqual(Object.keys(saved.plan.stops[0]),['id','dayIndex','start','end','reason']);
  assert(!JSON.stringify(saved).includes('Fresh provider'));assert(!JSON.stringify(saved).includes('encodedPolyline'));assert(!JSON.stringify(saved).includes('openingHours'));
  before=aiCount();const planRetry=await discover({action:'discover_plan',token:found.token,wanted:['place_b','place_a'],skipped:[]});assert.equal(planRetry.historyId,planned.historyId);assert.equal(aiCount(),before);assert.equal(rows.size,2);
  const different=await revisionHistoryId(requestId,['place_a'],['place_b']);assert.notEqual(different,planned.historyId);
  const future=new Date('2028-01-01T00:00:00Z');before=aiCount();const opened=await history({action:'history_refresh',id:planned.historyId},{now:future,env:n=>n==='GOOGLE_PLACES_API_KEY'?'fixture-map':undefined});
  assert.equal(opened.plan.date,'2026-10-28');assert.equal(opened.plan.stops[0].start,'09:00');assert.equal(opened.plan.stops[0].address,'Fresh provider address');assert.equal(aiCount(),before,'history never reruns AI');assert.equal(opened.plan.stops[0].bookable,false);
  const claims=await readSelection(opened.token,secret,user.id,future);assert.equal(claims.historyId,requestId);
  await history({action:'history_choices',id:planned.historyId,wanted:['place_a'],skipped:['place_b']});assert.deepEqual(rows.get(requestId).wanted,['place_a']);assert.deepEqual(rows.get(planned.historyId).wanted,['place_a','place_b'],'old revision choices immutable');
  let providerBefore=calls.length;await assert.rejects(()=>history({action:'history_open',id:planned.historyId},{user:other}),e=>e.code==='HISTORY_NOT_FOUND');assert.equal(calls.length,providerBefore);
  assert.deepEqual((await history({action:'history_list'},{user:other})).items,[]);
  await assert.rejects(()=>history({action:'history_choices',id:requestId,wanted:['invented'],skipped:[]}),e=>e.code==='INVALID_INPUT');
  await assert.rejects(()=>history({action:'history_import',token:found.token,wanted:[],skipped:[]},{user:other}),e=>e.code==='SEARCH_EXPIRED');
  closed.add('place_b');providerBefore=calls.filter(c=>c.includes('routes.googleapis')).length;
  const missing=await history({action:'history_refresh',id:planned.historyId});assert.equal(missing.plan.stops.length,2);assert.equal(missing.plan.stops[1].unavailable,true);assert.equal(missing.plan.stops[1].lat,null);assert.equal(missing.plan.stops[1].start,'10:30');assert.deepEqual(missing.plan.stops[1].openingHours,[]);assert.equal(missing.plan.roadRoutes[0].status,'single_stop');assert.equal(missing.plan.roadRoutes[1].status,'unavailable');assert.equal(calls.filter(c=>c.includes('routes.googleapis')).length,providerBefore,'no route across missing stop');closed.clear();
  const legacyToken=await signSelection({owner:user.id,input:historyInput(input),ids:['place_a','place_b'],expires:now.getTime()-1000},secret);
  providerBefore=calls.length;const imported=await history({action:'history_import',token:legacyToken,wanted:['place_a'],skipped:['place_b'],plan:{summary:'My surviving trip',stops:[{id:'place_a',dayIndex:1,start:'09:00',end:'10:00',reason:'My choice',lat:99,address:'Do not save',photo:{url:'Do not save'}}]}});
  assert(imported.historyId);assert.equal(calls.length,providerBefore,'rescue import never calls provider');assert(!JSON.stringify(rows.get(imported.historyId)).includes('Do not save'));
  const count=rows.size;assert.equal((await history({action:'history_import',token:legacyToken,wanted:['place_a'],skipped:['place_b'],plan:rows.get(imported.historyId).plan})).historyId,imported.historyId);assert.equal(rows.size,count);
  await assert.rejects(()=>discover({action:'discover_plan',token:legacyToken,wanted:['place_a'],skipped:[]}),e=>e.code==='SEARCH_EXPIRED');
  writesFail=true;queue=[{query:'gardens'},{places:[{id:'place_a',reason:'Calm'}]}];
  const failed=await discover({action:'discover',...input,requestId:'22222222-2222-4222-8222-222222222222'});assert.equal(failed.historyId,null);assert.equal(typeof failed.historyError,'string');assert.equal(failed.places.length,1);assert(failed.token);
  writesFail=false;const rescued=await history({action:'history_import',token:failed.token,wanted:[],skipped:[]});assert.equal(rescued.historyId,'22222222-2222-4222-8222-222222222222');
  let cursor=null,collected=[];do{const page=await history({action:'history_list',limit:1,cursor});collected.push(...page.items.map(x=>x.id));cursor=page.nextCursor;}while(cursor);
  assert.equal(new Set(collected).size,rows.size);assert.equal(collected.length,rows.size);
  await listHistory(async(name,args)=>{assert.equal(args.p_cursor_at,'2026-10-28T06:12:28.123456+00:00');return {items:[],nextCursor:null};},user.id,{cursor:{id:requestId,createdAt:'2026-10-28T06:12:28.123456+00:00'}});
  assert.throws(()=>historyPlan({summary:'bad',stops:[{id:'not-saved',dayIndex:1,start:'09:00',end:'10:00'}]},historyInput(input),['place_a']),e=>e.code==='INVALID_INPUT');
  const handler=createAgentHandler({envGet:()=>undefined,authenticate:async()=>user,rpc,now:()=>future});
  const listResponse=await handler(new Request('https://fixture.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'history_list'})}));assert.equal(listResponse.status,200,'listing saved history requires no provider keys');
  assert(quotas>0);assert(calls.every(url=>!url.includes('booking')&&!url.includes('mail')));
  console.log('PASS: private owner-bound persisted search/plan history, immutable revisions, sanitized storage, retry idempotency, expired memory rescue, fresh no-AI reopen including past dates, missing-place schedule preservation, no routes across missing places, visible save failure/retry and paginated history. All provider/database calls mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
