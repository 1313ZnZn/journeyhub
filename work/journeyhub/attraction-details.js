// Resolve POI hours for the visit's civil date at the destination. Never use
// the browser's local weekday or carry the provider's "today" into another day.
const visitWeekdays=['sun','mon','tue','wed','thu','fri','sat'];
const dayWord='(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Wed|Thu|Fri|Sat)';
const dayPrefix=new RegExp('^'+dayWord+'(?:\\s*(?:[–—-]|to)\\s*'+dayWord+')?(?:\\s*:\\s*|\\s+)(.+)$','i');
function providerVisitHours(stop,date) {
  const weekday=new Date(date+'T12:00:00Z').getUTCDay();
  const dated=[],regular=[];
  for (const line of (stop.openingHours||[])) {
    const value=cvEnglish(line);
    if (!value) continue;
    // Split only independent rules so a bracketed holiday exception stays
    // attached to its hours.
    for (const rule of value.split(/;\s*(?=(?:\d{4}-\d{2}-\d{2}|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Daily)\b)/i)) {
      const period=rule.match(/^(\d{4}-\d\d-\d\d)(?:\s*[–—~\-]\s*(\d{4}-\d\d-\d\d))?\s*[:：]?\s+(.+)$/);
      if (period) {
        if (date>=period[1] && date<=(period[2]||period[1])) dated.push(period[3]);
        continue;
      }
      const day=rule.match(dayPrefix);
      if (day) {
        const first=visitWeekdays.indexOf(day[1].slice(0,3).toLowerCase());
        const last=day[2]?visitWeekdays.indexOf(day[2].slice(0,3).toLowerCase()):first;
        if ((weekday-first+7)%7 <= (last-first+7)%7) regular.push(day[3]);
      } else if (/^(daily\b|every day\b|open 24 hours$|24 hours$|all day$)/i.test(rule)) {
        regular.push(rule.replace(/^(daily|every day)\s*:?\s*/i,''));
      }
    }
  }
  const unique=items=>[...new Set(items.filter(Boolean))].join(' / ');
  const today=stop.venueDetails?.hoursDate===date && cvEnglish(stop.venueDetails.todayHours);
  return {specific:unique(dated)||today||'',regular:unique(regular)};
}
function cvAttractionHTML(stop,event,status) {
  const guide=attractionGuide(stop,event);
  const provider=providerVisitHours(stop,event.date);
  const dateText=calFormat(event.date,{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  const scopedPlace=guide?.scopeOnly;
  const listedHours=scopedPlace?'':provider.specific || (guide?.preferListedHours && provider.regular);
  const hours=listedHours || (guide && guideHours(guide,event.date)) || provider.regular;
  const hoursSource=listedHours || (!guide && provider.regular) ? stop.source : '';
  const verified=stop.visitInfo?.verified===true && cvURL(stop.visitInfo.sourceURL)?stop.visitInfo:null;
  const price=guide?.price;
  const ticket=typeof price==='function'?price(event.date):price || (verified?.admission==='free'?'Free admission':cvEnglish(verified?.admissionNote));
  let booking=guide?.reservation || '';
  if (!booking && verified?.reservationRequired===true) booking='Advance reservation required.';
  if (!booking && verified?.reservationRequired===false) booking='Walk-in entry is available.';
  const docs=Array.isArray(verified?.documents)?verified.documents.map(cvEnglish).filter(Boolean):[];
  const documents=guide?.documents || docs.join(' · ');
  const checking=typeof thSnapshotUpdating==='function' && thSnapshotUpdating(event.id);
  const links=guide?.sources || [];
  const sourceLinks=links.map(([name,href])=>'<a target="_blank" rel="noopener noreferrer" href="'+esc(href)+'">'+esc(name)+' ↗</a>').join(' · ');
  const rows=[
    ['Opening hours',hours || (checking?'Updating hours…':'Hours for this date are unconfirmed.')],
    ['Ticket price',ticket || 'Price unconfirmed. Check the venue before buying.'],
    ['Advance reservation',booking || 'Advance booking requirements are unconfirmed.'],
    ['ID to bring',documents || 'Entry ID requirements are unconfirmed.']
  ];
  const research=typeof cvSavedResearch==='function'?cvSavedResearch(event,stop.id):null;
  const keys=['hours','price','reservation','documents'];
  const found=research?.fields||{};
  const details=rows.map(([label,value],i)=>{
    const fact=found[keys[i]],url=cvURL(fact?.url),text=cvEnglish(fact?.text);
    return '<div><dt>'+label+'</dt><dd>'+(url&&text?esc(text)+' <a class="cv-citation" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Official source ↗</a>':esc(value))+'</dd></div>';
  }).join('');
  const source=hoursSource&&!found.hours?'<p class="cv-guide-note">'+esc(hoursSource)+' hours · Destination local time</p>':'';
  const updated=research?.checkedAt?new Date(research.checkedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'';
  const researchNote=research?.state==='checking'||research?.state==='queued'?'Checking official visitor guidance…':research?.state==='unconfirmed'?'Official details could not be confirmed for this visit.':updated&&Object.keys(found).length?'Official sources checked '+updated:'';
  const checked=(researchNote?'<p class="cv-guide-note" role="status">'+esc(researchNote)+'</p>':'')+(sourceLinks&&keys.some(k=>!found[k])?'<footer>'+sourceLinks+'<small>Reference guide checked 5 Nov 2026</small></footer>':'');
  const seats=status.availability?'<p class="cv-guide-note">'+esc(status.availability)+' · JourneyHub session</p>':'';
  return '<section class="cv-attraction"><header><h3>Visit details</h3><small>'+esc(dateText)+'</small></header><dl>'+details+'</dl>'+source+seats+checked+'</section>';
}
