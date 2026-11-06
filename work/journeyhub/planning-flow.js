/* Requirements first, optional place selection second, generation last. */
let pfGuestHandoff=null;
A.jpRequirements=()=>{
  if(ag.busy)return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(ag.prefs.date)){ag.error='Choose a travel date.';render();return;}
  if(!jpPayload(ag.prefs))return;
  pfGuestHandoff=null;ag.error='';jpSavePrefs();A.jpPicks();
};
A.jpFinish=()=>{
  if(ag.busy)return;
  if(!jhUser){pfGuestHandoff=JSON.parse(JSON.stringify(ag.prefs));openLogin('traveler',{route:'ai-picks'});return;}
  go('ai');return A.agGenerate();
};
const pfOriginalLogin=doLogin;
doLogin=async function(kind){
  await pfOriginalLogin(kind);
  if(kind==='traveler-signin'&&pfGuestHandoff&&jhUser&&state.auth.traveler&&ag.owner===jhUser.id){ag.prefs=jpNormalize(pfGuestHandoff);pfGuestHandoff=null;jpSavePrefs();go('ai-picks');}
};
// An explicit signed-out scope cannot retain an earlier guest handoff.
const pfSignOut=signOut;
signOut=async function(){pfGuestHandoff=null;return pfSignOut();};
const pfForm=V.ai;
V.ai=()=>{
  const view=pfForm();if(ag.busy)return view;
  const root=document.createElement('template');root.innerHTML=view.body;
  root.content.querySelector('.jp-picks-entry')?.remove();
  const button=root.content.querySelector('[data-act="agGenerate"]');
  if(button){button.dataset.act='jpRequirements';button.disabled=false;button.innerHTML='Choose places next '+ic('right',16);}
  view.body=root.innerHTML;return view;
};
const pfPicks=V['ai-picks'];
V['ai-picks']=()=>{
  const view=pfPicks(),root=document.createElement('template');root.innerHTML=view.body;
  // Finishing the deck no longer sends the traveler back through the form.
  root.content.querySelector('.jp-picks-complete [data-a="ai"]')?.remove();
  view.bar=bar({title:'Choose your places',right:'<button class="btn-text" data-act="jpFinish">Skip cards</button>'});
  view.body='<div class="pf-step">'+esc(ag.prefs.city)+' · '+agDate(ag.prefs.date)+'<span>Step 2 of 3</span></div>'+root.innerHTML;
  view.foot='<div class="foot"><button class="btn btn-primary btn-block" data-act="jpFinish">'+ic('sparkle',17)+(jhUser?'Create my plan':'Sign in to create my plan')+'</button><p class="ix-note" style="margin-top:7px">Continue anytime. Your chosen places will guide the AI.</p></div>';
  return view;
};
