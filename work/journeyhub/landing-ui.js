/* A direct conversational composer; the existing search and confirmation flow is reused. */
let jlDetailsOpen=false,jlMood=0,jlOwner=null;
const jlLibrary=()=>'<section class="jl-home-library" aria-label="Your trips and memories"><button class="jl-library-card" data-act="go" data-a="trip-history"><span class="jl-library-icon">'+ic('calendar',23)+'</span><span class="jl-library-copy"><strong>Trip history</strong><small>Searches & plans</small></span>'+ic('right',18)+'</button><button class="jl-library-card jl-memory-card" data-act="jmMine"><span class="jl-library-icon">'+ic('globe',23)+'</span><span class="jl-library-copy"><strong>Travel memories</strong><small>Photos & stories</small></span>'+ic('right',18)+'</button></section>';
A.jlSpark=()=>{jlMood=(jlMood+1)%3;const home=document.querySelector('.jl-home');if(home)home.dataset.mood=String(jlMood);};
A.jlDetails=()=>{const details=document.querySelector('.jl-details');if(details){details.open=!details.open;jlDetailsOpen=details.open;if(details.open)details.scrollIntoView?.({block:'nearest',behavior:'smooth'});}};
document.addEventListener('toggle',e=>{if(e.target.matches?.('.jl-details'))jlDetailsOpen=e.target.open;},true);
document.addEventListener('change',e=>{if(['agCity','agDate'].includes(e.target.dataset?.ch)){const context=document.querySelector('.jl-context span');if(context)context.textContent=ag.prefs.city+' · '+agDate(ag.prefs.date);}});
const jlPreviousHome=V.journey;
V.journey=()=>{
  if(jlOwner!==ag.owner){jlOwner=ag.owner;jlDetailsOpen=false;}
  const view=jlPreviousHome(),t=document.createElement('template');t.innerHTML=view.body;
  const form=t.content.querySelector('.ag-form'),prompt=form?.querySelector('#ag-prompt');
  if(!form||!prompt)return view; // Preserve the real in-progress planner state.
  // Keep demo labels on saved records, not in the personal trip composer.
  if(document.activeElement?.id!=='ag-prompt'){
    const cleanPrompt=String(ag.prefs.prompt||'').replace(/^\s*\[Sample\]\s*/i,'');
    if(cleanPrompt!==ag.prefs.prompt){ag.prefs.prompt=cleanPrompt;prompt.textContent=cleanPrompt;jpSavePrefs();}
  }
  prompt.setAttribute('placeholder','Quiet gardens, local food, a little adventure…');prompt.setAttribute('aria-label','Describe your trip');prompt.setAttribute('rows','3');
  const details=document.createElement('details');details.className='jl-details jh-home-planner';details.open=jlDetailsOpen;details.innerHTML='<summary>Trip details</summary><div class="ag-form"></div>';
  const controls=details.querySelector('.ag-form');
  for(const selector of ['.jh-destination-cards','.ag-form-row','.jh-home-options','.jh-home-sample']){const el=form.querySelector(selector);if(el)controls.append(el);}
  const context=esc(ag.prefs.city)+' · '+agDate(ag.prefs.date);
  const error=agErrorHTML(),health=form.querySelector('.ag-health');
  const retry=ag.health?.ai?.ready!==true&&health?'<div class="jl-connection">'+health.outerHTML+'<button class="btn-text" data-act="agHealth">Check connection</button></div>':'';
  view.body='<main class="jl-home" data-mood="'+jlMood+'"><button class="jl-art" data-act="jlSpark" aria-label="Give the journey a little sparkle"><span class="jl-orbit"></span><span class="jl-cloud c1"></span><span class="jl-cloud c2"></span><span class="jl-ticket">'+ic('navAI',38)+'<span>YOUR NEXT ADVENTURE</span></span><span class="jl-spark s1">✦</span><span class="jl-spark s2">✧</span></button><div class="jl-copy"><h1>Where shall we go?</h1></div>'+error+'<div class="jl-composer">'+prompt.outerHTML+'<div class="jl-compose-bottom"><button class="jl-context" data-act="jlDetails" aria-label="Edit trip destination and dates">'+ic('pin',16)+'<span>'+context+'</span>'+ic('down',14)+'</button><button class="jl-send" data-act="jpRequirements" aria-label="Find my places"'+(ag.busy||pd.busy?' disabled':'')+'>'+ic('right',23)+'</button></div></div><div class="jl-suggestions" role="group" aria-label="Trip interests">'+jhVibes.map(([icon,value])=>'<button data-act="jhHomeVibe" data-a="'+value+'" aria-pressed="'+ag.prefs.prompt.split('\n').includes(value)+'">'+ic(icon,17)+value+'</button>').join('')+'</div>'+details.outerHTML+retry+'</main>';
  view.body=view.body.replace('</main>',jlLibrary()+'</main>');
  return view;
};
for(const route of ['trip-history','memories','memory-trip','memory-new','memory-photo','memory-badges','memory-poster'])if(route in V)TAB_OF[route]='journey';
