const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'destinations-ui.js');let code=fs.readFileSync(file,'utf8');
const replacements={
 '曼谷 Bangkok':'Bangkok','上海 Shanghai':'Shanghai','新加坡 Singapore':'Singapore','你好，上海':'Hello, Shanghai','Sawasdee':'Hello, Bangkok',
 '从外滩天际线到老城茶香，探索上海的城市日常。':'Discover waterfront architecture, old-town flavors and tea traditions.',
 '滨海湾、多元街区与本地味道，一起探索狮城。':'Explore the bay, heritage neighborhoods and the flavors of Singapore.',
 '目的地 Destination':'Destination','THB / 人':'THB / person','示例':'Sample',
 '当前目的地没有匹配项目 / No matches in this destination.':'No matches in this destination. Try another keyword.',
 '全部 All':'All','文化 Culture':'Culture','美食 Food':'Food','手作 Workshops':'Workshops',
 '搜索体验、街区或关键词':'Search experiences, neighborhoods or keywords','搜索当前目的地':'Search this destination',
 "c.label+'体验'":"c.label+' experiences'", // handled explicitly below for markup
 ' 个项目':' experiences',
 '示例项目与场次，尚未对接当地运营商。平台统一以 THB 显示示例价格，不是人民币或新加坡元报价；预约不会扣款.':'Sample experiences and sessions. Local operators are not connected. Prices are in THB; no payment is taken.',
 '示例项目与场次，尚未对接当地运营商。平台统一以 THB 显示示例价格，不是人民币或新加坡元报价；预约不会扣款。':'Sample experiences and sessions. Local operators are not connected. Prices are in THB, not CNY or SGD. No payment is taken.',
 '示例项目 · 预约会写入在线数据库，但不是运营商确认订单，也不会扣款。价格统一为 THB。':'Sample experience. Reservations are saved online but are not operator-confirmed tickets. Prices are in THB. No payment is taken.',
 ' 人 · 示例总价':' guests · sample total','已预约 ':'Reserved ','暂无可预约名额':'No availability','保存中…':'Saving…','预约示例场次':'Reserve sample session',
 '收藏体验':'Save experience',' · 查看区域地图':' · View area map','体验内容':'What to expect',
 '具体集合点及向导待运营商接入后确认。':'The meeting point and guide will be confirmed when an operator is connected.',
 '选择日期与场次':'Choose a date and session','所有时间为 ':'All times are local: ',' 当地时间（UTC+8）。':' (UTC+8).',
 '已预约':'Reserved','已结束':'Ended',' 名额':' seats','暂无场次':'No sessions available','人数':'Guests',
 '以上为示例体验费。餐饮、门票是否包含，以体验内容说明为准。无需付款。':'Sample experience fee. See the description for food and ticket inclusions. No payment is required.',
 'Shop 当前为曼谷商店目录；上海与新加坡尚未接入商店。':'The shop currently lists Bangkok stores. Shanghai and Singapore stores are not connected yet.'
};
for(const [a,b] of Object.entries(replacements).sort((a,b)=>b[0].length-a[0].length))code=code.replaceAll(a,b);
code=code.replace("c.label+'体验</h2>","c.label+' experiences</h2>");
if(/\p{Script=Han}/u.test(code))throw Error('Untranslated interface text remains: '+code.match(/.{0,18}\p{Script=Han}.{0,18}/gu).join('\n'));
fs.writeFileSync(file,code);
const rows=[
 ['sh-bund','The Bund waterfront','Huangpu','Bund Heritage Walk',['Walk along the Bund and discover the architecture on both sides of the Huangpu River.','Photograph the Pudong skyline and explore the waterfront.','This sample outdoor walking route does not include attraction tickets.']],
 ['sh-oldtown','Yuyuan neighborhood','Old City','Old City Food Walk',['Explore the lanes around Yuyuan on foot.','Discover Shanghai food traditions, including soup dumplings.','Food and Yuyuan Garden admission are not included in the sample price.']],
 ['sh-tea','Old City tea studio (sample)','Huangpu','Jiangnan Tea Workshop',['Explore tea aromas and traditional brewing utensils.','Practice brewing and learn about Jiangnan tea culture.','The studio and host are examples; a partner must confirm the actual venue.']],
 ['sg-marina','Marina Bay waterfront','Marina Bay','Marina Bay Skyline Walk',['Explore the public waterfront paths around Marina Bay.','Discover Singapore waterfront architecture and public spaces.','This outdoor sample route does not include observation-deck tickets or a guaranteed light show.']],
 ['sg-chinatown','Chinatown','Chinatown','Chinatown Food & Heritage',['Explore Chinatown streets and shophouse architecture.','Discover hawker-center culture and choose local dishes.','Food is not included in the sample price. Stall choices depend on opening hours.']],
 ['sg-kampong','Kampong Gelam','Kampong Gelam','Kampong Gelam Culture Walk',['Explore Kampong Gelam and the lanes around Haji Lane.','Discover the neighborhood through its streets and architecture.','Religious sites are viewed from outside. Entry and visitor etiquette depend on local rules.']]
];
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
let sql='-- English-only public catalog. Preserve IDs, reservations, prices and inventory.\nBEGIN;\n';
for(const [id,venue,area,name,does] of rows){sql+=`UPDATE journey_hub.venues SET name=${q(venue)},area=${q(area)} WHERE venue_id=${q(id+'-venue')};\nUPDATE journey_hub.experiences SET name=${q(name)},languages='Mandarin, English',details=details||${q(JSON.stringify({en:name,does}))}::jsonb WHERE experience_id=${q(id)};\n`;}
sql+='COMMIT;\n';fs.writeFileSync(path.join(__dirname,'english.sql'),sql);
console.log('English interface and catalog update prepared');
