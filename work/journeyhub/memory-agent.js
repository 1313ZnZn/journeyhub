/* Pip on the Travel memories pages (desktop). On a memory, Pip writes a recap from what the
   traveler recorded (stops, visited marks, notes, photo dates and times) and asks one reflection
   question; the answer is kept with the memory and used in later recaps. On the memories home,
   Pip reflects on all trips together and suggests a next trip that can be planned straight away.
   Memories stay in this browser; only their text goes to Pip, never the photos. */
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const calm=window.matchMedia?.('(prefers-reduced-motion:reduce)');
  const busy=new Set(),errors=new Map(),demoRecaps=new Map(),freshUntil=new Map();
  const fresh={add:k=>freshUntil.set(k,Date.now()+1500),has:k=>(freshUntil.get(k)||0)>Date.now(),delete:()=>{}};
  let answerDraft='';
  const signedIn=()=>typeof jhUser!=='undefined'&&!!jhUser;
  const avatar=cls=>typeof tchAvatar==='function'?tchAvatar(cls):'';
  const hash=s=>{let h=5381;for(let i=0;i<s.length;i++)h=(h*33^s.charCodeAt(i))>>>0;return h.toString(36);};

  // The text Pip may read for one memory.
  function memoryPayload(t){
    const photos=jmPhotos(t.id),days=new Map();
    for(const p of photos){if(!p.takenDate)continue;const d=days.get(p.takenDate)||{date:p.takenDate,photos:0,times:[]};d.photos++;if(p.takenTime&&d.times.length<6)d.times.push(String(p.takenTime).slice(0,5));days.set(p.takenDate,d);}
    return {title:t.title,city:t.city,country:t.country,date:t.date,photos:photos.length,
      stops:t.stops.slice(0,20).map(s=>({title:s.title,time:s.time,visited:!!s.visited,note:s.note||'',photos:photos.filter(p=>p.stopId===s.id).length})),
      photoDays:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(0,10),
      reflections:(t.agent?.reflections||[]).slice(-6).map(r=>({q:r.q,a:r.a}))};
  }
  const contentHash=t=>{const p=memoryPayload(t);delete p.reflections;return hash(JSON.stringify(p));};
  const hasContent=t=>t.stops.length||jmPhotos(t.id).length;
  const recapOf=t=>jmDemo?demoRecaps.get(t.id)||null:t.agent?.recap||null;

  async function ask(payload){
    if(typeof window.jhPipPost!=='function')throw Error('Pip isn’t available right now.');
    return window.jhPipPost({action:'memory_recap',...payload});
  }
  const friendly=e=>e?.code==='MEMORY_TOO_EMPTY'?'Add a few stops, notes or photos first, so Pip has something to remember.':(e?.message||'Pip couldn’t write this right now.');

  // ---------- One memory ----------
  async function writeRecap(t){
    const key=t.id;if(busy.has(key))return;
    if(!signedIn()){openLogin('traveler',{route:'memory-trip',params:{id:t.id}});return;}
    busy.add(key);errors.delete(key);render();
    try{
      const r=await ask({mode:'trip',memory:memoryPayload(t)});
      const recap={title:r.title,story:r.story,highlights:r.highlights||[],mood:r.mood||[],question:r.question||'',hash:contentHash(t),at:new Date().toISOString()};
      fresh.add(key);
      if(jmDemo)demoRecaps.set(key,recap);
      else{await JM.saveTrip(jmOwner(),{...clone(t),agent:{recap,reflections:t.agent?.reflections||[]}});await jmLoad();}
    }catch(e){errors.set(key,friendly(e));}
    finally{busy.delete(key);render();}
  }
  async function saveAnswer(t,answer){
    const recap=recapOf(t);if(!recap?.question||!answer.trim())return;
    if(jmDemo){toast('Sample memory · create your own to keep answers');return;}
    const reflections=[...(t.agent?.reflections||[]),{q:recap.question,a:answer.trim().slice(0,1200),at:new Date().toISOString()}];
    try{await JM.saveTrip(jmOwner(),{...clone(t),agent:{recap:{...recap,question:''},reflections}});answerDraft='';await jmLoad();toast('Saved to this memory');}
    catch(e){toast(e.message||'Could not save your answer.');}
  }
  function storyHTML(text,animate){
    if(!animate||calm?.matches)return esc(text);
    return text.split(' ').map((w,i)=>'<span class="ma-w" style="--d:'+Math.min(i*28,2400)+'ms">'+esc(w)+' </span>').join('');
  }
  function tripPanel(t){
    const key=t.id,recap=recapOf(t),working=busy.has(key),error=errors.get(key),changed=recap&&!jmDemo&&recap.hash!==contentHash(t);
    const head='<div class="ma-head">'+avatar('ma-av')+'<div><strong>Pip’s recap</strong><small>'+(recap?'Written '+new Date(recap.at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})+' from your stops, notes and photo times':'Your memory keeper')+'</small></div></div>';
    if(working)return '<section class="ma-card is-working" aria-live="polite">'+head+'<p class="ma-typing"><i></i><i></i><i></i> Reading your notes and photo times…</p></section>';
    if(!recap){
      const empty=!hasContent(t);
      return '<section class="ma-card">'+head+'<p class="ma-lead">'+(empty?'Add stops, notes or photos and I’ll turn them into a short story of this trip.':'I can turn your stops, notes and photo times into a short story of this trip — and ask you one question to remember it by.')+'</p>'+
        (error?'<p class="ma-error" role="alert">'+esc(error)+'</p>':'')+
        '<div class="ma-actions"><button type="button" class="ma-go" data-act="maRecap"'+(empty?' disabled':'')+'>✨ '+(signedIn()?'Write my recap':'Sign in to get a recap')+'</button></div><p class="ma-privacy">Only the text you wrote is sent to Pip. Your photos stay on this device.</p></section>';
    }
    const animate=fresh.has(key);fresh.delete(key);
    const highlights=recap.highlights.filter(h=>t.stops[h.stop]).map(h=>'<li><b>'+esc(t.stops[h.stop].title)+'</b><span>'+esc(h.line)+'</span></li>').join('');
    const past=(t.agent?.reflections||[]).slice(-3).reverse().map(r=>'<li><small>'+esc(r.q)+'</small><span>'+esc(r.a)+'</span></li>').join('');
    return '<section class="ma-card has-recap">'+head+'<h2 class="ma-title">'+esc(recap.title)+'</h2>'+
      (recap.mood.length?'<div class="ma-mood">'+recap.mood.map(m=>'<span>'+esc(m)+'</span>').join('')+'</div>':'')+
      '<p class="ma-story">'+storyHTML(recap.story,animate)+'</p>'+(highlights?'<ul class="ma-highlights">'+highlights+'</ul>':'')+
      (recap.question?'<form class="ma-ask" data-ma-answer><label for="ma-answer"><span>'+avatar('ma-av-sm')+'</span>'+esc(recap.question)+'</label><textarea id="ma-answer" rows="2" maxlength="1200" placeholder="'+(jmDemo?'Answers are kept on your own memories':'Write a line or two…')+'">'+esc(answerDraft)+'</textarea><div class="ma-actions"><button type="submit" class="ma-go">Keep this answer</button></div></form>':'')+
      (past?'<details class="ma-past"'+(recap.question?'':' open')+'><summary>Your reflections ('+(t.agent?.reflections||[]).length+')</summary><ul>'+past+'</ul></details>':'')+
      (error?'<p class="ma-error" role="alert">'+esc(error)+'</p>':'')+
      '<div class="ma-actions ma-foot">'+(changed?'<span class="ma-changed">Your memory changed since this recap.</span>':'')+'<button type="button" class="ma-again'+(changed?' is-primary':'')+'" data-act="maRecap">↻ '+(changed?'Update recap':'Write it again')+'</button></div></section>';
  }

  // ---------- All memories ----------
  const reflectKey=()=>'jh-memory-reflect:'+(jhUser?.id||'guest')+(jmDemo?':sample':'');
  const loadReflect=()=>{try{return JSON.parse(localStorage.getItem(reflectKey())||'null');}catch{return null;}};
  const saveReflect=v=>{try{localStorage.setItem(reflectKey(),JSON.stringify(v));}catch{}};
  const allHash=()=>hash(jmTrips().map(contentHash).join('|'));
  async function reflectAll(){
    if(busy.has('*'))return;
    if(!signedIn()){openLogin('traveler',{route:'memories'});return;}
    const trips=jmTrips().filter(hasContent).slice(0,12);if(!trips.length)return;
    busy.add('*');errors.delete('*');render();
    try{const r=await ask({mode:'all',memories:trips.map(memoryPayload)});saveReflect({...r,titles:trips.map(t=>t.title),hash:allHash(),at:new Date().toISOString()});fresh.add('*');}
    catch(e){errors.set('*',friendly(e));}
    finally{busy.delete('*');render();}
  }
  function hubPanel(){
    const trips=jmTrips(),usable=trips.filter(hasContent),saved=loadReflect(),working=busy.has('*'),error=errors.get('*');
    const head='<div class="ma-head">'+avatar('ma-av')+'<div><strong>Pip’s travel reflection</strong><small>'+(saved?'Across '+saved.titles.length+' memor'+(saved.titles.length===1?'y':'ies'):'What your trips say about you')+'</small></div></div>';
    if(working)return '<section class="ma-card is-working ma-hubcard" aria-live="polite">'+head+'<p class="ma-typing"><i></i><i></i><i></i> Looking back over your memories…</p></section>';
    if(!saved)return '<section class="ma-card ma-hubcard">'+head+'<p class="ma-lead">'+(usable.length?'I’ll look across your '+usable.length+' memor'+(usable.length===1?'y':'ies')+' for what you keep coming back to — and suggest where to go next.':'Once a memory has stops, notes or photos, I can reflect on your trips here.')+'</p>'+(error?'<p class="ma-error" role="alert">'+esc(error)+'</p>':'')+
      '<div class="ma-actions"><button type="button" class="ma-go" data-act="maReflect"'+(usable.length?'':' disabled')+'>✨ '+(signedIn()?'Reflect on my trips':'Sign in to reflect')+'</button></div><p class="ma-privacy">Only the text you wrote is sent to Pip. Your photos stay on this device.</p></section>';
    const animate=fresh.has('*');fresh.delete('*');const changed=saved.hash!==allHash();
    const fav=saved.favourite&&saved.titles[saved.favourite.memory]?'<p class="ma-fav">⭐ <b>'+esc(saved.titles[saved.favourite.memory])+'</b> — '+esc(saved.favourite.why)+'</p>':'';
    return '<section class="ma-card has-recap ma-hubcard">'+head+'<p class="ma-story">'+storyHTML(saved.story,animate)+'</p>'+
      (saved.patterns?.length?'<ul class="ma-patterns">'+saved.patterns.map(p=>'<li>'+esc(p)+'</li>').join('')+'</ul>':'')+fav+
      (saved.question?'<p class="ma-q">'+avatar('ma-av-sm')+esc(saved.question)+'</p>':'')+
      (saved.next?'<div class="ma-next"><div><small>Next trip idea · '+esc(saved.next.city)+'</small><strong>'+esc(saved.next.idea)+'</strong></div><button type="button" class="ma-go" data-act="maPlanNext">Plan it with Pip →</button></div>':'')+
      (error?'<p class="ma-error" role="alert">'+esc(error)+'</p>':'')+
      '<div class="ma-actions ma-foot">'+(changed?'<span class="ma-changed">Your memories changed since this reflection.</span>':'')+'<button type="button" class="ma-again'+(changed?' is-primary':'')+'" data-act="maReflect">↻ '+(changed?'Update reflection':'Reflect again')+'</button></div></section>';
  }

  // ---------- Wiring ----------
  A.maRecap=()=>{const t=jmTrip();if(t)void writeRecap(t);};
  A.maReflect=()=>void reflectAll();
  A.maPlanNext=()=>{const n=loadReflect()?.next;if(!n)return;ag.prefs={...(ag.prefs||{}),city:n.city,prompt:n.idea};if(typeof jpSavePrefs==='function')jpSavePrefs();go('journey');};
  document.addEventListener('input',e=>{if(e.target?.id==='ma-answer')answerDraft=e.target.value.slice(0,1200);});
  document.addEventListener('submit',e=>{if(!e.target.matches?.('[data-ma-answer]'))return;e.preventDefault();const t=jmTrip();if(t)void saveAnswer(t,e.target.querySelector('textarea').value);});

  const maTrip=V['memory-trip'];
  V['memory-trip']=function(){
    const view=maTrip.apply(this,arguments),t=wide?.matches&&jmCache.loaded!==false?jmTrip():null;
    if(!t||!view?.body?.includes('<div class="jm-tabs">'))return view;
    view.body=view.body.replace('<div class="jm-tabs">',tripPanel(t)+'<div class="jm-tabs">');return view;
  };
  const maHub=V.memories;
  V.memories=function(){
    const view=maHub.apply(this,arguments),mark='<section><div class="jm-section-head"><h2>Recent memories';
    if(!wide?.matches||!view?.body?.includes(mark))return view;
    view.body=view.body.replace(mark,hubPanel()+mark);return view;
  };
})();
