// Translate common Amap schedule terms without dropping exceptions or
// calculating whether a venue will be open on a future date.
const weekdays = {一:'Mon',二:'Tue',三:'Wed',四:'Thu',五:'Fri',六:'Sat',日:'Sun',天:'Sun'};
const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const terms = [
  ['法定节假日除外','except public holidays'], ['法定节假日','public holidays'],
  ['节假日除外','except holidays'], ['延时服务时间','extended hours'],
  ['次日','next day '], ['最后入场','last admission '], ['停止入场','last admission '],
  ['停止入馆','last admission '], ['停止售票','ticket sales end '],
  ['全天开放','open 24 hours'], ['全天营业','open 24 hours'], ['24小时','24 hours'],
  ['全天','all day'], ['全年','year-round '], ['每天','daily '], ['每日','daily '],
  ['工作日','weekdays '], ['周末','weekends '], ['营业时间','hours '],
  ['开放时间','hours '], ['不开放','closed'], ['休息','closed'], ['休馆','closed'],
  ['闭馆','closed'], ['暂停营业','temporarily closed'], ['至','–'], ['到','–'], ['、',', ']
];
function englishHours(value) {
  if (typeof value !== 'string' || value.length > 1200) return '';
  let line = value.normalize('NFKC').trim()
    .replace(/(?:星期|礼拜|周)([一二三四五六日天])/g, (_,day)=>weekdays[day])
    .replace(/(\d{1,2})月(\d{1,2})日/g, (match,month,day)=>monthNames[month-1] ? monthNames[month-1]+' '+day : match);
  for (const [from,to] of terms) line = line.replaceAll(from,to);
  if (/\p{Script=Han}|[<>\x00-\x08]/u.test(line) || !/(\d{1,2}:\d{2}|24 hours|all day|closed)/i.test(line)) return '';
  return line.replace(/\s+/g,' ').trim();
}
function positiveNumber(value, max) {
  if (!/^\d+(\.\d+)?$/.test(String(value ?? ''))) return null;
  const number = Number(value);
  return number > 0 && number <= max ? number : null;
}
function dailyHours(value, hasWeeklySchedule) {
  const text=englishHours(value);
  if (!text) return '';
  const ranges=text.split(/\s+/);
  if (!ranges.every(range=>/^\d{1,2}:\d{2}[-–~]\d{1,2}:\d{2}$/.test(range))) return text;
  const distinct=[...new Set(ranges)];
  // Some records also put seasonal hours in the "today" field, without their
  // dates. Prefer the dated weekly rules to overlapping opening intervals.
  const windows=distinct.map(range=>range.split(/[-–~]/).map(clock=>{
    const [hour,minute]=clock.split(':').map(Number);
    return hour*60+minute;
  })).sort((a,b)=>a[0]-b[0]);
  if (hasWeeklySchedule && windows.some(([start],i)=>i>0 && start<windows[i-1][1])) return '';
  return distinct.join(', ');
}
export function amapBusiness(raw, now = new Date()) {
  const data = raw?.business || raw?.biz_ext || {};
  const contact = data.tel || raw?.tel;
  const weekly = englishHours(data.opentime_week);
  const today = dailyHours(data.opentime_today, Boolean(weekly));
  const phone = typeof contact === 'string'
    ? contact.split(/[;；,，|]/).map(number=>number.trim()).find(number=>/^\+?[\d() -]{5,24}$/.test(number))
    : null;
  return {
    openingHours: weekly ? weekly.split(/(?<=\d{2}:\d{2})(?:\s+|;\s*)(?=\d{4}-\d{2}-\d{2})/) : [],
    venueDetails: {
      todayHours: today || null,
      hoursDate: today ? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now) : null,
      phone: phone || null,
      rating: positiveNumber(data.rating,5),
      averageSpendCny: positiveNumber(data.cost,1000000)
    }
  };
}
