// Desktop staff workspace: Today and Insights share one page format on wide screens:
// eyebrow + title header with actions on the right, a KPI row, then a main column and a side column.
// Phones keep the existing staff views.
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const sdOn=()=>!!wide?.matches&&!!me();
  const sdLongDate=(zone='Asia/Bangkok')=>new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
  const sdShortDate=(zone='Asia/Bangkok')=>new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'numeric',month:'short',year:'numeric'}).format(new Date());
  const sdClock=zone=>{try{return new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());}catch{return '';}};
  const sdBar=(value,max,tone)=>'<span class="sd-meter'+(tone?' is-'+tone:'')+'" aria-hidden="true"><i style="width:'+(max?Math.min(100,value/max*100):0).toFixed(1)+'%"></i></span>';
  const sdKpi=(label,value,note,extra,act)=>'<'+(act?'button type="button" '+act:'div')+' class="sd-kpi"><span class="sd-label">'+label+'</span><b>'+value+'</b>'+(extra||'')+'<small>'+note+'</small></'+(act?'button':'div')+'>';
  const sdHead=(kicker,title,right)=>'<div class="sd-card-head"><div>'+(kicker?'<span class="sd-kicker">'+kicker+'</span>':'')+'<h2>'+title+'</h2></div>'+(right||'')+'</div>';
  const sdLink=(label,act)=>'<button type="button" class="sd-link" '+act+'>'+label+ic('right',15)+'</button>';

  // Staff assistant counts, as in the compact assistant row.
  function sdAssistant(){
    if(typeof saScope!=='function')return {loaded:false,text:'Assistant unavailable',count:0};
    saScope();if(!sa.owner)return {loaded:false,text:'Staff sign in required',count:0};
    const rows=saRows(),opportunities=Number(sa.counts?.opportunities??rows.filter(t=>t.kind==='opportunity'&&saNeeds(t)).length),checks=Number(sa.counts?.sessionChecks??rows.filter(t=>t.kind==='session_attention').length),tracking=Number(sa.counts?.tracking??rows.filter(t=>t.status==='tracking').length);
    const parts=[opportunities?plural(opportunities,'opportunity','opportunities'):'',checks?checks+' session check'+(checks===1?'':'s'):''].filter(Boolean);
    const text=sa.loaded?(parts.length?parts.join('. ')+'.':tracking?'Watching '+plural(tracking,'published session')+'.':'Operations checked. Nothing needs review.'):sa.error?'Assistant needs a retry.':'Checking operations…';
    return {loaded:sa.loaded,text,count:opportunities+checks,opportunities};
  }
  const sdAfter=()=>{if(typeof saLoad==='function')void saLoad();};

  // Today
  function sdSessionRow(s){
    const e=EXPS[s.exp],b=soStats(s),ended=Date.parse(s.endsAt)<=Date.now(),live=Date.parse(s.startsAt)<=Date.now()&&!ended;
    const status=ended?['Ended','b-muted']:live?['In progress','b-ok']:['Upcoming','b-info'];
    const [start,end]=String(s.time||s.start||'').split(/\s*[–-]\s*/);
    const zone=s.timeZone||e.timeZone;
    return '<tr><td class="sd-time"><b>'+esc(start||'')+'</b>'+(end?'<small>to '+esc(end)+'</small>':'')+'</td>'+
      '<td><strong>'+esc(e.name)+'</strong><small>'+esc(e.city)+(zone?' · local time '+sdClock(zone):'')+'</small></td>'+
      '<td class="sd-num"><span class="sd-fill"><b>'+b.confirmed+' / '+s.cap+'</b>'+sdBar(b.confirmed,s.cap)+'</span></td>'+
      '<td class="sd-num"><b>'+b.checked+'</b><small> of '+b.confirmed+'</small></td>'+
      '<td>'+badge(status[0],status[1])+'</td>'+
      '<td class="sd-act"><button type="button" class="sd-row-btn" data-act="go" data-a="s-session" data-b="'+esc(s.id)+'">'+(ended?'Details':'Guest list')+'</button></td></tr>';
  }
  function sdOrderCard(o){
    const inf=orderInfo(o),b=staffBadge(o,inf),store=inf.stores.map(id=>STORES[id]?.name).filter(Boolean).join(', '),items=inf.lines.map(l=>l.p.name).join(', ');
    return '<button type="button" class="sd-order" data-act="go" data-a="s-order" data-b="'+esc(o.id)+'"><span class="sd-order-top"><b class="num">'+esc(o.id)+'</b>'+badge(b[0],b[1])+'</span><strong>'+esc([store,items].filter(Boolean).join(' · ')||o.guest||'Order')+'</strong><small>'+(o.method==='hotel'?'Hotel delivery':'International')+' · '+esc(addrLine(o))+'</small></button>';
  }
  const sdTodayPrior=V['s-today'];
  V['s-today']=function(){
    if(!sdOn())return sdTodayPrior.apply(this,arguments);
    const rows=soSlots().filter(s=>s.date===sfDateAtZone(s.timeZone)&&s.status!=='cancelled');
    const shown=rows.length?rows:soSlots().filter(s=>Date.parse(s.endsAt)>Date.now()&&s.status==='open').slice(0,5);
    const confirmed=sum(rows,s=>soStats(s).confirmed),checked=sum(rows,s=>soStats(s).checked);
    const open=ordersList().filter(isOpen),exceptions=ordersList().filter(isException),as=sdAssistant();
    const right='<div class="sd-head-actions"><span class="sd-live"><i></i>Live operations</span><span class="sd-pill">'+ic('calendar',15)+sdShortDate()+'</span><button type="button" class="sd-primary" data-act="go" data-a="s-plan">'+ic('plus',16)+'Plan a session</button></div>';
    const table=shown.length?'<div class="sd-table-wrap"><table class="sd-table"><thead><tr><th>Local time</th><th>Session · destination</th><th>Confirmed / seats</th><th>Checked in</th><th>Status</th><th aria-label="Action"></th></tr></thead><tbody>'+shown.slice(0,5).map(sdSessionRow).join('')+'</tbody></table></div>':'<p class="sd-empty">No sessions are scheduled.</p>';
    const body='<div class="content sd-page sd-today">'+
      '<div class="sd-kpis">'+
        sdKpi('Sessions today',rows.length,'Across all destinations','','data-act="tab" data-a="s-sessions"')+
        sdKpi('Guests checked in',checked+'<span> / '+confirmed+'</span>',confirmed?Math.round(checked/confirmed*100)+'% arrived':'No guests expected yet',sdBar(checked,confirmed),'data-act="go" data-a="s-bookings"')+
        sdKpi('Open orders',open.length,'Hotel & international delivery','','data-act="ubProductOrders"')+
        sdKpi('Order exceptions',exceptions.length,exceptions.length?'Needs action':'No action required','','data-act="ubProductOrders"')+
      '</div>'+
      '<div class="sd-grid">'+
        '<section class="sd-card sd-sessions">'+sdHead('Live operations',rows.length?'Today’s sessions':'Coming up',sdLink('View all '+soSlots().filter(s=>s.status!=='cancelled').length,'data-act="tab" data-a="s-sessions"'))+table+
          '<div class="sd-card-foot"><span>Showing '+Math.min(5,shown.length)+' of '+(rows.length||shown.length)+' sessions · all destinations</span><span>Check-in is recorded per guest</span></div></section>'+
        '<aside class="sd-side">'+
          '<section class="sd-card sd-assist"><span class="sd-kicker">'+ic('sparkle',14)+'Staff assistant</span><p>'+esc(as.text)+'</p><button type="button" class="sd-primary" data-act="go" data-a="s-assistant">'+(as.count?'Review opportunities':'Open assistant')+ic('right',15)+'</button></section>'+
          '<nav class="sd-card sd-links" aria-label="Staff shortcuts">'+
            '<button type="button" data-act="go" data-a="s-bookings"><span class="sd-ic">'+ic('ticket',19)+'</span><span><strong>Experience Bookings</strong><small>Booking ID, guests, dates & status</small></span>'+ic('right',17)+'</button>'+
            '<button type="button" data-act="go" data-a="s-insights"><span class="sd-ic">'+ic('chart',19)+'</span><span><strong>Staff Insights</strong><small>Performance & session planning</small></span>'+ic('right',17)+'</button>'+
          '</nav>'+
        '</aside>'+
      '</div>'+
      '<section class="sd-card sd-orders">'+sdHead('','Open orders <span class="sd-count">'+open.length+' awaiting fulfillment</span>',sdLink('Manage orders','data-act="ubProductOrders"'))+
        (open.length?'<div class="sd-order-grid">'+open.slice().reverse().slice(0,3).map(sdOrderCard).join('')+'</div>':'<p class="sd-empty">No open orders. New hotel and international orders appear here.</p>')+'</section>'+
    '</div>';
    return {bar:staffBar('Today',esc(me()?.name||'JourneyHub Staff')+' · '+sdLongDate(),{right}),tabs:true,body,after:sdAfter};
  };

  // Insights
  const sdRing=(value,max,tone,label,note)=>{const f=max?Math.min(1,value/max):0,r=52,c=2*Math.PI*r;return '<figure class="sd-ring is-'+tone+'"><svg viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="'+r+'"/><circle cx="64" cy="64" r="'+r+'" stroke-dasharray="'+(c*f).toFixed(1)+' '+c.toFixed(1)+'"/></svg><b>'+pct(value,max,0)+'</b><figcaption><strong>'+label+'</strong><small>'+note+'</small></figcaption></figure>';};
  const sdInsightsPrior=V['s-insights'];
  V['s-insights']=function(){
    if(!sdOn())return sdInsightsPrior.apply(this,arguments);
    if(typeof sfScope==='function')sfScope();
    const keys=state.insightsAct==='all'?['craft','silk','herbal']:[state.insightsAct];
    const M=metrics(keys),T=M.T,allM=metrics(['craft','silk','herbal']),tab=state.sdInsTab||'hist',as=sdAssistant();
    const chips=[['all','All 3'],['craft','Thai Craft Lab'],['silk','Silk'],['herbal','Herbal']];
    const right='<div class="sd-head-actions"><div class="sd-chips" role="group" aria-label="Activity">'+chips.map(c=>'<button type="button" class="sd-chip" data-act="insAct" data-a="'+c[0]+'" aria-pressed="'+(state.insightsAct===c[0])+'">'+c[1]+'</button>').join('')+'</div><span class="sd-pill">'+ic('calendar',15)+'Sep 2026</span></div>';
    const tabs='<nav class="sd-subtabs" aria-label="Insights views">'+[['hist','Historical performance'],['live','Live bookings'],['compare','Activity comparison']].map(([id,label])=>'<button type="button" data-act="sdInsTab" data-a="'+id+'"'+(tab===id?' aria-current="page"':'')+'>'+label+'</button>').join('')+'</nav>';
    const kpis='<div class="sd-kpis is-five">'+
      sdKpi('Receipts',fmt(T.rec),T.paid+' paid seats, after refunds')+
      '<div class="sd-kpi is-accent"><span class="sd-label">Contribution</span><b>'+fmt(T.con)+'</b><small>'+pct(T.con,T.rec)+' of receipts</small></div>'+
      sdKpi('Seats filled',pct(T.b,T.seats),T.b+' booked of '+T.seats,sdBar(T.b,T.seats))+
      sdKpi('Attendance',pct(T.a,T.paid),T.a+' of '+T.paid+' paid guests',sdBar(T.a,T.paid,'violet'))+
      sdKpi('Cancellations',pct(T.c,T.b),T.c+' of '+T.b+' bookings',sdBar(T.c,T.b,'warn'))+
    '</div>';
    const compare='<section class="sd-card sd-compare">'+sdHead('','Activity comparison',sdLink('View full comparison','data-act="go" data-a="s-compare"'))+
      '<div class="sd-table-wrap"><table class="sd-table"><thead><tr><th>Activity</th><th class="sd-num">Booked</th><th class="sd-num">Attended</th><th class="sd-num">Receipts</th><th class="sd-num">Contribution</th></tr></thead><tbody>'+
      allM.per.map(p=>'<tr class="'+(keys.includes(p.k)?'':'is-dim')+'"><td><strong>'+esc(p.name)+'</strong><small>'+fmt(p.price)+' / guest · '+p.seats/4+' seats</small></td><td class="sd-num">'+p.b+'</td><td class="sd-num">'+p.a+'</td><td class="sd-num">'+fmt(p.rec)+'</td><td class="sd-num sd-con"><b>'+fmt(p.con)+'</b><small>'+pct(p.con,p.rec,0)+'</small></td></tr>').join('')+
      '</tbody></table></div></section>';
    const assist='<section class="sd-card sd-assist"><span class="sd-kicker">'+ic('sparkle',14)+'Staff assistant</span><p>Turn insights into a session plan.</p><small class="sd-assist-note">'+esc(as.text)+' '+(as.count?'<button type="button" class="sd-inline" data-act="go" data-a="s-assistant">Review</button>':'')+'</small>'+
      '<div class="sd-assist-actions"><button type="button" class="sd-primary" data-act="go" data-a="s-plan">'+ic('plus',16)+'Plan a session</button><button type="button" class="sd-ghost" data-act="sdRules" aria-expanded="'+!!state.sdRules+'">'+(state.sdRules?'Hide rules':'View rules')+'</button></div>'+
      '<small class="sd-fine">'+ic('info',14)+'Approval by a different authorized Duty Manager publishes the session.</small></section>';
    let main;
    if(tab==='live'){
      main='<div class="sd-grid"><div class="sd-main">'+(upcomingHtml(keys).replace('class="card stack-12"','class="sd-card sd-upcoming stack-12"')||'<section class="sd-card"><p class="sd-empty">No sessions in the next 7 days for this activity.</p></section>')+'</div><aside class="sd-side">'+assist+'</aside></div>';
    }else{
      main='<div class="sd-grid">'+
        '<section class="sd-card sd-chart" data-region="chart">'+chartHtml(M)+'</section>'+
        '<aside class="sd-side"><section class="sd-card sd-capacity">'+sdHead('','Capacity & attendance')+'<div class="sd-rings">'+sdRing(T.b,T.seats,'lime','Seats filled',T.b+' of '+T.seats+' seats')+sdRing(T.a,T.paid,'violet','Attendance',T.a+' of '+T.paid+' paid')+'</div><div class="sd-card-foot"><span>Cancellations</span><b>'+T.c+' of '+T.b+' · '+pct(T.c,T.b)+'</b></div></section></aside>'+
      '</div>'+
      '<div class="sd-grid">'+compare+'<aside class="sd-side">'+assist+'</aside></div>';
    }
    const rules=state.sdRules?opsHtml().replace('class="card stack-12"','class="sd-card sd-rules stack-12"'):'';
    const body='<div class="content sd-page sd-insights">'+tabs+kpis+main+rules+
      '<p class="sd-note">'+ic('info',14)+'<span><b>Receipts</b> = paid seats × price, cancellations refunded. <b>Contribution</b> = receipts − host payout (50%) − materials per attended guest.</span></p></div>';
    return {bar:staffBar('Insights','Historical sample · September 2026',{right}),tabs:true,body,after:sdAfter};
  };
  A.sdInsTab=id=>{if(id==='compare'){go('s-compare');return;}state.sdInsTab=id==='live'?'live':'hist';render();};
  A.sdRules=()=>{state.sdRules=!state.sdRules;render();};
})();
