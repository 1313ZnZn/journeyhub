// Normalizes researched sample catalog content and writes an additive, repeatable migration.
// This file never connects to Supabase, changes live data, or includes credentials.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=__dirname;
const MIGRATION='20261025071728_journeyhub_catalog_expansion.sql';
const BATCH='journeyhub-catalog-2026-10-25';
const OUTPUT=path.basename(ROOT)==='backend'?path.dirname(ROOT):path.resolve(ROOT,'../../outputs/JourneyHub-Supabase');
const SOURCES=['catalog-bangkok.json','catalog-shanghai.json','catalog-singapore.json'];
const KINDS=['Workshop','Food','Culture','Nature','Family','Art','Wellness'];
const CATEGORIES=['culture','food','workshops','nature','family','wellness','art'];
const CITIES={
 Bangkok:{country:'Thailand',timeZone:'Asia/Bangkok'},
 Shanghai:{country:'China',timeZone:'Asia/Shanghai'},
 Singapore:{country:'Singapore',timeZone:'Asia/Singapore'}
};
const PRICE_BASIS='Illustrative JourneyHub sample price; not an official admission price or operator quote.';
const SCHEDULE_BASIS='Illustrative JourneyHub planning slot; not official opening hours or confirmed supplier availability.';
const VISITOR_NOTE='Check the official venue for current access and admission. Tickets, meals, transport and guided services are not included.';
const sourceLabel=url=>{
 const host=new URL(url).hostname.replace(/^www\./,'');
 return ({'english.shanghai.gov.cn':'Shanghai Municipal Government','english.pudong.gov.cn':'Pudong New Area Government','meet-in-shanghai.net':'Official Shanghai China Travel Website','shanghaimuseum.cn':'Shanghai Museum','snhm.org.cn':'Shanghai Natural History Museum'})[host]||host;
};
function https(value,field,id,{optional=false}={}){
 if(optional&&(value==null||value===''))return null;
 assert.equal(typeof value,'string',id+': '+field+' must be a URL');
 assert.equal(new URL(value).protocol,'https:',id+': '+field+' must use HTTPS');
 return value;
}
function normalize(r){
 const meta=CITIES[r.city];assert(meta,'Unknown city: '+r.city);
 const durationMinutes=r.durationMinutes??r.durationMin;
 const cats=[...new Set([...(r.cats??[r.category]),...(r.kind==='Art'?['art']:[])])];
 const sampleStart=r.sampleStart??r.sampleStarts?.[0];
 const sampleWeekdays=[...new Set(r.sampleWeekdays??[0,1,2,3,4,5,6])].sort((a,b)=>a-b);
 const lat=r.lat??null,lng=r.lng??null;
 const requiresFerry=Boolean(r.requiresFerry);
 const visitorNote=[r.visitorNote??r.practicalNote??VISITOR_NOTE,requiresFerry?'Browse only: ferry travel must be planned separately; no JourneyHub sample reservation slots.':null].filter(Boolean).join(' ');
 const photo={
  image:https(r.imageUrl,'imageUrl',r.id),
  alt:r.imageAlt??r.venue??r.mapSearch??r.title,
  credit:r.imageAuthor?r.imageAuthor+' / Wikimedia Commons':r.imageCredit,
  source:https(r.imageSourceUrl,'imageSourceUrl',r.id),
  license:r.imageLicense??'Rights reserved · official source',
  licenseUrl:https(r.imageLicenseUrl??r.imageSourceUrl,'imageLicenseUrl',r.id),
  note:r.imageNote??null
 };
 assert.match(r.id,/^[a-z][a-z0-9-]{2,69}$/);
 assert(KINDS.includes(r.kind),r.id+': unsupported kind');
 assert(cats.length&&cats.every(c=>CATEGORIES.includes(c)),r.id+': unsupported category');
 assert.equal(typeof r.title,'string');assert(r.title.length>5&&r.title.length<=120,r.id+': invalid title');
 assert.equal(typeof r.description,'string');assert(r.description.length>20&&r.description.length<500,r.id+': invalid summary');
 const does=r.does??r.bullets??r.highlights;
 assert(Array.isArray(does)&&does.length===3&&does.every(x=>typeof x==='string'&&x.trim()),r.id+': exactly three highlights required');
 assert(Number.isInteger(durationMinutes)&&durationMinutes>=60&&durationMinutes<=180,r.id+': duration must be 60–180 minutes');
 assert(Number.isInteger(r.priceThb)&&r.priceThb>0,r.id+': sample price must be positive integer THB');
 assert.match(sampleStart,/^([01]\d|2[0-3]):[0-5]\d$/);
 const [h,m]=sampleStart.split(':').map(Number);assert(h*60+m+durationMinutes<=24*60,r.id+': slot crosses local midnight');
 assert(sampleWeekdays.length&&sampleWeekdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6),r.id+': invalid weekdays');
 assert.equal(lat===null,lng===null,r.id+': partial coordinate pair');
 if(lat!==null){assert(Number.isFinite(lat)&&lat>=-90&&lat<=90);assert(Number.isFinite(lng)&&lng>=-180&&lng<=180);}
 assert(typeof photo.credit==='string'&&photo.credit.trim(),r.id+': photo credit required');
 const source=https(r.sourceUrl,'sourceUrl',r.id);
 return {
  id:r.id,city:r.city,country:meta.country,timeZone:meta.timeZone,
  venueId:r.id+'-venue',venue:r.venue??r.mapSearch,area:r.area,
  lat,lng,coordinateAccuracy:lat===null?null:'area',
  coordinateSource:lat===null?null:https(r.coordinateSource,'coordinateSource',r.id),
  title:r.title,summary:r.description,does,cats,kind:r.kind,mapSearch:r.mapSearch,
  img:photo.image,photo,source,sourceLabel:r.sourceLabel??sourceLabel(source),
  additionalSources:(r.additionalSources??[]).map(u=>https(u,'additionalSources',r.id)),
  visitorNote,sample:true,priceBasis:r.priceBasis??PRICE_BASIS,
  scheduleBasis:r.scheduleBasis??SCHEDULE_BASIS,
  durationMinutes,priceThb:r.priceThb,currency:'THB',
  sampleStart,sampleWeekdays,sampleWindowDays:31,
  hostName:'JourneyHub sample itinerary',languages:'English',
  browseOnly:requiresFerry||Boolean(r.browseOnly),requiresFerry,
  verifiedOn:r.verifiedOn??'2026-10-25',catalogBatch:BATCH
 };
}
const read=name=>JSON.parse(fs.readFileSync(path.join(ROOT,name),'utf8').replace(/^\uFEFF/,''));
const entries=SOURCES.flatMap(name=>{
 const input=read(name);assert.equal(input.length,12,name+': expected 12 entries');return input.map(normalize);
});
assert.equal(entries.length,36);assert.equal(new Set(entries.map(r=>r.id)).size,36,'Duplicate experience IDs');
assert.deepEqual(entries.filter(r=>r.browseOnly).map(r=>r.id),['sg-pulau-ubin']);
function details(r){
 return {
  en:r.title,title:r.title,summary:r.summary,does:r.does,cats:r.cats,
  img:r.img,photo:r.photo,mapSearch:r.mapSearch,source:r.source,sourceLabel:r.sourceLabel,
  additionalSources:r.additionalSources,visitorNote:r.visitorNote,sample:true,
  priceBasis:r.priceBasis,scheduleBasis:r.scheduleBasis,
  durationMinutes:r.durationMinutes,sampleStart:r.sampleStart,sampleWeekdays:r.sampleWeekdays,
  browseOnly:r.browseOnly,requiresFerry:r.requiresFerry,verifiedOn:r.verifiedOn,catalogBatch:BATCH
 };
}
const q=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const n=v=>v==null?'NULL':String(v);
let sql='-- Generated by build-catalog.cjs from the three researched city catalogs.\n'+
 '-- Additive sample content only. No supplier integration, official tickets, reviews or live availability.\n'+
 '-- Existing venues, experiences, sessions, prices, bookings and inventory are preserved on conflicts.\n'+
 'BEGIN;\nSET LOCAL search_path = journey_hub, pg_catalog;\n\n'+
 'ALTER TABLE journey_hub.experiences DROP CONSTRAINT IF EXISTS experiences_kind_check;\n'+
 "ALTER TABLE journey_hub.experiences ADD CONSTRAINT experiences_kind_check CHECK (kind IN ("+KINDS.map(q).join(', ')+'));\n\n';
