/* Map overlays wait for live coordinates while the durable schedule stays visible. */
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const read=file=>fs.readFileSync(__dirname+'/'+file,'utf8'),tick=()=>new Promise(resolve=>setTimeout(resolve,0));
(async()=>{
  for(const provider of ['google','amap']){
    const dom=new JSDOM('<main id="app"></main>',{runScripts:'outside-only',url:'https://fixture.invalid/'}),w=dom.window,counts={maps:0,config:0,retry:0};
    w.HTMLElement.prototype.scrollIntoView=function(){};
    w.google={maps:{Map:class{constructor(){counts.maps++;}fitBounds(){}},LatLngBounds:class{constructor(){this.points=[];}extend(point){this.points.push(point);}isEmpty(){return !this.points.length;}},InfoWindow:class{close(){}},marker:{AdvancedMarkerElement:class{constructor(options){Object.assign(this,options);}addListener(){}}}}};
    w.AMap={Map:class{constructor(){counts.maps++;}on(){}remove(){}add(){}setFitView(){}destroy(){}},Marker:class{constructor(options){Object.assign(this,options);}on(){}}};
    w.onConfig=()=>counts.config++;w.onRetry=()=>counts.retry++;
    w.eval(`
      const A={},V={},ic=()=>'',esc=value=>String(value??'');let jhUser={id:'alice'},updating=true;
      let pd={owner:'alice',historyId:'trip',day:'all',snapshot:{source:'database',refreshNeeded:true},plan:{days:1,stops:[{id:'${provider==='amap'?'amap_venue':'venue'}',source:'${provider==='amap'?'Amap':'Google Maps'}',name:'Saved Museum',dayIndex:1,start:'09:00',end:'10:00',lat:null,lng:null}],roadRoutes:[]}};
      const thSnapshotUpdating=()=>updating,pdCurrent=ctx=>ctx===pd&&ctx.owner===jhUser.id;
      const pdRequest=async()=>{onConfig();return {ready:true,browserKey:'fixture',serviceHost:'https://fixture.invalid',expires:Date.now()+3600000};};
      A.thRefreshDetails=()=>{onRetry();updating=true;};
      V['place-plan']=()=>({body:'<div class="pd-plan">'+pd.plan.stops.map(stop=>'<article class="pd-stop"><h3>'+stop.name+'</h3><time>'+stop.start+'–'+stop.end+'</time></article>').join('')+'</div>'});
      let render=()=>{const view=V['place-plan']();document.querySelector('#app').innerHTML=view.body;view.after?.();};
      `+read('place-map.js')+read('amap-ui.js')+`
      window.api={A,render,get pd(){return pd},fail(){updating=false;},refresh(){updating=true;},enrich(){updating=false;pd.snapshot.refreshNeeded=false;pd.plan={...pd.plan,stops:pd.plan.stops.map(stop=>({...stop,lat:31.2,lng:121.4})),roadRoutes:[{day:1,status:'single_stop'}]};}};
    `);
    const api=w.api,status=()=>w.document.querySelector('[data-pm-status]');
    api.render();await tick();assert.equal(counts.maps,0);assert.equal(counts.config,0,'saved schedule rendering does not wait for map configuration');assert.match(status().textContent,/Updating map details/);assert.match(w.document.querySelector('.pm-legend').textContent,/Updating/);assert.doesNotMatch(w.document.body.textContent,/unavailable|could not be refreshed/);assert.match(w.document.querySelector('.pd-stop').textContent,/Saved Museum09:00–10:00/);
    api.fail();api.render();await tick();assert.match(status().textContent,/schedule.*available/,'only a completed failed refresh shows missing locations');assert.match(w.document.querySelector('.pd-stop').textContent,/Saved Museum/);assert.equal(counts.maps,0);
    api.A.pmRetry();await tick();assert.equal(counts.retry,1,'reload map retries missing live details rather than repeatedly showing an error');assert.match(status().textContent,/Updating map details/);
    api.enrich();api.render();await tick();assert.equal(counts.maps,1,'enriched coordinates initialize the correct map');assert.equal(status().hidden,true);assert.match(w.document.querySelector('.pm-legend').textContent,/One stop/);assert.equal(counts.config,provider==='amap'?1:0);dom.window.close();
  }
  console.log('PASS: saved Google/Amap schedules display immediately; no false missing-location errors or SDK/config work while refreshing; failed enrichment preserves stops; explicit retry and refreshed coordinate map mount. All providers mocked.');
})().catch(error=>{console.error(error);process.exitCode=1;});
