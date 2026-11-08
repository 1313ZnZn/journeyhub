/* Pip, the trip companion (desktop). One companion and one conversation per trip, docked on the
   right through Idea → Choose → Plan → Go. Pip reacts to what happens on the page (searching,
   dealing cards into piles, planning, problems) and offers the next step; in the Calendar its
   message box talks to the trip agent. The dock lives outside #app, so page redraws never
   rebuild it; conversations are kept in this browser, keyed by the trip's saved search. */
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const calm=window.matchMedia?.('(prefers-reduced-motion:reduce)');
  const STAGES=[['💭','Idea'],['🃏','Choose'],['🗺️','Plan'],['🎒','Go']];
  const ROUTE_STAGE={journey:0,'place-search':0,'ai-picks':1,'place-plan':2,orders:3};
  let openPref=true;try{openPref=localStorage.getItem('jh-pip-open')!=='0';}catch{}
  let dock=null,toggle=null,last={key:'',stage:-1,thread:'',live:'',chips:'',head:''},peekTimer=null,typingTimer=null;

  const stageOf=()=>ROUTE_STAGE[state.route]??-1;
  const visible=()=>!!wide?.matches&&state.role==='traveler'&&!!(typeof jhUser!=='undefined'&&jhUser)&&stageOf()>=0;
  // Pip is the companion whenever it is available, open or tucked away.
  window.jhPipShowing=()=>visible();
  const live=()=>typeof pd!=='undefined'&&pd.mode;
  const placeOf=id=>live()?pd.places.find(p=>p.id===id):null;

  // The trip this conversation belongs to.
  function tripKey(){
    if(state.route==='orders'){
      const t=window.jhCalendarAgent?.target?.();if(!t)return null;
      if(t.act==='tchStart')return t.a==='history'?t.b:null;
      const trip=typeof tc!=='undefined'?tc.trips?.find(x=>x.id===t.a):null;
      return trip?.sourceType==='history'?trip.sourceId:'care:'+t.a;
    }
    if(live())return pd.historyId||'search:'+(pd.requestId||'new');
    return 'idea';
  }
  const storeKey=key=>'jh-pip:'+(jhUser?.id||'guest')+':'+key;
  function load(key){if(!key)return [];try{const v=JSON.parse(localStorage.getItem(storeKey(key))||'[]');return Array.isArray(v)?v:[];}catch{return [];}}
  function save(key,msgs){if(!key)return;try{localStorage.setItem(storeKey(key),JSON.stringify(msgs.slice(-60)));}catch{}}
  // A search gets its saved-search ID a moment later; keep the conversation going under it.
  function migrate(){
    if(!live()||!pd.historyId||!pd.requestId)return;
    const from=storeKey('search:'+pd.requestId);let old=null;try{old=localStorage.getItem(from);}catch{}
    if(!old)return;
    const merged=[...JSON.parse(old),...load(pd.historyId)];save(pd.historyId,merged);try{localStorage.removeItem(from);}catch{}
  }
  function say(from,text,extra={},key=tripKey()){
    if(!key)return;
    const msgs=load(key),msg={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),from,text,at:Date.now(),...extra};
    // Quick reactions replace the previous reaction instead of piling up.
    if(extra.kind==='react'&&msgs.at(-1)?.kind==='react')msgs.pop();
    msgs.push(msg);save(key,msgs);
    if(from==='pip'&&!calm?.matches){msg.typing=true;clearTimeout(typingTimer);typingTimer=setTimeout(sync,650);}
    if(from==='pip'&&!openPref)peek(text);
    return msg;
  }
  const once=(key,marker,fn)=>{if(!key)return;const msgs=load(key);if(msgs.some(m=>m.marker===marker))return;fn(marker);};

  // Light formatting: **bold** only; everything else is escaped.
  const fmtText=t=>esc(String(t||'')).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
  const avatar=(cls='')=>typeof tchAvatar==='function'?tchAvatar('pip-av '+cls):'';
  const heads=ids=>(ids||[]).map(id=>placeOf(id)||{id,name:''}).filter(p=>p.name).slice(0,6).map(p=>typeof jhBuddyHead==='function'?jhBuddyHead(p,26):'').join('');
  function messageHTML(m,i,all){
    if(m.from==='me')return '<div class="pip-msg is-me"><div class="pip-bub">'+fmtText(m.text)+'</div></div>';
    const typing=m.typing&&Date.now()-m.at<600&&i===all.length-1;
    const showAv=all[i-1]?.from!=='pip';
    return '<div class="pip-msg'+(m.kind==='react'?' is-react':'')+'">'+(showAv?avatar('is-mini'):'<span class="pip-av-gap"></span>')+'<div class="pip-bub">'+(typing?'<span class="pip-typing" aria-label="Pip is typing"><i></i><i></i><i></i></span>':fmtText(m.text)+(m.heads?.length?'<span class="pip-heads">'+heads(m.heads)+'</span>':''))+'</div></div>';
  }

  // Live cards: what is happening now (not stored).
  function liveCard(stage){
    if(stage<=1&&live()&&pd.busy&&pd.phase==='search'){
      const task=pd.plannerTask||(typeof ptu!=='undefined'?ptu.task:null),steps=typeof ptuSteps==='function'&&task?ptuSteps(task):[];
      const found=pd.places.length;
      return '<div class="pip-card pip-scout">'+avatar('is-scout')+'<div class="pip-card-body"><strong>Scouting '+esc(pd.input?.city||'the city')+'…</strong><div class="pip-bar"><i style="width:'+Math.min(95,20+steps.length*18)+'%"></i></div>'+(steps.length?'<small>'+esc(steps.at(-1).summary)+'</small>':'<small>Looking for places that match what you said.</small>')+(found?'<span class="pip-heads">'+heads(pd.places.map(p=>p.id))+'</span>':'')+'</div></div>';
    }
    if(stage<=2&&live()&&pd.busy&&pd.phase==='plan')return '<div class="pip-card pip-scout">'+avatar('is-scout')+'<div class="pip-card-body"><strong>Planning your days…</strong><div class="pip-bar is-indet"><i></i></div><small>Fitting your Must go places, travel time and opening hours.</small></div></div>';
    const fix=(stage===1||stage===2)&&typeof window.jhPlanFixCard==='function'?window.jhPlanFixCard():'';
    if(fix)return '<div class="pip-card pip-fix">'+fix+'</div>';
    if(stage===1&&live()&&!pd.busy){
      const maybe=typeof window.jhFanMaybe==='function'?window.jhFanMaybe().length:0,must=pd.wanted.length,cap=typeof jhPickCap==='function'?jhPickCap():8;
      return '<div class="pip-card pip-piles"><div class="pip-pile"><span>🧳</span><b>'+must+'</b><small>of '+cap+' Must go</small></div><div class="pip-pile"><span>🤔</span><b>'+maybe+'</b><small>Maybe</small></div><div class="pip-pile"><span>🙅</span><b>'+pd.skipped.length+'</b><small>Not this time</small></div></div>';
    }
    if(stage===3){
      const t=window.jhCalendarAgent?.target?.();
      if(!t)return '<div class="pip-card"><small>Pick a day with a trip in the calendar and I’ll help you adjust it.</small></div>';
    }
    return '';
  }
  function chipsFor(stage){
    const chip=(act,a,icon,label,primary)=>'<button type="button" class="pip-chip'+(primary?' is-primary':'')+'" data-act="'+act+'"'+(a!=null?' data-a="'+esc(String(a))+'"':'')+'>'+icon+' '+esc(label)+'</button>';
    if(stage===0&&!(live()&&pd.busy)){
      const em={food:'🍜',globe:'🏛️',sun:'🌿'},ideas=typeof window.jhHomeIdeas==='function'?window.jhHomeIdeas():[],short={food:['🍜','Eat like a local'],globe:['🏛️','Culture & art'],sun:['🌿','Relaxed outdoors']};
      if(centreRoute())return ideas.map((x,i)=>chip('pipIdea',i,(short[x.icon]||['✨'])[0],(short[x.icon]||[0,'An idea'])[1])).join('')+chip('pipSurprise',null,'✨','Just plan it for me');
      return '<span class="pip-chips-label">Not sure where to start? Tap one</span>'+ideas.map((x,i)=>'<button type="button" class="pip-idea" data-act="pipIdea" data-a="'+i+'"><span aria-hidden="true">'+(em[x.icon]||'✨')+'</span>'+esc(x.text)+'</button>').join('')+chip('pipSurprise',null,'✨','Just plan it for me');
    }
    if(stage===1&&live()&&!pd.busy){const n=pd.wanted.length;return (n?chip('pdFinish',null,'✨','Plan '+plural(n,'place'),true):'')+(pd.undo.length?chip('pdUndo',null,'↩️','Undo'):'');}
    if(stage===2&&live()&&pd.plan&&!pd.busy)return chip('tuTab','itinerary','🗓️','Open the timetable')+(pd.sample?'':chip('tcConfirm',null,'🎒','Create my trip',true));
    if(stage===3&&window.jhCalendarAgent?.target?.())return window.jhCalendarAgent.prompts().map((p,i)=>chip('pipAsk',i,{clock:'🕘',map:'🧭',food:'🍜',leaf:'🌿',wallet:'💸'}[p.icon]||'✨',p.label)).join('');
    return '';
  }
  function composerFor(stage){
    if(stage===0&&!(live()&&pd.busy)){const i=ag.prefs||{};return {ph:'What would you love on this trip'+(i.city?' to '+i.city:'')+'?',act:'idea'};}
    if(stage===3&&window.jhCalendarAgent?.target?.())return {ph:'Ask Pip to change '+(window.jhCalendarAgent.target().day||'this day')+'…',act:'calendar'};
    return null;
  }
  function headLine(){
    const i=live()?pd.input:null;
    if(state.route==='orders')return 'Your trip companion';
    if(i?.city)return esc(i.city)+' · '+(Number(i.days)||1)+' day'+(Number(i.days)>1?'s':'')+(i.date?' · '+esc(typeof agDate==='function'?agDate(i.date):i.date):'');
    return 'Your trip companion';
  }

  // Pip notices what happens on the page.
  function notice(stage,key){
    if(!key)return;
    if(live()&&pd.places.length&&!pd.busy&&stage===1)once(key,'found',m=>say('pip','I found **'+plural(pd.places.length,'place')+'** in '+(pd.input?.city||'the city')+' 🎉 Deal each card: **Must go**, **Maybe**, or **Not this time**. Drag it, or press 1 · 2 · 3.',{marker:m,heads:pd.places.slice(0,5).map(p=>p.id)},key));
    if(live()&&pd.plan&&stage===2){
      const e=pd.plan.estimate,cost=e&&Number.isFinite(e.totalMinor)?' · est. '+(e.currency||'CNY')+' '+Math.round(e.totalMinor/100):'';
      once(key,'plan:'+(pd.plan.stops||[]).map(s=>s.id).join(','),m=>say('pip','Your **'+plural(Number(pd.plan.days)||1,'day')+'** are ready 🗺️ '+plural((pd.plan.stops||[]).length,'stop')+cost+'. Have a look at the timetable — drag things around if you like — then create your trip.',{marker:m,heads:(pd.plan.stops||[]).map(s=>s.id)},key));
    }
    if(live()&&pd.error&&!pd.busy&&(stage===1||stage===2))once(key,'err:'+pd.error,m=>{say('pip','Hmm, that didn’t quite fit 🤔 Here’s what we can do 👇',{marker:m},key);
      // A problem needs the traveler: bring Pip out if it was tucked away.
      if(!openPref){openPref=true;try{localStorage.setItem('jh-pip-open','1');}catch{}}});
  }
  const PILE_LINES={
    want:[n=>'**'+n+'** is in! 🧳',n=>'Nice — **'+n+'** goes to Must go ✨',n=>'**'+n+'** joins the trip 🎉'],
    maybe:[n=>'**'+n+'** goes to Maybe 🤔 We can decide later.',n=>'Not sure about **'+n+'**? It waits in Maybe.'],
    skip:[n=>'No **'+n+'** this time 👋',n=>'Skipping **'+n+'** — more for the others 🙂'],
    deck:[n=>'**'+n+'** is back in the cards 🃏']
  };
  document.addEventListener('jh:pile',e=>{
    if(!window.jhPipShowing()||!live())return;
    const {id,pile}=e.detail||{},p=placeOf(id);if(!p||!PILE_LINES[pile])return;
    const lines=PILE_LINES[pile],line=lines[(jhBuddyHash?.(id)||0)%lines.length](p.name);
    let extra='';
    if(pile==='want'&&typeof jhPickCap==='function'&&pd.wanted.length>=jhPickCap())extra=' That fills your **Must go** — press **Plan** when you’re ready.';
    say('pip',line+extra,{kind:'react',heads:[id]});sync();
  });

  // Rendering the dock (outside #app).
  function ensure(){
    if(dock)return;
    document.body.insertAdjacentHTML('beforeend','<aside class="pip" aria-label="Pip, your trip companion" hidden><header class="pip-head">'+avatar('is-head')+'<div><strong>Pip</strong><small data-pip-sub></small></div><button type="button" class="pip-min" data-pip-toggle aria-label="Hide Pip">'+ic('right',16)+'</button></header><div class="pip-steps" data-pip-steps></div><div class="pip-hello" data-pip-hello>'+avatar('is-hello')+'<h1>Where shall we go?</h1><p>Tell me what you love — I’ll scout places, help you choose and plan the days.</p></div><div class="pip-thread" data-pip-thread role="log" aria-live="polite"></div><div class="pip-live" data-pip-live></div><div class="pip-chips" data-pip-chips></div><div class="pip-trip" data-pip-trip></div><form class="pip-composer" data-pip-form hidden><textarea rows="1" maxlength="1200" data-pip-input aria-label="Message Pip"></textarea><button type="submit" class="pip-send" aria-label="Send">'+ic('right',18)+'</button></form></aside>'+
      '<button type="button" class="pip-fab" data-pip-toggle hidden aria-label="Show Pip">'+avatar('is-fab')+'<span class="pip-peek" data-pip-peek hidden></span><i class="pip-dot" hidden></i></button>');
    dock=document.body.querySelector('aside.pip');toggle=document.body.querySelector('.pip-fab');
  }
  // On the AI Journey page Pip is the main conversation, in the centre; elsewhere it docks on
  // the right. Moving between the two animates from one place to the other.
  const centreRoute=()=>state.route==='journey';
  function place(centre){
    const was=dock.classList.contains('is-center');
    if(was===centre)return;
    const shown=!dock.hidden,before=shown?dock.getBoundingClientRect():null;
    dock.classList.toggle('is-center',centre);
    if(!before||calm?.matches)return;
    const after=dock.getBoundingClientRect();if(!after.width)return;
    dock.animate([{transformOrigin:'top left',transform:'translate('+(before.left-after.left)+'px,'+(before.top-after.top)+'px) scale('+(before.width/after.width)+','+(before.height/after.height)+')'},{transformOrigin:'top left',transform:'none'}],{duration:620,easing:'cubic-bezier(.2,.8,.2,1)'});
    dock.querySelectorAll('.pip-thread,.pip-live,.pip-chips,.pip-trip,.pip-composer').forEach(el=>el.animate([{opacity:0},{opacity:0,offset:.35},{opacity:1}],{duration:620}));
  }
  function tripChips(){
    const i=ag.prefs||{},days=Number(i.days)||1,date=i.date&&typeof agDate==='function'?agDate(i.date):i.date||'';
    const budget=i.budgetAmount?(i.budgetCurrency||'CNY')+' '+i.budgetAmount:'No budget limit';
    const items=[['📍',i.city||'Choose a city'],['📅',date],['👥',plural(Number(i.guests)||1,'guest')],['🕘',plural(days,'day')+' · '+(i.dayStart||'09:00')+'–'+(i.dayEnd||'21:00')],[i.transport==='walk'?'🚶':'🚕',i.transport==='walk'?'Walking':'Car / taxi'],['💰',budget]];
    return '<span class="pip-trip-label">Your trip</span>'+items.filter(x=>x[1]).map(([e,t])=>'<button type="button" class="pip-trip-chip" data-act="pipTrip"><span aria-hidden="true">'+e+'</span>'+esc(t)+'</button>').join('')+'<button type="button" class="pip-trip-edit" data-act="pipTrip">'+ic('sliders',14)+'Edit</button>';
  }
  A.pipTrip=()=>{const on=!document.body.classList.contains('pip-trip-open');document.body.classList.toggle('pip-trip-open',on);if(on)app.querySelector('.jl-home>.jl-details')?.scrollTo?.(0,0);};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('pip-trip-open'))document.body.classList.remove('pip-trip-open');});
  function sync(){
    const show=visible(),centre=show&&centreRoute();
    document.body.classList.toggle('pip-on',show&&openPref&&!centre);
    document.body.classList.toggle('pip-center',centre&&openPref);
    if(!centre)document.body.classList.remove('pip-trip-open');
    if(!show){if(dock){dock.hidden=true;toggle.hidden=true;}return;}
    ensure();migrate();place(centre);
    const stage=stageOf(),key=tripKey();
    notice(stage,key);
    dock.hidden=!openPref;toggle.hidden=openPref;
    const steps=STAGES.map(([e,t],i)=>'<span class="pip-step'+(i<stage?' is-done':'')+(i===stage?' is-on':'')+'"><b>'+(i<stage?'✓':e)+'</b>'+t+'</span>').join('');
    const msgs=load(key);
    let thread=msgs.map(messageHTML).join('');
    const empty=centre&&!msgs.length&&!(live()&&pd.busy);
    dock.classList.toggle('is-empty',empty);
    if(empty)thread='';
    else if(!msgs.length)thread=messageHTML({from:'pip',text:stage===0?'Hi, I’m **Pip** 👋 Tell me where you’d like to go and what you love — I’ll scout places, help you choose and plan the days.':stage===3?'Hi again 👋 Pick a day in the calendar and I can check timings, tweak the route or add food.':'Hi, I’m **Pip** 👋 I’ll help you with this trip.'},0,[{}]);
    const liveHTML=liveCard(stage),chips=chipsFor(stage),composer=composerFor(stage);
    const set=(sel,html,prop)=>{if(last[prop]===html)return false;last[prop]=html;dock.querySelector(sel).innerHTML=html;return true;};
    set('[data-pip-sub]',headLine(),'head');
    if(last.stage!==stage){dock.querySelector('[data-pip-steps]').innerHTML=steps;last.stage=stage;}
    const threadEl=dock.querySelector('[data-pip-thread]'),atBottom=threadEl.scrollHeight-threadEl.clientHeight-threadEl.scrollTop<60;
    const changed=set('[data-pip-thread]',thread,'thread')||last.key!==key;last.key=key;
    if(changed&&(atBottom||true))requestAnimationFrame(()=>{threadEl.scrollTop=threadEl.scrollHeight;});
    set('[data-pip-live]',liveHTML,'live');set('[data-pip-chips]',chips,'chips');
    set('[data-pip-trip]',centre?tripChips():'','trip');
    const form=dock.querySelector('[data-pip-form]'),input=form.querySelector('textarea');
    form.hidden=!composer;if(composer){input.placeholder=composer.ph;form.dataset.mode=composer.act;}
    // Something new while Pip is tucked away: a dot on the button.
    toggle.querySelector('.pip-dot').hidden=openPref||!msgs.length||(msgs.at(-1).from!=='pip')||msgs.at(-1).at<(Number(sessionStorage.getItem('jh-pip-seen'))||0);
  }
  function peek(text){
    if(!toggle||calm?.matches)return;const el=toggle.querySelector('[data-pip-peek]');
    el.innerHTML=fmtText(String(text).slice(0,90));el.hidden=false;clearTimeout(peekTimer);peekTimer=setTimeout(()=>{el.hidden=true;},4200);
  }
  function setOpen(on){
    openPref=on;try{localStorage.setItem('jh-pip-open',on?'1':'0');sessionStorage.setItem('jh-pip-seen',String(Date.now()));}catch{}
    render();
  }
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-pip-toggle]')){e.preventDefault();setOpen(!openPref);}});
  // Typing in Pip
  document.addEventListener('input',e=>{if(e.target.matches?.('[data-pip-input]')){e.target.style.height='auto';e.target.style.height=Math.min(120,e.target.scrollHeight)+'px';}});
  document.addEventListener('keydown',e=>{if(e.target.matches?.('[data-pip-input]')&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();e.target.form.requestSubmit();}});
  document.addEventListener('submit',e=>{
    const form=e.target.closest?.('[data-pip-form]');if(!form)return;e.preventDefault();
    const input=form.querySelector('textarea'),text=input.value.trim();if(!text)return;
    input.value='';input.style.height='';
    if(form.dataset.mode==='idea'){
      ag.prefs.prompt=text.slice(0,1200);if(typeof jpSavePrefs==='function')jpSavePrefs();
      void A.jpRequirements();
    }else if(form.dataset.mode==='calendar'){
      say('me',text);say('pip','Opening our chat for **'+(window.jhCalendarAgent.target()?.day||'this day')+'** — I’ll send that right away.');
      window.jhCalendarAgent.say(text);
    }
    sync();
  });
  A.pipIdea=i=>{const t=(typeof window.jhHomeIdeas==='function'?window.jhHomeIdeas():[])[+i]?.text;if(!t)return;const input=dock?.querySelector('[data-pip-input]');if(input){input.value=(input.value?input.value+' ':'')+t;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(input.value.length,input.value.length);}};
  // No words needed: plan from the trip details alone.
  A.pipSurprise=()=>{ag.prefs.prompt='';if(typeof jpSavePrefs==='function')jpSavePrefs();void A.jpRequirements();};
  A.pipAsk=i=>{const p=window.jhCalendarAgent?.prompts()[+i];if(!p)return;say('me',p.label);say('pip','On it — opening our chat for **'+(window.jhCalendarAgent.target()?.day||'this day')+'** 🧭');window.jhCalendarAgent.ask(i);};
  // A search started from the page or from Pip goes into the new trip's conversation.
  const pipStart=A.jpRequirements;
  A.jpRequirements=function(){
    const prompt=String(ag.prefs?.prompt||'').trim(),before=typeof pd!=='undefined'?pd:null;
    const result=pipStart.apply(this,arguments);
    if(window.jhPipShowing()&&live()&&pd!==before){
      const key=tripKey();say('me',prompt||'Plan a trip to '+(pd.input?.city||'the city'),{},key);
      say('pip','On it! 🔎 Scouting **'+(pd.input?.city||'the city')+'** for '+plural(Number(pd.input?.days)||1,'day')+' — I’ll be right back with places to choose from.',{},key);
    }
    return result;
  };

  const pipRender=render;
  render=function(){const out=pipRender.apply(this,arguments);try{sync();}catch(e){console.warn('pip',e);}return out;};
  wide?.addEventListener?.('change',()=>sync());
  setInterval(()=>{if(visible()&&live()&&pd.busy)sync();},1200);
})();
