const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase');
let html=fs.readFileSync(path.join(out,'fixture-calendar.html'),'utf8');
html=html.replaceAll('2026-11-04','2026-11-12').replaceAll('2026-11-08','2026-11-20');
const response={city:'Shanghai',source:'Amap',forecastDate:'2026-11-05',days:[{date:'2026-11-12',icon:'rain',condition:'Rain',tempC:17,period:'12:00',source:'MET Norway'},{date:'2026-11-13',icon:'partly',condition:'Partly cloudy',tempC:18,period:'12:00',source:'MET Norway'}],expiresAt:'2026-11-05T23:59:59Z'};
html=html.replace(',rpc:async(name,args={})=>',',functions:{invoke:async(_name,{body})=>({data:{...'+JSON.stringify(response)+',city:body.city},error:null})},rpc:async(name,args={})=>');
fs.writeFileSync(path.join(out,'fixture-weather.html'),html);
console.log('Wrote local weather fixture: Nov12/13 real-format mocked forecasts and Nov20 pending state; no live data writes.');
