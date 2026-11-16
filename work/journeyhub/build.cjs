const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=__dirname,out=path.resolve(root,'../../outputs/JourneyHub-Supabase');
fs.mkdirSync(out,{recursive:true});
let sql=fs.readFileSync(path.join(root,'original.sql'),'utf8');
sql=sql.slice(sql.indexOf('CREATE EXTENSION'),sql.indexOf('\nCOMMIT;'));
sql=sql.replace('CHECK ((email IS NULL) = (password_hash IS NULL))','CHECK (true)');
sql=sql.replaceAll('LANGUAGE plpgsql AS $$',()=> 'LANGUAGE plpgsql SET search_path = journey_hub, pg_catalog AS $$');
sql=sql.replace(/CREATE VIEW (\w+) AS/g,'CREATE VIEW $1 WITH (security_invoker=true) AS');
const backend=fs.readFileSync(path.join(root,'backend.sql'),'utf8');
const complete='BEGIN;\nCREATE SCHEMA journey_hub;\nSET LOCAL search_path = journey_hub, extensions, pg_catalog;\n'+sql+'\n'+backend+'\nCOMMIT;\n';
const migrations=fs.readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('_journeyhub_online.sql'));
if(migrations.length!==1)throw Error('Expected CLI-created migration');
// Migration history is versioned; frontend builds do not rewrite it.
const policy=fs.existsSync(path.join(root,'policy.sql'))?fs.readFileSync(path.join(root,'policy.sql'),'utf8'):'';
const destinations=fs.existsSync(path.join(root,'destinations.sql'))?fs.readFileSync(path.join(root,'destinations.sql'),'utf8'):'';
const english=fs.existsSync(path.join(root,'english.sql'))?fs.readFileSync(path.join(root,'english.sql'),'utf8'):'';
fs.writeFileSync(path.join(out,'database.sql'),complete.replace(/COMMIT;\s*$/,()=>policy+'\n'+destinations+'\nCOMMIT;\n')+english);
fs.mkdirSync(path.join(out,'backend'),{recursive:true});
fs.copyFileSync(path.join(root,'feature3.sql'),path.join(out,'backend/staff-session-workflow.sql'));
if(english)fs.writeFileSync(path.join(out,'english-catalog.sql'),english);
if(destinations)fs.writeFileSync(path.join(out,'新增上海新加坡.sql'),destinations);
let html=fs.readFileSync(path.join(root,'original.html'),'utf8');
html=html.replace('<title>Journey Hub</title>','<title>Journey Hub · Online</title>');
// Journey is the traveler landing tab; Explore retains its existing route and content.
html=html.replace("const TT = [['home', 'explore', 'Explore'], ['journey', 'journey', 'Journey'],", "const TT = [['journey', 'journey', 'Journey'], ['home', 'explore', 'Explore'],");
html=html.replaceAll("'s-today' : 'home'", "'s-today' : 'journey'");
html=html.replace("state.route = ok ? nx.route : 'home'", "state.route = ok ? nx.route : 'journey'");
html=html.replaceAll("openLogin('traveler', { route: 'home' })", "openLogin('traveler', { route: 'journey' })");
// The imported prototype omits </head>; insert before its known style block.
html=html.replace('<style>','<link rel="preconnect" href="https://images.unsplash.com">\n<link rel="stylesheet" href="./vendor/leaflet/leaflet.css">\n<style>');
if(!html.includes('href="./vendor/leaflet/leaflet.css"'))throw Error('Route map stylesheet injection failed');
html=html.replace('</style>',()=>['app-refresh.css','journal-ui.css','agent-ui.css','journey-route-map.css','journey-planning.css','catalog-ui.css','journey-home.css','place-discovery.css','place-map.css','currency-ui.css','travel-ui.css','trip-history.css','landing-ui.css','night-market.css','trip-care.css','staff-feature3.css','staff-navigation.css','explore-shop.css','place-reviews.css','calendar-ui.css','calendar-visit.css','calendar-map.css','calendar-management.css','demo-wallet.css','unified-booking-ui.css','planning-editor.css','staff-agent.css','traveler-agent.css','traveler-planner-ui.css','trip-chat.css','desktop-web.css','desktop-explore.css','explore-motion.css','fan-carousel.css','plan-fix.css','pip.css','pip-debate.css','pip-booking.css','memory-agent.css','leaderboard.css','itinerary-timeline.css','staff-desktop.css','desktop-motion.css','staff-workflow.css'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n')+'\n</style>');
html=html.replaceAll('Lacquer artisan · groups of up to 30','Lacquer artisan · capacity varies by session');
// Currency changes display formatting only; all stored amounts and inputs remain THB.
html=html.replace('const fmt = (n) =>','let fmt = (n) =>');
// Keep persisted rule summaries canonical when the display preference later changes.
html=html.replaceAll("out.understood.push('budget ' + fmt(n)", "out.understood.push('budget ' + jhBaseMoney(n)");
html=html.replace("' The cheapest plan that works still costs ' + fmt(res.P.total)", "' The cheapest plan that works still costs ' + jhBaseMoney(res.P.total)");
html=html.replaceAll('<b class="num">฿120</b>', '<b class="num">\' + fmt(120) + \'</b>');
html=html.replaceAll('<b class="num">฿480</b>', '<b class="num">\' + fmt(480) + \'</b>');
html=html.replace('<span>from ฿120</span>', '<span>from \' + fmt(120) + \'</span>');
html=html.replace('>+฿120</span>', '>+\' + fmt(120) + \'</span>');
html=html.replace("'<span class=\"meta\">' + s.note +", "'<span class=\"meta\">' + jhCurrencyText(s.note) +");
html=html.replace("fmt(sub + fee) + '</span></div>' + (!hotel", "fmt(sub + fee) + '</span></div><span class=\"cap\">Order total · ' + jhBaseMoney(sub + fee) + '</span>' + (!hotel");
html=html.replace("fmt(total) + '</span><span class=\"meta\">' + plural(guests", "fmt(total) + '</span><span class=\"cap\">Reservation total · ' + jhBaseMoney(total) + '</span><span class=\"meta\">' + plural(guests");
html=html.replace("fmt(toBookCost) + '</button>' : exps.length", "fmt(toBookCost) + '</button><span class=\"cap\" style=\"text-align:center\">Reservation total · ' + jhBaseMoney(toBookCost) + '</span>' : exps.length");
html=html.replace('<script>','<script src="./vendor/supabase.js"></script>\n<script src="./vendor/exifr.js"></script>\n<script src="./vendor/leaflet/leaflet.js"></script>\n<script src="./config.js"></script>\n<script>');
// Keep the original Bangkok itinerary engine and home carousel city-scoped.
html=html.replace("const list = Object.keys(EXPS).filter((k) => state.homeCat === 'all' || EXPS[k].cats.includes(state.homeCat));","const list = Object.keys(EXPS).filter((k) => EXPS[k].city === jhCity && (state.homeCat === 'all' || EXPS[k].cats.includes(state.homeCat)));");
html=html.replaceAll('sDay(s) === day && EXPS[s.exp]',"sDay(s) === day && EXPS[s.exp]?.city === 'Bangkok'");
html=html.replaceAll('sDay(s) === d && EXPS[s.exp]',"sDay(s) === d && EXPS[s.exp]?.city === 'Bangkok'");
html=html.replace("const KEY = 'journey-hub-demo-v3';","const KEY = 'journey-hub-supabase-ui';");
html=html.replace("const LOCAL_DB_KEY = 'journey-hub-localdb-v3';","const LOCAL_DB_KEY = 'journey-hub-unused-offline';");
html=html.replace(/const TRAV = .*?;/,"const TRAV = () => traveler() ? traveler().id : null;");
html=html.replace(/const takenSeats = .*?;\s*return .*?;\s*};/,"const takenSeats = (slotId) => DBC.sessions[slotId]?.taken || 0;");
html=html.replace(/const isMine = .*?;/,"const isMine = d => !!(d && traveler() && d.traveler === traveler().id);");
html=html.replace("toast('Couldn\\'t place the order. Try again.');","toast(jhError(e));");
html=html.replaceAll('refunded (demo)','no payment processed');
html=html.replaceAll('Plan a day with Claude','Plan a day');
html=html.replaceAll('AI day planner','Day planner');
html=html.replaceAll('Claude links bookable stops into one route','The planner links bookable stops into one route');
html=html.replaceAll('Claude reads September results and the live bookings above, then suggests what to try next, with the evidence and how sure it is.','Built-in rules compare the sample September results and current bookings to suggest next steps.');
html=html.replaceAll('Ask Claude for suggestions','Show suggestions');
html=html.replaceAll('Reset demo data','Reset my preferences');
html=html.replaceAll('Mark scarf received at hub','Mark items received at hub');
html=html.replaceAll('Demo guide','Journey guide');
html=html.replaceAll('Sawasdee','Hello, Bangkok');
html=html.replaceAll('Your staff ID is on your badge.','Use your assigned email account.');
html=html.replaceAll('Sign in with another staff ID.','Sign in with another staff email.');
html=html.replaceAll("a duty manager\\'s staff ID.","a duty manager\\'s email account.");
// Remove the local password implementation and embedded PIN hashes.
html=html.replace(/\/\* ---------- sign-in: salted PBKDF2[\s\S]*?const EMAIL_RE =/,
  "const DEMO_TRAVELER = {id:'disabled',email:''}; const DEMO_PASSWORD={};\nconst EMAIL_RE =");
html=html.replace(/pin: 'pbkdf2-sha256\$[^']*'/g,"pin: null");
html=html.replace(/async function doLogin\(kind\) \{[\s\S]*?\nfunction finishLogin/,'async function doLogin(kind) {}\nfunction finishLogin');
// The former Claude database connector is not used or retained.
html=html.replace(/async function connect\(\) \{[\s\S]*?\nfunction modeLabel/,'async function connect() {}\nfunction modeLabel');
html=html.replace(/window\.addEventListener\('storage',[\s\S]*?\n\}\)\(\);/,
  ()=>fs.readFileSync(path.join(root,'frontend.js'),'utf8').replace('jhStart();',()=>['destinations-ui.js','app-refresh.js','journal-store.js','journal-map.js','journal-ui.js','agent-ui.js','journey-route-map.js','journey-planning.js','catalog-ui.js','planning-flow.js','journey-home.js','place-discovery.js','place-reviews.js','place-map.js','amap-ui.js','travel-ui.js','trip-history.js','landing-ui.js','currency-ui.js','explore-shop.js','trip-care.js','calendar-ui.js','calendar-weather.js','calendar-management.js','demo-wallet.js','staff-feature3.js','staff-operations.js','staff-navigation.js','unified-booking-ui.js','staff-agent.js','vendor-address/pinyin.js','attraction-policies.js','attraction-details.js','visit-research.js','calendar-visit.js','calendar-map.js','planning-editor.js','traveler-agent.js','traveler-planner-ui.js','trip-chat.js','input-stability.js','pick-limit.js','explore-motion-art.js','explore-motion.js','place-buddy.js','fan-carousel.js','plan-fix.js','pip.js','pip-debate.js','pip-booking.js','memory-agent.js','leaderboard.js','itinerary-timeline.js','staff-desktop.js','desktop-web.js','staff-workflow.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n')+'\njhStart();')+'\n})();');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
for(const s of scripts)new vm.Script(s);
if(!html.includes('jhStart();')||html.includes('function start(data)'))throw Error('Bootstrap replacement failed');
fs.writeFileSync(path.join(out,'index.html'),html);
// The previous design URL now opens the integrated app, keeping existing bookmarks useful.
fs.writeFileSync(path.join(out,'ai-plan.html'),'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=./"><title>Journey Hub</title></head><body><a href="./">Open Journey Hub</a></body></html>');
fs.mkdirSync(path.join(out,'vendor'),{recursive:true});
fs.cpSync(path.join(root,'vendor-route-map'),path.join(out,'vendor/leaflet'),{recursive:true});
// Desktop sign-in landing film and poster.
fs.cpSync(path.join(root,'media'),path.join(out,'media'),{recursive:true});
fs.copyFileSync(path.join(root,'node_modules/@supabase/supabase-js/dist/umd/supabase.js'),path.join(out,'vendor/supabase.js'));
fs.copyFileSync(path.join(root,'node_modules/@supabase/supabase-js/LICENSE'),path.join(out,'vendor/SUPABASE-LICENSE.txt'));
fs.copyFileSync(path.join(root,'node_modules/exifr/dist/full.umd.js'),path.join(out,'vendor/exifr.js'));
fs.copyFileSync(path.join(root,'node_modules/exifr/LICENSE'),path.join(out,'vendor/EXIFR-LICENSE.txt'));
fs.copyFileSync(path.join(root,'node_modules/world-atlas/LICENSE'),path.join(out,'vendor/WORLD-ATLAS-LICENSE.txt'));
fs.copyFileSync(path.join(root,'package-lock.json'),path.join(out,'dependency-lock.json'));
console.log(JSON.stringify({htmlBytes:Buffer.byteLength(html),sqlBytes:Buffer.byteLength(complete),migration:migrations[0]}));

const configSource=path.join(root,'config.local.js');
fs.copyFileSync(fs.existsSync(configSource)?configSource:path.join(root,'config.example.js'),path.join(out,'config.js'));
