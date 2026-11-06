// Official visitor guidance is matched to the exact place and city. The booking
// wallet, restaurant average spend and admission policies have separate sources.
const shHistoryGuide='https://www.shanghai.gov.cn/huangpu/index.html';
const shScienceNotice='https://whlyj.sh.gov.cn/wbzx/20260211/96b8e43e2d7c478895adfd26fcc27fbc.html';
const shMuseumWest='https://www.shanghaimuseum.cn/mu/frontend/pg/en/service/visit-west';
const regularHolidayHours='Holiday hours vary. Check the venue notice for this date.';
const outdoorID='No entry document is listed for the public walk. Indoor venues set their own ID rules.';
const outdoorBooking='Walk in for the public streets. Check separately for exhibitions and events.';
const attractionGuides=[
  {
    city:'Shanghai', ids:['amap_B0FFG7HY0E'], names:['The Bund','The Bund Architecture Exhibition Group','万国建筑博览群','外滩万国建筑博览群','外滩'],
    hours:'Open all day for the outdoor promenade.', price:'Free for the outdoor walk. Building interiors have separate admission.',
    reservation:outdoorBooking, documents:outdoorID,
    sources:[['Shanghai visitor guide','https://arabic.shanghai.gov.cn/cmsres/fb/fb4c67ebf9604322a8b3f6f74d7e1760/eec310a1555eb5a02a121cee2922800d.pdf'],['Admission guide','https://www.csair.com/h5/cn/guonei/shanghai2/1bluemtvttgit.shtml']]
  },
  {
    city:'Shanghai', preferListedHours:true, ids:['amap_B0FFF3LKUB'], names:['Rockbund','Rockbund Shanghai','洛克·外滩源','洛克外滩源'],
    hours:'Public streets. Shops, galleries and events keep individual hours.', price:'Free to walk through the outdoor district.',
    reservation:outdoorBooking, documents:outdoorID,
    sources:[['Shanghai city guide','https://english.shanghai.gov.cn/en-PlanANightOut/20231217/2215770d32a145e09b6e31fb3c7fdeef.html'],['District visitor guide','https://localshanghai.com/rockbund-shanghai-guide/']]
  },
  {
    city:'Shanghai', scopeOnly:true, ids:['amap_B0G0ZSX6EI'], names:['Huangpu River','黄浦江'],
    hours:'River access depends on the promenade or departure pier.', price:'Cruise fares depend on the boat and sailing selected.',
    reservation:'For a cruise, choose a departure pier and sailing to check availability.', documents:'Check the selected operator’s boarding requirements.',
    sources:[['Shanghai ferry and cruise guide','https://english.shanghai.gov.cn/en-Individuals-Transportation-PublicTransport/20260813/474fc35ff5a54d51aeeb68b2cb981088.html']]
  },
  {
    city:'Shanghai', names:['Yu Garden','Yuyuan Garden','豫园','上海豫园'],
    hours:'09:00–16:30 (last entry 16:00)', closedOn:1, holiday:true,
    price:date=>[4,5,6,9,10,11].includes(Number(date.slice(5,7)))?'CNY 40 per adult':'CNY 30 per adult',
    reservation:'Walk-up tickets are sold at the gates. Advance purchase is available.',
    documents:'Bring proof of age or student status for a concession. The guide does not specify ID for a full-price ticket.',
    sources:[['Yu Garden visitor guide','https://www.yugarden.com.cn/Page/WxyGarden/notice.html']]
  },
  {
    city:'Shanghai', names:['Shanghai History Museum','Shanghai Municipal History Museum','上海市历史博物馆','上海市历史博物馆(上海革命历史博物馆)'],
    hours:'09:00–17:00 (last entry 16:00)',closedOn:1,holiday:true,
    price:'Free general admission. Special exhibitions may charge separately.',reservation:'Individual visitors can walk in.',
    sources:[['Shanghai visitor guide',shHistoryGuide]]
  },
  {
    city:'Shanghai',names:['Shanghai Museum East','Shanghai Museum East Branch','Shanghai Museum (East Branch)','上海博物馆东馆','上海博物馆(东馆)'],
    hours:'10:00–18:00 (last entry 17:00)',closedOn:2,holiday:true,
    price:'Free general admission. Some special exhibitions require a separate ticket.',
    reservation:'Walk in for general admission. Reserve the Digital Gallery and Curio-City separately.',
    documents:'Bring your original valid ID. International visitors should bring their passport.',
    sources:[['Shanghai Museum East','https://www.shanghaimuseum.cn/mu/frontend/pg/en/service/visit-east'],['Shanghai visitor guide','https://www.shanghai.gov.cn/pdwl/index.html']]
  },
  {
    city:'Shanghai',names:["Shanghai Museum (People’s Square)","Shanghai Museum on People’s Square","Shanghai Museum (People’s Square Branch)","上海博物馆(人民广场馆)","上海博物馆人民广场馆"],
    from:'2026-07-09',until:'2027-11-14',hours:'Day session 09:00–17:00 (last entry 15:00). Evening hours depend on the ticketed session.',closedOn:1,holiday:true,
    price:'CNY 74–148 for single entry, depending on the exhibition ticket.',
    reservation:'Choose a dated session when buying a named ticket. On-site sales depend on remaining places.',
    documents:'Bring the original valid ID or passport used for the booking.',
    sources:[['Museum entry rules',shMuseumWest],['Exhibition ticket prices','https://english.shanghai.gov.cn/en-ArtExhibitions/20260512/bd3b39f2c36340b3b54b8094edb43a6d.html']]
  },
  {
    city:'Shanghai',names:['Rockbund Art Museum','上海外滩美术馆'],hours:'11:00–18:00 (last entry 17:30)',closedOn:1,
    dayHours:{2:'Members only, 12:00–18:00.'},price:'Free exhibition entry.',
    reservation:'Walk in Wednesday–Friday. On weekends and public holidays, book a priority slot or join the queue.',
    sources:[['Rockbund Art Museum','https://www.rockbundartmuseum.org/visit']]
  },
  {
    city:'Shanghai',names:['Shanghai Natural History Museum','上海自然博物馆','上海自然博物馆(上海科技馆分馆)'],
    from:'2026-03-01',hours:'09:00–17:00 (last entry 16:00)',closedOn:2,holiday:true,dayHours:{6:'09:00–20:00'},
    holidayHours:'09:00–20:00',price:'CNY 30 per adult.',reservation:'Book a named, timed ticket through the museum before entry.',
    documents:'Bring your original passport or the original ID used to book. Bring proof of eligibility for concessions.',
    sources:[['Museum visitor guide','https://www.snhm.org.cn/cgfw/cgzx.htm'],['Ticket and ID rules','https://nao.snhm.org.cn/foreign/cgfw/wssp.htm'],['Hours update',shScienceNotice],['Ticket prices','https://www.shanghai.gov.cn/nw17239/20260911/743ed95b8f23494d943ae0f3929b4491.html']]
  },
  {
    city:'Shanghai',names:['Shanghai Astronomy Museum','上海天文馆','上海天文馆(上海科技馆分馆)'],
    from:'2026-02-01',hours:'09:30–17:00 (last entry 16:00)',closedOn:1,holiday:true,dayHours:{6:'09:30–20:00'},holidayHours:'09:30–20:00',
    price:'CNY 30 per adult. Concessions are available.',reservation:'Reserve through the Shanghai Astronomy Museum ticketing mini program.',
    sources:[['Shanghai visitor guide','https://www.shanghai.gov.cn/pdwl/index.html'],['Extended hours',shScienceNotice]]
  },
  {
    city:'Singapore',names:['Supertree Grove','Gardens by the Bay – Supertree Grove'],
    hours:'05:00–02:00 the following morning',price:'Free at ground level. The Observatory and OCBC Skyway have separate tickets.',
    reservation:'Walk in for the outdoor grove.',documents:'The outdoor garden guide lists no entry document.',
    sources:[['Gardens by the Bay','https://www.gardensbythebay.com.sg/en/things-to-do/attractions/supertree-grove.html']]
  },
  {
    city:'Bangkok',names:['Wat Pho','Wat Phra Chetuphon Wimon Mangkhalaram Rajwaramahawihan','Wat Pho Courtyards & Reclining Buddha'],
    hours:'08:00–19:30',price:'THB 300 per international visitor. Children under 120 cm enter free.',
    sources:[['Wat Pho visitor guide','https://www.watpho.com/index.php/en/contact/plan']]
  }
];

