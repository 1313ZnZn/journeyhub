const fs=require('node:fs'),path=require('node:path');
const rows=[
 {id:'sh-bund',city:'Shanghai',country:'China',tz:'Asia/Shanghai',venue:'The Bund waterfront · 外滩滨江',area:'Huangpu · 黄浦',name:'外滩建筑与滨江漫步',en:'Bund Heritage Walk',kind:'Culture',price:1200,duration:120,start:'09:00',cats:['culture'],does:['沿外滩步行，认识历史建筑与黄浦江两岸风貌。','记录浦东天际线，了解城市滨水空间。','示例路线为室外步行，不包含景点门票。'],search:'The Bund Shanghai',color:'#21555b',accent:'#efb76d',source:'https://www.meet-in-shanghai.net/cn/'},
 {id:'sh-oldtown',city:'Shanghai',country:'China',tz:'Asia/Shanghai',venue:'Yuyuan neighbourhood · 豫园片区',area:'Old City · 老城厢',name:'豫园老城与小吃寻味',en:'Old City Food Walk',kind:'Food',price:1500,duration:120,start:'12:00',cats:['food','culture'],does:['步行探索豫园周边的老城街巷。','认识小笼包等上海小吃，交流饮食文化。','示例价格不含餐饮与豫园门票；餐点自行选择。'],search:'Yuyuan Shanghai',color:'#8b493a',accent:'#f4c78a',source:'https://www.meet-in-shanghai.net/cn/'},
 {id:'sh-tea',city:'Shanghai',country:'China',tz:'Asia/Shanghai',venue:'Old City tea studio · 老城茶文化工作室（示例）',area:'Huangpu · 黄浦',name:'江南茶文化体验',en:'Jiangnan Tea Workshop',kind:'Workshop',price:1100,duration:90,start:'15:00',cats:['workshops','culture'],does:['认识茶叶香气与常见冲泡器具。','练习冲泡步骤，交流江南茶文化。','工作室与主理人为示例，实际场地待合作方确认。'],search:'Yuyuan Shanghai',color:'#365f48',accent:'#e4d4a6',source:'https://www.meet-in-shanghai.net/en/food/huxin-pavilion-in-shanghai-yuyuan-garden-949270/'},
 {id:'sg-marina',city:'Singapore',country:'Singapore',tz:'Asia/Singapore',venue:'Marina Bay waterfront · 滨海湾',area:'Marina Bay · 滨海湾',name:'滨海湾城市漫步',en:'Marina Bay Skyline Walk',kind:'Culture',price:1600,duration:120,start:'17:00',cats:['culture'],does:['沿滨海湾公共步道欣赏城市天际线。','认识新加坡滨水建筑与公共空间。','仅为室外示例路线，不含观景台门票或灯光秀承诺。'],search:'Marina Bay Singapore',color:'#1f5366',accent:'#f5bc72',source:'https://www.visitsingapore.com/'},
 {id:'sg-chinatown',city:'Singapore',country:'Singapore',tz:'Asia/Singapore',venue:'Chinatown · 牛车水',area:'Chinatown · 牛车水',name:'牛车水美食与文化',en:'Chinatown Food & Heritage',kind:'Food',price:1800,duration:120,start:'12:00',cats:['food','culture'],does:['步行探索牛车水街区与店屋建筑。','了解熟食中心文化，自选本地餐点。','示例价格不含餐饮，具体摊位按当天营业情况选择。'],search:'Chinatown Singapore',color:'#955246',accent:'#f3d4a0',source:'https://www.visitsingapore.com/'},
 {id:'sg-kampong',city:'Singapore',country:'Singapore',tz:'Asia/Singapore',venue:'Kampong Gelam · 甘榜格南',area:'Kampong Gelam · 甘榜格南',name:'甘榜格南文化漫步',en:'Kampong Gelam Culture Walk',kind:'Culture',price:1400,duration:120,start:'09:00',cats:['culture'],does:['探索甘榜格南街区与哈芝巷周边。','从街景与建筑认识多元文化。','宗教场所外观参观；入内开放与礼仪以现场规定为准。'],search:'Kampong Gelam Singapore',color:'#44615b',accent:'#e6b85e',source:'https://www.visitsingapore.com/'}
];
function illustration(r){
 const skyline=r.city==='Shanghai'?'<path d="M390 215V105h30v110m40 0V65h34v150m38 0V125h32v90"/><path d="M325 215V65m-20 75h40m-20-95v20" fill="none" stroke="currentColor" stroke-width="8"/><circle cx="325" cy="115" r="22"/><circle cx="325" cy="175" r="13"/>':'<path d="M340 215V120h28v95m40 0V100h28v115m40 0V115h28v100M320 100q90-35 204-5l-10 20q-100-20-190 8z"/><path d="M540 215V175h50v40m-55-40q30-50 60 0z"/>';
 const art=r.id==='sh-tea'?'<path d="M350 140h110v30q-55 60-110 0z"/><path d="M460 145q60-10 25 45h-30" fill="none" stroke="currentColor" stroke-width="9"/><path d="M380 115q-20-20 0-40m35 40q-20-20 0-40" fill="none" stroke="currentColor" stroke-width="5"/>':r.kind==='Food'?'<ellipse cx="425" cy="192" rx="116" ry="24"/><g fill="#fff1d8"><path d="M340 175q35-90 70 0zm75 0q35-90 70 0zm65 0q35-90 70 0z"/></g>':skyline;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"><rect width="640" height="320" fill="${r.color}"/><circle cx="530" cy="70" r="41" fill="${r.accent}" opacity=".9"/><g color="${r.accent}" fill="currentColor">${art}</g><path d="M0 245Q160 205 320 248T640 245V320H0Z" fill="#ffffff" opacity=".1"/><text x="30" y="55" fill="#ffffff" font-family="sans-serif" font-size="15" letter-spacing="4">JOURNEY HUB / ${r.city.toUpperCase()}</text><text x="30" y="272" fill="#fff6e6" font-family="sans-serif" font-size="26">${r.en.replaceAll('&','&amp;')}</text><text x="32" y="298" fill="#ffffff" opacity=".65" font-family="sans-serif" font-size="11" letter-spacing="2">ILLUSTRATED SAMPLE EXPERIENCE</text></svg>`;
 return 'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
}
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
let sql=`-- Additional sample experiences; THB remains the platform accounting currency.
ALTER TABLE journey_hub.venues ADD COLUMN city text NOT NULL DEFAULT 'Bangkok', ADD COLUMN country text NOT NULL DEFAULT 'Thailand', ADD COLUMN time_zone text NOT NULL DEFAULT 'Asia/Bangkok';
ALTER TABLE journey_hub.experiences ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
`;
for(const r of rows){
 const details={sample:true,en:r.en,does:r.does,cats:r.cats,img:illustration(r),mapSearch:r.search,source:r.source};
 sql+=`INSERT INTO journey_hub.venues(venue_id,name,kind,area,city,country,time_zone) VALUES (${q(r.id+'-venue')},${q(r.venue)},'workshop_venue',${q(r.area)},${q(r.city)},${q(r.country)},${q(r.tz)});
INSERT INTO journey_hub.experiences(experience_id,venue_id,name,kind,price_thb,duration_min,rating,review_count,host_name,languages,details) VALUES (${q(r.id)},${q(r.id+'-venue')},${q(r.name)},${q(r.kind)},${r.price},${r.duration},NULL,0,${q('Journey '+r.city+' Team')},'中文 / English',${q(JSON.stringify(details))}::jsonb);
INSERT INTO journey_hub.sessions(session_id,experience_id,starts_at,ends_at,capacity)
SELECT ${q(r.id+'-')}||to_char(d,'YYYYMMDD'),${q(r.id)},(d+time ${q(r.start)}) AT TIME ZONE ${q(r.tz)},((d+time ${q(r.start)}) AT TIME ZONE ${q(r.tz)})+interval '${r.duration} minutes',12
FROM (SELECT (now() AT TIME ZONE ${q(r.tz)})::date+n AS d FROM generate_series(0,14) n) dates;
`;
}
const migration=fs.readdirSync(path.join(__dirname,'supabase/migrations')).find(n=>n.endsWith('_journeyhub_destinations.sql'));
fs.writeFileSync(path.join(__dirname,'supabase/migrations',migration),sql);
fs.writeFileSync(path.join(__dirname,'destinations.sql'),sql);
console.log('Prepared 6 experiences and 90 local-time sessions');
