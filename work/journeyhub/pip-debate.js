/* Place debate (desktop). Two places from the traveler's Maybe pile argue, in the first person,
   for a spot in the trip: an opening, a rebuttal and a closing, with Pip moderating. The
   traveler can react, ask both a question, and choose at any moment: keep one, both or neither.
   What each place says comes from the server, which only lets it cite facts from the search. */
(function(){
  const wide=window.matchMedia?.('(min-width:1024px)');
  const calm=window.matchMedia?.('(prefers-reduced-motion:reduce)');
  const ROUNDS=['Opening','Rebuttal','Closing'];
  const live=()=>typeof pd!=='undefined'&&pd.mode&&!pd.sample;
  const placeOf=id=>pd.places.find(p=>p.id===id);
  const maybeIds=()=>(typeof window.jhFanMaybe==='function'?window.jhFanMaybe():pd.maybe||[]).filter(id=>placeOf(id));
  // The search's signed token says when it stops authorizing new AI calls.
  function expired(){
    try{const body=String(pd.token||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/');const data=JSON.parse(atob(body+'='.repeat((4-body.length%4)%4)));return !Number.isFinite(data.expires)||data.expires<=Date.now()+30000;}catch{return true;}
  }
  window.jhDebateReady=()=>!!wide?.matches&&live()&&!pd.busy&&maybeIds().length>=2;

  let d=null; // {ids,stage:'pick'|'talk',round,turns,lean,busy,error,speaking,typed}
  const fmt=t=>esc(String(t||''));
  const buddy=(p,size,mood,cls)=>typeof jhBuddy==='function'?jhBuddy(p,size,mood,cls):'';
  const avatar=cls=>typeof tchAvatar==='function'?tchAvatar(cls):'';

  function pickHTML(){
    const ids=maybeIds();
    return '<div class="pdb-pick"><p class="pdb-lead">Choose two places from <b>Maybe</b> to argue it out.</p><div class="pdb-pick-grid">'+ids.map(id=>{const p=placeOf(id),on=d.ids.includes(id);
      return '<button type="button" class="pdb-pick-item'+(on?' is-on':'')+'" data-act="pdbToggle" data-a="'+esc(id)+'" aria-pressed="'+on+'">'+buddy(p,54,on?'happy':'smile')+'<span>'+fmt(p.name)+'</span></button>';}).join('')+
      '</div><button type="button" class="pdb-go" data-act="pdbStart"'+(d.ids.length===2?'':' disabled')+'>🎤 Start the debate</button></div>';
  }
  function sideHTML(key,i){
    const p=placeOf(d.ids[i]),last=[...d.turns].reverse().find(t=>t.speaker===key),speaking=d.speaking===key,waiting=d.busy||(d.speaking&&!speaking&&!d.typed[key]);
    const text=speaking?d.shown:(d.typed[key]||last?.text||'');
    const mood=d.busy?'smile':speaking?'talk':d.lean*(i?-1:1)>=2?'happy':d.lean*(i?-1:1)<=-2?'sad':'smug';
    const facts=(speaking||d.typed[key])&&last?.facts?.length?'<div class="pdb-facts">'+last.facts.map(f=>'<span>'+fmt(f.icon)+' '+fmt(f.label)+'</span>').join('')+'</div>':'';
    return '<div class="pdb-side is-'+key+(speaking?' is-speaking':'')+'"><div class="pdb-who">'+buddy(p,104,mood,'pdb-buddy')+'<strong>'+fmt(p.name)+'</strong></div>'+
      '<div class="pdb-bub'+(text?'':' is-empty')+'" aria-live="polite">'+(text?fmt(text):waiting?'<i class="pdb-dots"><b></b><b></b><b></b></i>':'')+facts+'</div>'+
      (d.typed[key]&&!d.busy?'<div class="pdb-react"><button type="button" data-act="pdbReact" data-a="'+key+'" data-b="1">👍 Good point</button><button type="button" data-act="pdbReact" data-a="'+key+'" data-b="-1">🤔 Not convinced</button></div>':'')+'</div>';
  }
  function talkHTML(){
    const [A,B]=d.ids.map(placeOf),done=!d.busy&&!d.speaking,lean=Math.max(-4,Math.min(4,d.lean));
    const last=d.turns.filter(t=>t.speaker==='pip').at(-1);
    return '<div class="pdb-rounds">'+ROUNDS.map((r,i)=>'<span class="'+(i+1<d.round?'is-done':i+1===d.round?'is-now':'')+'">'+(i+1)+' · '+r+'</span>').join('')+'</div>'+
      '<div class="pdb-arena">'+sideHTML('a',0)+'<div class="pdb-vs" aria-hidden="true">VS</div>'+sideHTML('b',1)+'</div>'+
      '<div class="pdb-lean" aria-label="Your leaning"><span>'+fmt(A.name)+'</span><div class="pdb-meter"><i style="--lean:'+(lean/8+.5)+'"></i></div><span>'+fmt(B.name)+'</span></div>'+
      (last&&done?'<div class="pdb-pip">'+avatar('pdb-pip-av')+'<p>'+fmt(last.text)+'</p></div>':'')+
      (d.error?'<p class="pdb-error" role="alert">'+fmt(d.error)+'</p>':'')+
      '<div class="pdb-bar">'+(done&&d.round<3&&!d.error?'<button type="button" class="pdb-next" data-act="pdbNext">'+(d.round===1?'Hear the rebuttals':'Closing words')+' →</button>':'')+
      (done&&d.error?'<button type="button" class="pdb-next" data-act="pdbRetry">Try again</button>':'')+
      '<form class="pdb-ask" data-pdb-ask><input maxlength="300" placeholder="Ask them both… e.g. Which is better in the rain?" aria-label="Ask both places a question"'+(done?'':' disabled')+'><button type="submit"'+(done?'':' disabled')+'>Ask</button></form></div>'+
      '<div class="pdb-choose'+(done&&d.round>=3?' is-ready':'')+'"><span>'+(done&&d.round>=3?'Time to choose 👇':'Choose any time')+'</span>'+
      '<button type="button" data-act="pdbKeep" data-a="a">🏆 Keep '+fmt(A.name)+'</button><button type="button" data-act="pdbKeep" data-a="b">🏆 Keep '+fmt(B.name)+'</button>'+
      '<button type="button" data-act="pdbKeep" data-a="both">🤝 Keep both</button><button type="button" data-act="pdbKeep" data-a="none">👋 Neither</button></div>';
  }
  function paint(){
    let root=document.querySelector('.pdb');
    if(!d){root?.remove();return;}
    if(!root){document.body.insertAdjacentHTML('beforeend','<div class="pdb" role="dialog" aria-modal="true" aria-labelledby="pdb-title"><div class="pdb-scrim" data-act="pdbClose"></div><section class="pdb-card"><header class="pdb-head"><span class="pdb-kicker">🎤 Place debate</span><h2 id="pdb-title"></h2><button type="button" class="pdb-close" data-act="pdbClose" aria-label="Close">'+ic('x',18)+'</button></header><div class="pdb-body"></div></section></div>');root=document.querySelector('.pdb');}
    const [A,B]=d.ids.map(placeOf);
    root.querySelector('#pdb-title').textContent=d.stage==='pick'||!A||!B?'Which two should debate?':A.name+' vs '+B.name;
    const body=root.querySelector('.pdb-body'),input=body.querySelector('.pdb-ask input'),kept=input?.value||'',focused=document.activeElement===input;
    body.innerHTML=d.stage==='pick'?pickHTML():talkHTML();
    const next=body.querySelector('.pdb-ask input');if(next&&kept){next.value=kept;}if(next&&focused&&!next.disabled)next.focus();
  }

  // The two speeches appear one after the other, typed out.
  let typer=null;
  function speak(keys){
    clearInterval(typer);
    const key=keys.shift();if(!key){d.speaking=null;paint();return;}
    const text=[...d.turns].reverse().find(t=>t.speaker===key)?.text||'';
    d.speaking=key;d.shown='';
    if(calm?.matches){d.shown=text;d.typed[key]=text;speak(keys);return;}
    let i=0;paint();
    typer=setInterval(()=>{
      if(!d){clearInterval(typer);return;}
      i=Math.min(text.length,i+3);d.shown=text.slice(0,i);
      const bub=document.querySelector('.pdb-side.is-'+key+' .pdb-bub');if(bub)bub.textContent=d.shown;
      if(i>=text.length){clearInterval(typer);d.typed[key]=text;setTimeout(()=>{if(d)speak(keys);},350);}
    },28);
  }
  async function round(question=''){
    if(!d||d.busy)return;
    if(expired()){d.error='This search has expired, so the places can’t speak any more. Choose yourself, or start a new search.';paint();return;}
    d.busy=true;d.error='';d.typed={};paint();
    const full=typeof jhPickCap==='function'&&pd.wanted.length>=jhPickCap();
    try{
      const r=await window.jhPipPost({action:'place_debate',token:pd.token,ids:d.ids,must:pd.wanted.slice(0,16),round:d.round,question,reason:full?'full':'maybe',turns:d.turns.slice(-12).map(({speaker,text})=>({speaker,text}))});
      if(!d)return;
      if(question)d.turns.push({speaker:'me',text:question});
      d.turns.push({speaker:'a',text:r.a.text,facts:r.a.facts},{speaker:'b',text:r.b.text,facts:r.b.facts});
      if(r.pip)d.turns.push({speaker:'pip',text:r.pip});
      d.busy=false;speak(['a','b']);
    }catch(e){
      if(!d)return;
      d.busy=false;d.error=e.code==='SEARCH_EXPIRED'?'This search has expired, so the places can’t speak any more. Choose yourself, or start a new search.':(e.message||'The places lost their voices for a moment. Please try again.');paint();
    }
  }

  A.pdbOpen=()=>{
    if(!window.jhDebateReady())return;
    const ids=maybeIds();
    d={ids:ids.slice(0,2),stage:ids.length>2?'pick':'talk',round:1,turns:[],lean:0,busy:false,error:'',speaking:null,typed:{},shown:''};
    paint();if(d.stage==='talk')void round();
    document.querySelector('.pdb-card')?.focus?.();
  };
  A.pdbToggle=id=>{if(!d)return;d.ids=d.ids.includes(id)?d.ids.filter(x=>x!==id):[...d.ids,id].slice(-2);paint();};
  A.pdbStart=()=>{if(!d||d.ids.length!==2)return;d.stage='talk';paint();void round();};
  A.pdbNext=()=>{if(!d||d.busy||d.speaking||d.round>=3)return;d.round++;void round();};
  A.pdbRetry=()=>{if(d)void round();};
  A.pdbReact=(key,v)=>{if(!d)return;d.lean+=(key==='a'?1:-1)*(Number(v)>0?1:-1);
    d.turns.push({speaker:'me',text:(Number(v)>0?'Good point, ':'Not convinced, ')+placeOf(d.ids[key==='a'?0:1]).name+'.'});paint();};
  A.pdbClose=()=>{clearInterval(typer);d=null;paint();};
  A.pdbKeep=which=>{
    if(!d)return;
    const [a,b]=d.ids,[A1,B1]=d.ids.map(placeOf),move=window.jhFanMove;
    // Counted (anonymously) for this week's debate champions; the choice itself never waits on it.
    if(['a','b','both','none'].includes(which)&&pd.token)window.jhPipPost?.({action:'debate_result',token:pd.token,ids:[a,b],choice:which}).catch(()=>{});
    clearInterval(typer);d=null;paint();
    if(typeof move!=='function')return;
    if(which==='a'){move(a,'want');move(b,'skip');}
    else if(which==='b'){move(b,'want');move(a,'skip');}
    else if(which==='both'){move(a,'want');move(b,'want');}
    else{move(a,'skip');move(b,'skip');}
    const line={a:'**'+A1.name+'** won the debate 🏆 It’s in Must go; '+B1.name+' sits this one out.',b:'**'+B1.name+'** won the debate 🏆 It’s in Must go; '+A1.name+' sits this one out.',
      both:'A draw! 🤝 **'+A1.name+'** and **'+B1.name+'** both join Must go.',none:'Neither convinced you 👋 Both go to Not this time.'}[which];
    window.jhPipSay?.(line,{kind:'react',heads:which==='a'?[a]:which==='b'?[b]:[a,b]});
  };
  document.addEventListener('submit',e=>{
    if(!e.target.matches?.('[data-pdb-ask]'))return;e.preventDefault();
    const input=e.target.querySelector('input'),q=input.value.trim();if(!q||!d||d.busy||d.speaking)return;
    input.value='';void round(q);
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&d){e.preventDefault();e.stopPropagation();A.pdbClose();}},true);
  // Leaving the card screen ends the debate.
  const before=render;
  render=function(){const out=before.apply(this,arguments);if(d&&state.route!=='ai-picks')A.pdbClose();queueMicrotask(addEntry);return out;};

  // A "Debate" button on the Maybe pile once it holds two places.
  function addEntry(){
    const head=document.querySelector('#app .fc-pile-maybe .fc-pile-head');
    const ready=window.jhDebateReady(),btn=head?.querySelector('.pdb-entry');
    if(!head)return;
    if(!ready){btn?.remove();return;}
    if(!btn)head.insertAdjacentHTML('beforeend','<button type="button" class="pdb-entry" data-act="pdbOpen" title="Two Maybe places argue for a spot in your trip">🎤 Let them debate</button>');
  }
  new MutationObserver(()=>addEntry()).observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
})();
