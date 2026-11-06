/* Deferred transports exercise actual concurrency, expiry and ownership paths. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(__dirname+'/'+p,'utf8'),copy=x=>JSON.parse(JSON.stringify(x));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 let reads=[],applied=[],draws=0,clock=Date.now();
 const ctx=vm.createContext({window:{JOURNEYHUB_CONFIG:{},supabase:{createClient:()=>({rpc:()=>{const d=deferred();reads.push(d);return d.promise;}})}},Date,Intl,Object,Map,Promise,MODE:{kind:'live'},render:()=>draws++,jhDrawStatus:()=>{},apply:(d,p)=>applied.push({d,p})});
 vm.runInContext(read('frontend.js').split('async function jhRaw')[0]+`;jhApply=(data,personal)=>apply(data,personal);jhUser={id:'alice'};globalThis.api={refresh:jhRefresh,invalidate:jhInvalidateSnapshot,switchOwner(id){jhRevision++;jhUser={id}}};`,ctx);
 const a=ctx.api.refresh(),b=ctx.api.refresh();assert.equal(a,b);assert.equal(reads.length,1,'overlapping snapshot reads share one RPC');
 reads[0].resolve({data:{serverTime:'t1',catalog:['all']}});await a;assert.equal(draws,1);
 const unchanged=ctx.api.refresh();reads[1].resolve({data:{serverTime:'t2',catalog:['all']}});await unchanged;assert.equal(draws,1,'server clock alone does not redraw the page');
 const old=ctx.api.refresh();ctx.api.invalidate();const fresh=ctx.api.refresh();assert.equal(reads.length,4,'post-write read does not share pre-write request');
 reads[3].resolve({data:{catalog:['new paid reservation']}});await fresh;reads[2].resolve({data:{catalog:['stale']}});await old;assert.equal(applied.at(-1).d.catalog[0],'new paid reservation');
 const alice=ctx.api.refresh();ctx.api.switchOwner('bob');const bob=ctx.api.refresh();reads[5].resolve({data:{catalog:['bob']}});await bob;reads[4].resolve({data:{catalog:['alice']}});await alice;assert.equal(applied.at(-1).d.catalog[0],'bob');
 const promoted=ctx.api.refresh();assert.equal(promoted,ctx.api.refresh(true));reads[6].resolve({data:{catalog:['bob']}});await promoted;assert.equal(applied.at(-1).p,true);
 const failed=ctx.api.refresh();reads[7].reject(Error('offline'));await assert.rejects(failed,/offline/);const retried=ctx.api.refresh();reads[8].resolve({data:{catalog:['reconnected']}});await retried;

 let mapCalls=0,mapWait=deferred();const library={Map:function(){}};
 const mapCtx=vm.createContext({pd:{owner:'alice'},Date,Promise,Error,window:{AMap:library},setTimeout,clearTimeout,URLSearchParams,pdCurrent:c=>c===mapCtx.pd,pdRequest:async(payload,owner,timeout)=>{assert.equal(timeout,15000);mapCalls++;return mapWait.promise;}});
 vm.runInContext(read('amap-ui.js').split('async function amMount')[0]+';globalThis.api={load:amLoad,expire(){amExpires=0;}}',mapCtx);
 const mapA=mapCtx.api.load(),mapB=mapCtx.api.load();assert.equal(mapA,mapB);assert.equal(mapCalls,1,'one pending config while expiration has not arrived');
 mapWait.resolve({ready:true,browserKey:'public-fixture',serviceHost:'https://fixture',expires:Date.now()+3600000});assert.equal(await mapA,library);await mapCtx.api.load();assert.equal(mapCalls,1);
 mapCtx.api.expire();mapWait=deferred();const bad=mapCtx.api.load();mapWait.reject(Error('config offline'));await assert.rejects(bad,/offline/);mapWait=deferred();const retry=mapCtx.api.load();mapWait.resolve({ready:true,browserKey:'public',serviceHost:'https://fixture',expires:Date.now()+3600000});await retry;assert.equal(mapCalls,3,'failure can retry rather than caching a rejection');

 let healthReads=0,healthWait=deferred();
 const healthCtx=vm.createContext({Date,Promise,AbortController,setTimeout,clearTimeout,jhConfig:{url:'https://fixture',publishableKey:'public'},fetch:()=>{healthReads++;return healthWait.promise;}});
 vm.runInContext(read('agent-ui.js').split('let agHealthPending=')[1].split('function agHealth(')[0].replace(/^/, 'let agHealthPending=')+';globalThis.health=agFetchHealth;',healthCtx);
 const healthA=healthCtx.health(),healthB=healthCtx.health();assert.equal(healthA,healthB);healthWait.resolve(Response.json({ai:{ready:true}}));await healthA;await healthCtx.health();assert.equal(healthReads,1,'same public readiness result is shared');
 healthWait=deferred();const healthFailure=healthCtx.health(true);healthWait.reject(Error('offline'));await assert.rejects(healthFailure,/offline/);healthWait=deferred();const healthRetry=healthCtx.health(true);healthWait.resolve(Response.json({ai:{ready:false}}));assert.equal((await healthRetry).ai.ready,false);assert.equal(healthReads,3,'forced recheck and failure retry work');

 let historyReads=[],removed=false,historyClock=Date.now();
 class ClockDate extends Date{static now(){return historyClock;}}
 const h=vm.createContext({state:{route:'orders'},Map,Promise,JSON,Date:ClockDate,setTimeout,clearTimeout,AbortController,Response,fetch:async()=>{const d=deferred();historyReads.push(d);return d.promise;},render:()=>{},agErrorText:e=>e.message});
 vm.runInContext(`const TAB_OF={},A={};let jhUser={id:'alice'},pd={};const jhConfig={url:'https://fixture',publishableKey:'public'},sb={auth:{getSession:async()=>({data:{session:{user:jhUser,access_token:'fixture'}}})}};const cmHidden=()=>globalThis.removed===true,pdCurrent=()=>false;`+read('trip-history.js').split('function thDate')[0]+`;th.items=[{id:'trip',updatedAt:'v1'}];globalThis.api={load:thHydrate,get th(){return th},setVersion(v){th.items[0].updatedAt=v},switchOwner(id){jhUser={id};thScope();th.items=[{id:'trip',updatedAt:'v1'}]}};`,h);
 const result={historyId:'trip',updatedAt:'v1',input:{city:'Shanghai'},places:[{id:'one',name:'Full place',photo:{url:'photo'},review:{text:'review'}}],token:'signed',expires:historyClock+3600000,plan:{stops:[{id:'one'}],roadRoutes:[{day:1,status:'ready'}]}};
 const first=h.api.load('trip'),also=h.api.load('trip');await tick();assert.equal(historyReads.length,1);historyReads[0].resolve(Response.json(result));const one=await first,two=await also;one.places[0].name='local edit';assert.equal(two.places[0].name,'Full place','each caller gets isolated data');await h.api.load('trip');assert.equal(historyReads.length,1,'Calendar and details can reuse complete hydration');
 historyClock+=61000;const expired=h.api.load('trip');await tick();assert.equal(historyReads.length,2);historyReads[1].resolve(Response.json(result));await expired;
 h.api.setVersion('v2');const changed=h.api.load('trip');await tick();historyReads[2].resolve(Response.json({...result,updatedAt:'v2'}));await changed;assert.equal(historyReads.length,3,'edited server version is reloaded');
 const stale=h.api.load('trip',{force:true});await tick();h.api.switchOwner('bob');historyReads[3].resolve(Response.json(result));await assert.rejects(stale,/changed/);assert.equal(h.api.th.hydrated.size,0,'old account response never fills new account cache');
 h.removed=true;await assert.rejects(h.api.load('trip'),/unavailable/);
 assert(!read('place-discovery.js').includes('?action=health'),'place generation has no mandatory health round trip');
 console.log('PASS: single-flight snapshot/config/history, post-write freshness, unchanged-render suppression, auth isolation, bounded map retry, full-content cloned history cache, expiry/version/removal invalidation and no search health preflight. All network mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