for(const r of entries){
 sql+='-- '+r.id+' | '+r.city+' | '+r.source+'\n';
 sql+='INSERT INTO journey_hub.venues(venue_id,name,kind,area,city,country,time_zone,lat,lng,coordinate_accuracy,coordinate_source)\n'+
 'VALUES ('+[q(r.venueId),q(r.venue),q('workshop_venue'),q(r.area),q(r.city),q(r.country),q(r.timeZone),n(r.lat),n(r.lng),q(r.coordinateAccuracy),q(r.coordinateSource)].join(',')+')\n'+
 'ON CONFLICT (venue_id) DO NOTHING;\n';
 sql+='INSERT INTO journey_hub.experiences(experience_id,venue_id,name,kind,price_thb,duration_min,rating,review_count,host_name,languages,details)\n'+
 'VALUES ('+[q(r.id),q(r.venueId),q(r.title),q(r.kind),n(r.priceThb),n(r.durationMinutes),'NULL','0',q(r.hostName),q(r.languages),q(JSON.stringify(details(r)))+'::jsonb'].join(',')+')\n'+
 'ON CONFLICT (experience_id) DO NOTHING;\n';
 if(!r.browseOnly){
  sql+='-- One local-time sample slot per day, respecting the researched weekday exclusions.\n'+
  'INSERT INTO journey_hub.sessions(session_id,experience_id,starts_at,ends_at,capacity)\n'+
  'SELECT '+q('sample-'+r.id+'-')+"||to_char(d,'YYYYMMDD'),e.experience_id,\n"+
  ' (d+time '+q(r.sampleStart)+') AT TIME ZONE '+q(r.timeZone)+',\n'+
  ' ((d+time '+q(r.sampleStart)+') AT TIME ZONE '+q(r.timeZone)+')+make_interval(mins => '+r.durationMinutes+'),12\n'+
  'FROM (SELECT (now() AT TIME ZONE '+q(r.timeZone)+')::date+n AS d FROM generate_series(0,30) n) dates\n'+
  'JOIN journey_hub.experiences e ON e.experience_id='+q(r.id)+' AND e.venue_id='+q(r.venueId)+" AND e.details->>'catalogBatch'="+q(BATCH)+'\n'+
  'WHERE extract(dow FROM d)::int=ANY(ARRAY['+r.sampleWeekdays.join(',')+']::int[])\n'+
  'ON CONFLICT (session_id) DO NOTHING;\n';
 }else sql+='-- Browse only: ferry transfer cannot be represented by the current road/walk estimator. No sessions created.\n';
 sql+='\n';
}
sql+="NOTIFY pgrst, 'reload schema';\nCOMMIT;\n";
const migrationPath=path.join(ROOT,'supabase/migrations',MIGRATION);
assert(fs.existsSync(migrationPath),'Create the migration with the Supabase CLI before running this generator.');
const json=JSON.stringify(entries,null,2)+'\n';
fs.writeFileSync(path.join(ROOT,'catalog-expansion.json'),json);
fs.writeFileSync(migrationPath,sql);
// Explicit output allowlist: only these newly generated public artifacts are exported.
const outputFiles=[
 ['catalog-expansion.json',json],
 ['backend/catalog-expansion.json',json],
 ['backend/'+MIGRATION,sql],
 ['backend/supabase/migrations/'+MIGRATION,sql],
 ['backend/build-catalog.cjs',fs.readFileSync(__filename,'utf8')]
];
for(const name of SOURCES)outputFiles.push(['backend/'+name,fs.readFileSync(path.join(ROOT,name),'utf8')]);
for(const [relative,contents] of outputFiles){
 const target=path.join(OUTPUT,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,contents);
}
console.log(JSON.stringify({
 entries:entries.length,byCity:Object.fromEntries(Object.keys(CITIES).map(city=>[city,entries.filter(x=>x.city===city).length])),
 sampleReservable:entries.filter(x=>!x.browseOnly).length,browseOnly:entries.filter(x=>x.browseOnly).map(x=>x.id),
 coordinatePairs:entries.filter(x=>x.lat!==null).length,sessionDays:31,maxNewSessionsPerCityPerFourDays:48,
 migration:MIGRATION,sqlBytes:Buffer.byteLength(sql)
},null,2));