function guideName(value) {
  return String(value||'').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
function attractionGuide(stop,event) {
  const labels=stop.source==='Amap' && stop.originalName ? [stop.originalName] : [stop.originalName,stop.name];
  const names=labels.filter(Boolean).map(guideName);
  const guide=attractionGuides.find(item=>item.city===event.city && (item.ids?.includes(stop.id)||item.names.some(name=>names.includes(guideName(name)))));
  if (!guide || (guide.from && event.date<guide.from) || (guide.until && event.date>guide.until)) return null;
  return guide;
}
// Shanghai public-holiday periods published in State Council notice 2025/32.
const cnHoliday2026=[['01-01','01-03'],['02-15','02-23'],['04-04','04-06'],['05-01','05-05'],['06-19','06-21'],['09-25','09-27'],['10-01','10-07']];
function guideHours(guide,date) {
  const weekday=new Date(date+'T12:00:00Z').getUTCDay();
  if (guide.holiday && date.startsWith('2026-') && cnHoliday2026.some(([a,b])=>date.slice(5)>=a && date.slice(5)<=b)) return guide.holidayHours||regularHolidayHours;
  if (guide.closedOn===weekday) return guide.holiday && !date.startsWith('2026-')?'Normally closed. Check the public-holiday schedule.':'Closed under the regular schedule.';
  return guide.dayHours?.[weekday] || guide.hours;
}

export {attractionGuide};
