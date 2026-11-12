/* Build first. Browser tests intercept ALL services; no production data is changed.
   npm install --no-save playwright, or set JOURNEYHUB_PLAYWRIGHT_MODULE to its module path.
   JOURNEYHUB_BROWSER_EXECUTABLE optionally selects an installed Chromium browser. */
const {chromium}=require(process.env.JOURNEYHUB_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture,alice}=require('./test-calendar-ui.cjs');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase'),base='https://journeyhub.test';
const bridge=`window.HOME_TEST={A,go,render,get ready(){return !jhLoading&&!!jhLastSnapshot}};jhStart();`;
const html=fs.readFileSync(path.join(out,'index.html'),'utf8').replace('jhStart();',bridge);
const user={...alice,email_confirmed_at:'2026-01-01T00:00:00Z',role:'authenticated',aud:'authenticated'};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const session={access_token:b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})+'.mock',refresh_token:'mock',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
async function run(){
  const browser=await chromium.launch({headless:true,...(process.env.JOURNEYHUB_BROWSER_EXECUTABLE?{executablePath:process.env.JOURNEYHUB_BROWSER_EXECUTABLE}:{})});
  const results=[];
  try{
    for(const motion of ['no-preference','reduce']){
      const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:motion});
      const errors=[];
      await context.addInitScript(session=>localStorage.setItem('sb-hmnbrqykvjvplrsarsta-auth-token',JSON.stringify(session)),session);
      await context.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url()),respond=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
        if(url.origin===base){
          if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
          if(url.pathname==='/config.js')return route.fulfill({contentType:'text/javascript',body:"window.JOURNEYHUB_CONFIG={url:'https://hmnbrqykvjvplrsarsta.supabase.co',publishableKey:'sb_publishable_mock_home_tests'};"});
          const file=path.resolve(out,'.'+decodeURIComponent(url.pathname));
          if(file.startsWith(out+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});
          return route.fulfill({status:404,body:'Not found'});
        }
        if(!url.hostname.endsWith('.supabase.co'))return route.abort();
        if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':base,'access-control-allow-headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version','access-control-allow-methods':'GET,POST,OPTIONS'}});
        if(url.pathname==='/auth/v1/user')return respond(user);
        if(url.pathname==='/auth/v1/token')return respond(session);
        const body=req.postDataJSON()||{};
        if(url.pathname.endsWith('/journeyhub_snapshot'))return respond({...fixture,profile:{id:user.id,email:user.email,name:'Layout Test',country:'China'},personal:{}});
        if(url.pathname.endsWith('/journeyhub_calendar_state'))return respond({removed:[]});
        if(url.pathname.endsWith('/journeyhub_agent_list'))return respond([]);
        if(url.pathname.endsWith('/journeyhub_command')){assert(['profile','personal'].includes(body.p_operation));return respond({});}
        if(url.pathname.includes('/functions/v1/journeyhub-agent')){
          if(req.method()==='GET')return respond({ai:{ready:false},worker:{ready:false},email:{ready:false}});
          if(body.action==='history_list')return respond({items:[],nextCursor:null});
          if(body.action==='care_status')return respond({trips:[]});
          if(body.action==='demo_state')return respond({wallet:{currency:'CNY',balanceMinor:0,bookings:[],ledger:[]}});
          if(body.action==='amap_config')return respond({ready:false});
          if(body.action==='planner_status')return respond({task:null});
          if(body.action==='leaderboard')return respond({cities:[],places:[],items:[]});
          if(body.action==='calendar_weather')return respond({days:[]});
        }
        errors.push('Unexpected request: '+url.pathname);return route.abort();
      });
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.HOME_TEST?.ready);
      await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.HOME_TEST?.ready);
      // The actual welcome button must now be stable enough for a normal browser click.
      await page.evaluate(()=>HOME_TEST.go('welcome'));
      await page.locator('[data-act=dkContinue][data-a=traveler]').click();
      await page.locator('aside.pip.is-center').waitFor({state:'visible'});
      // Look at animations on each control and its ancestors, not just its own CSS:
      // translating a page/card also makes all of its buttons fly in on redraw.
      for(const route of ['orders','trip-history','welcome']){
        await page.evaluate(route=>HOME_TEST.go(route),route);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await page.evaluate(()=>HOME_TEST.render());
        const flying=await page.evaluate(()=>{
          const found=new Set();
          for(const control of document.querySelectorAll('#app button,#app input,#app textarea,#app a')){
            for(let node=control;node&&node!==document.body;node=node.parentElement){
              for(const animation of node.getAnimations()){
                if(animation.playState!=='running')continue;
                // Hover/press transitions are intentional interaction feedback.
                if(typeof animation.transitionProperty==='string')continue;
                const frames=animation.effect?.getKeyframes()||[];
                if(frames.some(frame=>['transform','translate','scale','top','left'].some(key=>frame[key]!==undefined)))found.add(animation.animationName||'scripted layout animation');
              }
            }
          }
          return [...found];
        });
        assert.deepEqual(flying,[],route+' controls must remain stationary on refresh');
      }
      await page.evaluate(()=>HOME_TEST.go('journey'));
      for(const width of [1024,1280,1920]){
        await page.setViewportSize({width,height:900});
        for(let repeat=0;repeat<3;repeat++){
          await page.evaluate(()=>{HOME_TEST.go('orders');HOME_TEST.go('journey');});
          await page.waitForFunction(()=>document.querySelector('aside.pip.is-center')&&!document.querySelector('aside.pip').hidden);
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const metrics=await page.evaluate(()=>{
            const dock=document.querySelector('aside.pip'),rect=dock.getBoundingClientRect(),film=document.querySelector('.gh-film'),style=getComputedStyle(dock);
            return {center:rect.x+rect.width/2,viewport:innerWidth,left:rect.left,right:rect.right,transform:style.transform,filmHidden:film.hidden,filmDisplay:getComputedStyle(film).display,paused:film.querySelector('video').paused};
          });
          assert(Math.abs(metrics.center-metrics.viewport/2)<1,JSON.stringify(metrics));
          assert(metrics.left>=0&&metrics.right<=width);assert.equal(metrics.transform,'none');
          assert(metrics.filmHidden);assert.equal(metrics.filmDisplay,'none');assert(metrics.paused);
          await page.evaluate(()=>{HOME_TEST.render();HOME_TEST.render();});
          assert(await page.locator('aside.pip [data-pip-input]').isVisible());
        }
        results.push({motion,width,centered:true,filmHidden:true,reentries:3,refreshControlsStable:true});
      }
      // Keep the film node available when returning to the welcome page.
      await page.evaluate(()=>HOME_TEST.go('welcome'));
      await page.waitForFunction(()=>!document.querySelector('.gh-film').hidden);
      await page.evaluate(()=>HOME_TEST.go('journey'));
      await page.locator('aside.pip.is-center').waitFor({state:'visible'});
      await page.setViewportSize({width:390,height:844});assert(await page.locator('[data-act=tab][data-a=journey]').isVisible());
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log(JSON.stringify({passed:results,liveWrites:0}));
  }finally{await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
