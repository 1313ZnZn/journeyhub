/* Explore owns both browsing modes. Keep the shop route for saved navigation,
   store links and checkout return paths; catalog/cart data stay unchanged. */
function exHeader() {
  const n=cartCount();
  return '<header class="bar top ex-header"><h1 class="h1">Explore</h1>'+jhFxSwitch()+
    '<button class="icon-btn ring" data-act="go" data-a="bag" aria-label="Bag, '+plural(n,'item')+'">'+ic('bag',20)+(n?'<span class="count">'+n+'</span>':'')+'</button>'+
    '<button class="icon-btn ring" data-act="bell" aria-label="Notifications">'+ic('bell',19)+(myOrders().some(o=>orderInfo(o).needsChoice)?'<span class="dot"></span>':'')+'</button></header>';
}
function exBrowseSwitch(mode) {
  return '<div class="ex-browse-switch" role="group" aria-label="Explore categories">'+
    [['home','explore','Experiences'],['shop','bag','Shopping']].map(([route,icon,label])=>
      '<button data-act="exBrowse" data-a="'+route+'" aria-pressed="'+(route===mode)+'">'+ic(icon,18)+'<span>'+label+'</span></button>').join('')+'</div>';
}
for(const route of ['home','shop']){
  const prior=V[route];
  V[route]=function(){
    const view=prior.apply(this,arguments);
    view.bar=exHeader();
    view.body=exBrowseSwitch(route)+view.body;
    return view;
  };
}
A.exBrowse=mode=>{
  if(!['home','shop'].includes(mode)||state.route===mode)return;
  tabTo(mode);
};
