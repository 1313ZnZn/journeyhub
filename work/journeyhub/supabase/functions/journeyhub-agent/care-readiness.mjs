// Evidence-backed checks. Missing data remains unknown; a simulated reservation
// never becomes a supplier confirmation. No model output decides payment state.
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const safeURL=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const clean=(v,n=400)=>typeof v==='string'?v.slice(0,n):'';
export const outdoors=kind=>/park|garden|beach|hiking|zoo|outdoor|promenade/i.test(kind||'');
export function savedPlaces(row,extra={}){
 const places=Object.fromEntries((row.places||[]).filter(p=>p?.id).map(p=>[p.id,p]));
 // Keep saved English names when a map provider returns a local-language name.
 for(const [id,p]of Object.entries(extra))places[id]={...p,...(places[id]||{}),id};
 return places;
}
export function visitDate(row,stop){return stop.visitDate||new Date(Date.parse(row.input.date+'T12:00:00Z')+((stop.dayIndex||1)-1)*86400000).toISOString().slice(0,10);}
export function factFor(row,stop){return(row.visitFacts||[]).find(f=>f.id===stop.id&&f.date===visitDate(row,stop))||null;}
export function hoursAssessment(fact,start,end){
 const field=fact?.fields?.hours,text=clean(field?.text),url=safeURL(field?.url);
 if(!text||!url||!['regular','dated'].includes(field.basis))return{status:'unknown',text:'Opening hours have not been verified for this date.'};
 const weekday=new Date(fact.date+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long'}).toLowerCase();
 const dayPattern=/\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\b/gi;
 const days=text.match(dayPattern)||[],conditional=/except|unless|holiday|may |might |occasionally|temporarily/i.test(text);
 const closure=text.match(/(?:^|[.;])\s*closed\s+(?:on\s+)?([^.;]+)/i);
 const closedDays=closure?.[1]?.match(dayPattern)||[];
 const fullDay=/^closed(?:[.!]|$)|^closed\s+(?:all day|for the day|on this date|for this date|today)(?:[.!]|$)/i.test(text);
 const weeklyClosure=closure&&/^(?:every\s+|all day on\s+)?(?:mon|tue|wed|thu|fri|sat|sun)/i.test(closure[1]);
 const isClosed=!conditional&&((weeklyClosure&&closedDays.some(d=>d.slice(0,3).toLowerCase()===weekday.slice(0,3)))||(fullDay&&!days.length));
 if(isClosed)return{status:'closed',text,url,basis:field.basis};
 // A day-specific schedule may contain multiple windows or a trailing closure.
 // Its English text is evidence to display, not a safe machine timetable.
 if(days.length||/\bclosed\b/i.test(text)||conditional)return{status:'unknown',text,url,basis:field.basis};
 if(/open (?:all day|24 hours)|24-hour|\b24\s*\/\s*7\b/i.test(text))return{status:'open',text,url,basis:field.basis,windows:[[0,1440]]};
 // Avoid treating a date range, ambiguous notice, or last-entry time as a window.
 const windows=[...text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\s*[–—-]\s*([01]?\d|2[0-3]):([0-5]\d)\b/g)].map(m=>[+m[1]*60+ +m[2],+m[3]*60+ +m[4]]).filter(([a,b])=>b>a);
 if(!windows.length||/holiday|exception|varies|depend|check|special|following morning/i.test(text))return{status:'unknown',text,url,basis:field.basis};
 const a=minute(start),b=minute(end),fits=windows.some(([lo,hi])=>a>=lo&&b<=hi);
 const last=text.match(/last (?:entry|admission)\s*(?:at|is|:)?\s*([01]?\d|2[0-3]):([0-5]\d)/i);
 const lastEntry=last?+last[1]*60+ +last[2]:null;
 return{status:fits&&(lastEntry===null||a<lastEntry)?'open':'conflict',text,url,basis:field.basis,windows,lastEntry};
}
export function canonicalBooking(row,id){
 return(row.canonicalBookings||[]).find(b=>b.stopId===id&&['confirmed','checked_in'].includes(b.status))||
  (row.canonicalBookings||[]).find(b=>b.stopId===id)||null;
}
export function protectedStopIds(row){return new Set((row.canonicalBookings||[]).filter(b=>['confirmed','checked_in'].includes(b.status)).map(b=>b.stopId));}
export function assessCare(row,stops,now=new Date()){
 const tasks=[];
 for(const s of stops){
  const fact=factFor(row,s),hours=hoursAssessment(fact,s.start,s.end),b=canonicalBooking(row,s.id),check=(row.checks||[]).find(c=>c.id===s.id);
  const messages=[];let status='ready',action='details',sourceURL=hours.url||s.sourceURL||'';
  const attention=(message,nextAction='details')=>{status='attention';messages.push(message);action=nextAction;};
  if(check?.status==='closed'||hours.status==='closed')attention('A closure is reported for this visit. Review the plan.','review');
  else if(hours.status==='conflict')attention('The planned time falls outside the published opening window.','review');
  else if(hours.status==='unknown'){status='unknown';messages.push(hours.text);}
  if(check?.reason==='fetch_failed'&&status!=='attention'){status='unknown';messages.push('Live place refresh unavailable.');}
  if(b){
   if(['confirmed','checked_in'].includes(b.status))messages.push((b.simulated?'Simulated reservation verified':'JourneyHub reservation verified')+' · '+b.bookingId+(b.paymentStatus==='simulated_paid'?' · Virtual payment recorded.':'.'));
   else if(b.status==='cancelled')attention('Reservation cancelled; ticket is invalid.','booking');
   else attention('The reservation needs follow-up.','booking');
  }else{
   const policy=fact?.fields?.reservation;
   const requirement=safeURL(policy?.url)&&['regular','dated'].includes(policy?.basis)?clean(policy?.text):'';
   const walkIn=/\bno reservations? (?:is |are )?(?:required|needed)|\breservations? (?:is |are )?not required|\bwalk[ -]?(?:in|up)\b|\boptional\b|\bwithout (?:a )?(?:prior |advance )?reservation\b/i.test(requirement);
   if(requirement&&/\b(required|must|mandatory|book a|reserve through|named,? timed)\b/i.test(requirement)&&!/not required|no reservation|optional/i.test(requirement))attention('Advance booking is required; no JourneyHub reservation is recorded.','booking');
   else if(row.quote?.items?.some(q=>q.stopId===s.id&&q.status!=='already_booked'&&q.totalMinor>0))attention('Review the quote and approve virtual payment.','booking');
   else if(!walkIn){if(status==='ready')status='unknown';messages.push('Booking requirements still need verification.');}
   else if(status==='ready')messages.push('Published hours fit the planned visit.');
  }
  const doc=clean(fact?.fields?.documents?.text,220);
  if(doc&&/passport|identification|identity|\bid\b/i.test(doc)&&!/no (?:entry |identity )?document|not required/i.test(doc))messages.push(doc);
  const weather=(row.checks||[]).find(c=>c.id==='__weather__')?.forecast;
  const fresh=weather&&Date.parse(weather.expiresAt)>now.getTime();
  const day=fresh?weather.days?.find(d=>d.date===visitDate(row,s)):null;
  if(day&&outdoors(s.kind)&&['rain','storm','snow','sleet'].includes(day.icon))attention(day.condition+' forecast for this day; review this outdoor visit.','review');
  else if(outdoors(s.kind)&&!day&&Date.parse(s.endsAt)>now.getTime()){
   if(status==='ready')status='unknown';
   messages.push(weather&&!fresh?'Forecast refresh pending.':'A forecast is not available for this date yet.');
   if(status!=='attention')action='check';
  }
  tasks.push({id:'stop:'+s.id,stopId:s.id,dayIndex:s.dayIndex,title:s.name,status,detail:messages.join(' '),action,sourceURL:safeURL(sourceURL),bookingId:b?.bookingId||null,simulated:!!b?.simulated,checkedAt:fact?.checkedAt||row.checkedAt||null});
 }
 const quote=row.quote;
 if(quote&&quote.budgetCnyMinor!=null&&quote.itineraryTotalMinor>quote.budgetCnyMinor)tasks.push({id:'budget',title:'Budget needs review',status:'attention',detail:'The current virtual quote exceeds your trip budget. Review it before approving payment.',action:'booking'});
 return {total:tasks.length,ready:tasks.filter(t=>t.status==='ready').length,attention:tasks.filter(t=>t.status==='attention').length,unknown:tasks.filter(t=>t.status==='unknown').length,checking:!row.checkedAt,checkedAt:row.checkedAt||null,tasks};
}
