/* Workspace preference is account-scoped UI state; server staff roles authorize access. */
const snKey=()=>jhUser?'journeyhub-workspace-'+jhUser.id:null;
const snRoutes=new Set(['journey','home','shop','orders','me','s-today','s-orders','s-sessions','s-insights','s-compare','s-plan','s-session']);
function snRememberWorkspace(){
  if(!jhUser||!me()||jhLoading||!jhPersonalReady||!snRoutes.has(state.route))return;
  try{sessionStorage.setItem(snKey(),JSON.stringify({mode:state.role,route:state.route,params:state.route==='s-plan'&&state.params?.id?{id:state.params.id}:{}}));}catch{}
}
function snRestoreWorkspace(){
  if(!jhUser||!me())return;
  let saved;try{saved=JSON.parse(sessionStorage.getItem(snKey())||'null');}catch{}
  const travelerMode=saved?.mode==='traveler',fallback=me().role==='host'?'s-session':'s-today';
  state.role=travelerMode?'traveler':'staff';
  state.route=saved&&snRoutes.has(saved.route)&&saved.route.startsWith('s-')===!travelerMode?saved.route:travelerMode?'journey':fallback;
  state.params=state.route==='s-plan'&&typeof saved?.params?.id==='string'?{id:saved.params.id}:{};
}
const snPreviousRole=A.role;
A.role=async function(mode){await snPreviousRole(mode);snRememberWorkspace();};
A.staffEntry=()=>{
  if(me()){A.role('staff');return;}
  openLogin('staff',{route:'s-today'});
};
A.staffTraveler=async()=>{if(typeof sfBeforeLeave==='function'&&!await sfBeforeLeave())return;state.guestOk=true;setRole('traveler','journey');snRememberWorkspace();};
const snSwitchStaff=A.switchStaff;
A.switchStaff=async()=>{if(typeof sfBeforeLeave==='function'&&!await sfBeforeLeave())return;snSwitchStaff();};
const snSignOut=A.signOut;
A.signOut=async()=>{if(typeof sfBeforeLeave==='function'&&!await sfBeforeLeave())return;await snSignOut();};
for(const route of ['journey','home','shop','orders','me']){
  const prior=V[route];V[route]=function(){const view=prior.apply(this,arguments);
    if(view.bar&&!view.bar.includes('data-act="staffEntry"'))view.bar=view.bar.replace('</header>','<button class="sn-entry" data-act="staffEntry">'+ic('grid',15)+'<span>'+(me()?'Staff workspace':'Staff sign in')+'</span></button></header>');return view;};
}
for(const route of ['s-today','s-orders','s-sessions','s-insights','s-compare','s-plan','s-session']){
  const prior=V[route];V[route]=function(){const view=prior.apply(this,arguments);if(view.bar)view.bar=view.bar.replace('</header>','<button class="icon-btn sn-account" data-act="staffMenu" aria-label="Staff account">'+ic('user',18)+'</button></header>');return view;};
}
const snWelcome=V.welcome;
V.welcome=()=>{const view=snWelcome();view.body=view.body.replace('I work at a hub or partner store','Staff sign in').replace('Staff sign-in with your staff ID and PIN','Use your assigned email and password');return view;};
const snRender=render;
render=function(){snRender();snRememberWorkspace();};
