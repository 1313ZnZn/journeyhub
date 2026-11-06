// Local visual fixture only; built UI with bootstrap replaced, no service calls.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase');
const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'place-discovery.js'),'utf8').match(/function pdWorkingHTML\(phase\)\{[\s\S]*?\n\}/)[0];
const ctx=vm.createContext({ic:()=>'<span style="font-size:32px">✦</span>'});vm.runInContext(source,ctx);
for(const phase of ['search','plan']){
 const body=ctx.pdWorkingHTML(phase),title=phase==='search'?'Finding your places':'Creating your itinerary';
 const fixture='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local fixture · '+phase+' generation</title>'+html.match(/<style>[\s\S]*?<\/style>/)[0]+'</head><body><div class="device"><header class="bar"><span class="bar-title">'+title+'</span></header><div class="screen">'+body+'</div><nav class="tabbar"><button class="tab" aria-current="page">✦<br>AI Journey</button><button class="tab">Explore</button><button class="tab">Bookings</button><button class="tab">Me</button></nav></div></body></html>';
 fs.writeFileSync(path.join(out,'fixture-progress-'+phase+'.html'),fixture);
}
console.log('Created two local visual fixtures. No network calls or bookings.');
