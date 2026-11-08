/* Place characters: every place gets a small character from its category (Google primaryType
   or Amap type, then its name), with colours and details varied by its ID so the same place
   always looks the same. Moods follow what is happening (talking, kept, put back, closed). */
const JH_BUDDY_RULES=[
 ['animal',/zoo|aquarium|wildlife|safari|动物园|海洋馆|水族/i],
 ['fun',/amusement|theme park|water park|arcade|游乐|乐园/i],
 ['museum',/museum|gallery|exhibition|art cent|science|博物馆|美术馆|展览|纪念馆/i],
 ['temple',/temple|shrine|palace|pagoda|church|mosque|cathedral|\bwat\b|worship|寺|庙|宫|教堂/i],
 ['show',/theat(?:er|re)|concert|cinema|movie|performing|opera|剧院|剧场|演出|影院/i],
 ['view',/tower|observation|viewpoint|skyline|lookout|观景|塔/i],
 ['water',/river|pier|ferry|cruise|bund|waterfront|harbou?r|marina|canal|江|码头|外滩|游船/i],
 ['nature',/mountain|beach|lake|hik|nature|island|forest|waterfall|山|湖|海滩|森林/i],
 ['park',/park|garden|botanic|公园|花园|植物园/i],
 ['cafe',/caf[eé]|coffee|tea|bakery|dessert|matcha|ice cream|咖啡|茶|甜品|面包/i],
 ['bar',/\bbar\b|pub|night ?club|wine|beer|cocktail|brewery|酒吧|酒馆/i],
 ['food',/restaurant|food|dining|meal|noodle|dumpling|eatery|bistro|kitchen|steak|sushi|hot ?pot|bbq|餐|饭|面馆|小吃|火锅/i],
 ['shop',/shop|mall|market|store|bazaar|outlet|boutique|购物|商场|市场|商店/i],
 ['stay',/hotel|lodging|resort|hostel|inn\b|酒店|宾馆|民宿/i],
 ['heritage',/historic|old town|heritage|lane|street|alley|monument|landmark|gate|attraction|老街|古镇|里弄|弄堂|景点|景区/i]
];
function jhBuddyKind(place){
  // Generic types ("tourist attraction") say less than the name ("… Tower", "… Garden").
  const generic=/^(?:tourist attraction|attraction|point of interest|establishment|place|景点|风景名胜|)$/i.test(String(place?.kind||'').trim());
  const fields=generic?[place?.name,place?.category,...(Array.isArray(place?.categories)?place.categories:[]),place?.kind]:[place?.kind,place?.category,...(Array.isArray(place?.categories)?place.categories:[]),place?.name];
  for(const text of fields){if(typeof text!=='string'||!text)continue;for(const [kind,re] of JH_BUDDY_RULES)if(re.test(text))return kind;}
  return 'pin';
}
const jhBuddyHash=s=>{let h=2166136261;for(const c of String(s||''))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const JH_BUDDY_PAL={food:[['#fbf4e8','#e15b4f'],['#fff0d6','#3e7bd9'],['#f7efe6','#2f8a5f']],cafe:[['#f2e3d1','#8a5a3c'],['#e8f5e0','#5aa04a'],['#fde7ec','#c2577a']],bar:[['#cfe9ff','#ff6b8a'],['#ffe7c2','#ff9f43']],museum:[['#dcd6f0','#8f86c9'],['#e6efe8','#5f9c7e'],['#f2e2d4','#b5735a']],temple:[['#f3e2c4','#2f8a5f'],['#ffe1c9','#d4543f'],['#f1e8ff','#6a5acd']],park:[['#5fc27e','#72d391'],['#8fd36b','#a8e48a']],heritage:[['#e8b49a','#ff6b5b'],['#d6c7b4','#ffb84d'],['#c9d6e8','#ff7a59']],view:[['#ff8fb1','#ff8fb1'],['#9ec8ff','#5b8def']],shop:[['#ffcf6b','#ff8f6b'],['#b8a6ff','#7f6be0']],water:[['#5b8def','#ffb86b'],['#3fa7c4','#ff8fb1']],show:[['#ffe0ea','#a83f5e'],['#e9e3ff','#5b4bb7']],animal:[['#7fd3e8','#3fa7c4'],['#ffc98f','#ff8a3d']],nature:[['#7fb59a','#ffd36b'],['#9fc4e8','#ffb86b']],fun:[['#ff8fb1','#ffd36b'],['#8fd3ff','#c5ff48']],stay:[['#a9b8ff','#5b6bd6']],pin:[['#c5ff48','#c5ff48'],['#a990ff','#a990ff'],['#ffb86b','#ffb86b']]};
function jhBuddyFace(cx,cy,mood,s=1){
  const D='#2a2233',n=v=>+(v).toFixed(1);
  const eye=mood==='happy'?'<path d="M'+n(cx-11*s)+' '+cy+'q'+n(4*s)+' '+n(-5*s)+' '+n(8*s)+' 0M'+n(cx+3*s)+' '+cy+'q'+n(4*s)+' '+n(-5*s)+' '+n(8*s)+' 0" stroke="'+D+'" stroke-width="'+n(2.6*s)+'" stroke-linecap="round" fill="none"/>'
    :mood==='sleep'?'<path d="M'+n(cx-11*s)+' '+cy+'h'+n(7*s)+'M'+n(cx+4*s)+' '+cy+'h'+n(7*s)+'" stroke="'+D+'" stroke-width="'+n(2.6*s)+'" stroke-linecap="round"/>'
    :'<ellipse cx="'+n(cx-7*s)+'" cy="'+cy+'" rx="'+n(2.6*s)+'" ry="'+n(3.4*s)+'" fill="'+D+'"/><ellipse cx="'+n(cx+7*s)+'" cy="'+cy+'" rx="'+n(2.6*s)+'" ry="'+n(3.4*s)+'" fill="'+D+'"/><circle cx="'+n(cx-6*s)+'" cy="'+n(cy-1.2*s)+'" r="'+n(.9*s)+'" fill="#fff"/><circle cx="'+n(cx+8*s)+'" cy="'+n(cy-1.2*s)+'" r="'+n(.9*s)+'" fill="#fff"/>';
  const mouth=mood==='talk'?'<ellipse cx="'+cx+'" cy="'+n(cy+8*s)+'" rx="'+n(3.6*s)+'" ry="'+n(3*s)+'" fill="#7a2f3a"/>'
    :mood==='sad'?'<path d="M'+n(cx-4*s)+' '+n(cy+10*s)+'q'+n(4*s)+' '+n(-4*s)+' '+n(8*s)+' 0" stroke="'+D+'" stroke-width="'+n(2.2*s)+'" stroke-linecap="round" fill="none"/>'
    :mood==='smug'?'<path d="M'+n(cx-4*s)+' '+n(cy+8*s)+'q'+n(5*s)+' '+n(3*s)+' '+n(9*s)+' '+n(-2*s)+'" stroke="'+D+'" stroke-width="'+n(2.2*s)+'" stroke-linecap="round" fill="none"/>'
    :mood==='sleep'?'<ellipse cx="'+cx+'" cy="'+n(cy+8*s)+'" rx="'+n(2*s)+'" ry="'+n(1.6*s)+'" fill="'+D+'"/>'
    :'<path d="M'+n(cx-5*s)+' '+n(cy+7*s)+'q'+n(5*s)+' '+n(5*s)+' '+n(10*s)+' 0" stroke="'+D+'" stroke-width="'+n(2.4*s)+'" stroke-linecap="round" fill="none"/>';
  return eye+mouth+'<ellipse cx="'+n(cx-14*s)+'" cy="'+n(cy+6*s)+'" rx="'+n(3.6*s)+'" ry="'+n(2.4*s)+'" fill="#ff8f9a" opacity=".55"/><ellipse cx="'+n(cx+14*s)+'" cy="'+n(cy+6*s)+'" rx="'+n(3.6*s)+'" ry="'+n(2.4*s)+'" fill="#ff8f9a" opacity=".55"/>';
}
const JH_BUDDY_DRAW={
 food:(c,a,v,m)=>'<path d="M66 18l14-14M74 22l12-12" stroke="#c9905a" stroke-width="4" stroke-linecap="round"/><path d="M32 30c-4-8 4-10 0-18M50 30c-4-8 4-10 0-18" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5" fill="none"/><path d="M14 46h72a36 34 0 0 1-72 0Z" fill="'+c+'"/><rect x="12" y="42" width="76" height="8" rx="4" fill="'+a+'"/>'+(v===1?'<circle cx="34" cy="40" r="7" fill="#f3c96b"/><circle cx="52" cy="38" r="7" fill="#f3c96b"/><circle cx="68" cy="40" r="6" fill="#f3c96b"/>':v===2?'<path d="M24 44h52" stroke="#7fd36b" stroke-width="6" stroke-linecap="round"/>':'<path d="M22 44c8-8 14 4 22-4s14 4 22-4 10 2 12 0" stroke="#f3c96b" stroke-width="4" fill="none"/>')+jhBuddyFace(50,64,m),
 cafe:(c,a,v,m)=>'<path d="M40 22c-4-8 4-10 0-18M54 22c-4-8 4-10 0-18" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5" fill="none"/><path d="M18 30h60v34a26 26 0 0 1-26 26h-8a26 26 0 0 1-26-26Z" fill="'+c+'"/><path d="M78 40h6a10 10 0 0 1 0 20h-6" stroke="'+c+'" stroke-width="7" fill="none"/><rect x="18" y="30" width="60" height="8" fill="'+a+'"/>'+jhBuddyFace(48,58,m),
 bar:(c,a,v,m)=>'<path d="M14 18h72L54 56v28h16v8H30v-8h16V56Z" fill="'+c+'"/><path d="M24 26h52L50 50Z" fill="'+a+'"/><circle cx="70" cy="16" r="7" fill="#7fd36b"/><path d="M70 16l-12 22" stroke="#e8e0f5" stroke-width="2"/>'+jhBuddyFace(50,36,m,.75),
 museum:(c,a,v,m)=>'<rect x="16" y="46" width="68" height="50" rx="9" fill="'+c+'"/><path d="M10 48L50 20L90 48Z" fill="'+a+'"/><rect x="10" y="44" width="80" height="6" rx="3" fill="'+a+'" opacity=".85"/><g fill="#000" opacity=".1"><rect x="22" y="76" width="7" height="20"/><rect x="71" y="76" width="7" height="20"/></g><path d="M44 96v-12a6 6 0 0 1 12 0v12" fill="#000" opacity=".15"/>'+(v===1?'<circle cx="50" cy="36" r="5" fill="#efc46c"/>':'')+jhBuddyFace(50,62,m),
 temple:(c,a,v,m)=>'<rect x="22" y="50" width="56" height="46" rx="12" fill="'+c+'"/><rect x="30" y="80" width="8" height="16" fill="#000" opacity=".1"/><rect x="62" y="80" width="8" height="16" fill="#000" opacity=".1"/><path d="M6 54Q50 22 94 54Q82 46 50 42Q18 46 6 54Z" fill="'+a+'"/><path d="M22 36Q50 14 78 36Q68 31 50 29Q32 31 22 36Z" fill="'+a+'" opacity=".8"/><circle cx="50" cy="16" r="4" fill="#efc46c"/>'+jhBuddyFace(50,64,m),
 park:(c,a,v,m)=>'<rect x="44" y="70" width="12" height="26" rx="4" fill="#9a6b4f"/><circle cx="50" cy="46" r="34" fill="'+c+'"/><circle cx="30" cy="36" r="12" fill="'+a+'"/><circle cx="70" cy="34" r="10" fill="'+a+'"/>'+(v===1?'<circle cx="72" cy="56" r="4" fill="#ff8fb1"/><circle cx="30" cy="58" r="4" fill="#ff8fb1"/>':'')+jhBuddyFace(50,50,m),
 heritage:(c,a,v,m)=>'<rect x="18" y="38" width="64" height="58" rx="10" fill="'+c+'"/><path d="M34 96V70a16 16 0 0 1 32 0v26" fill="#000" opacity=".35"/><rect x="14" y="32" width="72" height="10" rx="4" fill="#4c3a4f"/><line x1="26" y1="42" x2="26" y2="48" stroke="#4c3a4f" stroke-width="2"/><ellipse cx="26" cy="53" rx="6" ry="7" fill="'+a+'"/><line x1="74" y1="42" x2="74" y2="48" stroke="#4c3a4f" stroke-width="2"/><ellipse cx="74" cy="53" rx="6" ry="7" fill="'+a+'"/>'+jhBuddyFace(50,56,m,.9),
 view:(c,a,v,m)=>'<rect x="47" y="8" width="6" height="88" rx="3" fill="#b9a5c9"/><circle cx="50" cy="20" r="8" fill="'+a+'"/><circle cx="50" cy="58" r="27" fill="'+c+'"/><path d="M26 86l12-14M74 86L62 72" stroke="#b9a5c9" stroke-width="5" stroke-linecap="round"/><ellipse cx="42" cy="46" rx="7" ry="4" fill="#fff" opacity=".35"/>'+jhBuddyFace(50,58,m),
 shop:(c,a,v,m)=>'<path d="M34 34a16 16 0 0 1 32 0" stroke="'+a+'" stroke-width="6" fill="none"/><path d="M18 34h64l-4 60H22Z" fill="'+c+'"/><path d="M18 34h64v8H18Z" fill="'+a+'"/>'+(v===1?'<path d="M64 52l4 8 8 1-6 6 2 8-8-4-8 4 2-8-6-6 8-1Z" fill="#efc46c"/>':'')+jhBuddyFace(46,62,m),
 water:(c,a,v,m)=>'<path d="M10 70h80l-10 22H22Z" fill="'+c+'"/><rect x="28" y="42" width="44" height="30" rx="8" fill="#f4f0fa"/><rect x="46" y="22" width="6" height="22" fill="#4c3a4f"/><path d="M52 24l18 8-18 6Z" fill="'+a+'"/><path d="M6 98q8-5 16 0t16 0 16 0 16 0 16 0" stroke="#8fd3ff" stroke-width="3" fill="none"/>'+jhBuddyFace(50,56,m,.85),
 show:(c,a,v,m)=>'<path d="M10 14h80v12H10Z" fill="'+a+'"/><path d="M10 26q10 30 0 70h20q-6-40 0-70ZM90 26q-10 30 0 70H70q6-40 0-70Z" fill="'+a+'" opacity=".85"/><rect x="28" y="40" width="44" height="56" rx="16" fill="'+c+'"/>'+jhBuddyFace(50,62,m),
 animal:(c,a,v,m)=>'<path d="M76 58l18-14v28Z" fill="'+a+'"/><ellipse cx="46" cy="58" rx="36" ry="28" fill="'+c+'"/><path d="M40 30q10-10 20 0" fill="'+a+'"/><circle cx="84" cy="26" r="4" fill="none" stroke="#8fd3ff" stroke-width="2"/>'+jhBuddyFace(40,56,m),
 nature:(c,a,v,m)=>'<path d="M4 96L38 30l18 30 10-14 30 50Z" fill="'+c+'"/><path d="M38 30l-8 16 8-4 6 6Z" fill="#fff"/><circle cx="82" cy="20" r="9" fill="'+a+'"/>'+jhBuddyFace(44,74,m,.9),
 fun:(c,a,v,m)=>'<path d="M30 96L50 54 70 96" stroke="#b9a5c9" stroke-width="5" fill="none"/><circle cx="50" cy="48" r="36" fill="none" stroke="'+c+'" stroke-width="5"/>'+[0,60,120,180,240,300].map(d=>{const r=d*Math.PI/180,x=(50+36*Math.cos(r)).toFixed(1),y=(48+36*Math.sin(r)).toFixed(1);return '<line x1="50" y1="48" x2="'+x+'" y2="'+y+'" stroke="'+c+'" stroke-width="2"/><circle cx="'+x+'" cy="'+y+'" r="6" fill="'+a+'"/>';}).join('')+'<circle cx="50" cy="48" r="17" fill="'+c+'"/>'+jhBuddyFace(50,46,m,.6),
 stay:(c,a,v,m)=>'<rect x="14" y="54" width="72" height="34" rx="10" fill="'+c+'"/><rect x="14" y="40" width="26" height="20" rx="8" fill="#f4f0fa"/><rect x="10" y="84" width="8" height="12" rx="3" fill="'+a+'"/><rect x="82" y="84" width="8" height="12" rx="3" fill="'+a+'"/>'+jhBuddyFace(56,68,m,.85),
 pin:(c,a,v,m)=>'<path d="M50 98C30 72 18 58 18 42a32 32 0 0 1 64 0c0 16-12 30-32 56Z" fill="'+c+'"/><circle cx="50" cy="42" r="22" fill="#fff" opacity=".2"/>'+jhBuddyFace(50,44,m)
};
const JH_BUDDY_FEET='<ellipse cx="50" cy="104" rx="30" ry="4" fill="#000" opacity=".25"/><rect x="34" y="94" width="10" height="9" rx="4" fill="#2a2233"/><rect x="56" y="94" width="10" height="9" rx="4" fill="#2a2233"/>';
// A place's character as an SVG string. `place` needs at least an id or name; kind/category help.
function jhBuddy(place,size=56,mood='smile',extraClass=''){
  const kind=jhBuddyKind(place||{}),pal=JH_BUDDY_PAL[kind],h=jhBuddyHash(place?.id||place?.name||kind),variant=h%pal.length,[c,a]=pal[variant];
  const body=(kind==='water'?'':JH_BUDDY_FEET)+JH_BUDDY_DRAW[kind](c,a,variant,mood);
  return '<span class="jh-buddy is-'+kind+(extraClass?' '+extraClass:'')+'" aria-hidden="true" style="--s:'+size+'px"><svg viewBox="0 0 100 110" width="'+size+'" height="'+Math.round(size*1.1)+'" focusable="false">'+body+'</svg></span>';
}
// Just the head, in a round badge (chat avatars, tray chips).
function jhBuddyHead(place,size=30,mood='smile'){
  return '<span class="jh-buddy-head" aria-hidden="true" style="width:'+size+'px;height:'+size+'px">'+jhBuddy(place,Math.round(size*1.12),mood)+'</span>';
}
