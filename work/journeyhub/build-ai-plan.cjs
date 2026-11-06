const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=__dirname,out=path.resolve(root,'../../outputs/JourneyHub-Supabase');
(async()=>{
 const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(out,'config.js'),'utf8'),context);
 const c=context.window.JOURNEYHUB_CONFIG;
 const r=await fetch(c.url+'/rest/v1/rpc/journeyhub_snapshot',{method:'POST',headers:{apikey:c.publishableKey,'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('Catalog unavailable: '+r.status);
 const data=await r.json(),original=fs.readFileSync(path.join(root,'original.html'),'utf8');
 const venues=Object.fromEntries(data.venues.map(v=>[v.venue_id,v]));
 const fallback=original.match(/food: '(data:image\/[^']+)'/)[1];
 const catalog=data.experiences.map(e=>({id:e.experience_id,name:e.name,city:venues[e.venue_id].city,venue:venues[e.venue_id].name,price:e.price_thb,duration:e.duration_min,does:e.details?.does||[],img:e.details?.img||original.match(new RegExp('\\b'+e.experience_id+": '(data:image/[^']+)'"))?.[1]||fallback}));
 let html=fs.readFileSync(path.join(root,'ai-plan-template.html'),'utf8').replace('__CATALOG__',()=>JSON.stringify(catalog).replaceAll('<','\\u003c')).replace('__BLUEPRINT__',()=>fs.readFileSync(path.join(root,'ai-blueprint.html'),'utf8'));
 for(const s of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(s[1]);
 if(/\p{Script=Han}/u.test(html))throw Error('Non-English text remains');
 fs.writeFileSync(path.join(out,'ai-plan.html'),html);
 const brief=html.slice(0,html.indexOf('<body>')+6)+'<main class="wrap"><div class="page-heading"><div><p class="eyebrow">Journey Hub / Product design</p><h1>AI Travel Companion</h1><p>English UI, content system and implementation plan · 23 October 2026</p></div></div>'+fs.readFileSync(path.join(root,'ai-blueprint.html'),'utf8')+'</main></body></html>';
 fs.writeFileSync(path.join(out,'AI-Implementation-Plan.html'),brief);
 console.log('Built English AI design prototype and implementation brief from '+catalog.length+' catalog experiences');
})().catch(e=>{console.error(e);process.exitCode=1});
