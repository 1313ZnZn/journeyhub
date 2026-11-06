/* A larger catalog, using the existing cards, detail pages and booking controls. */
TAB_OF.catalog='home';
const jcCategories=[['all','All places'],['culture','Culture'],['food','Food'],['nature','Nature'],['family','Family'],['art','Art'],['workshops','Workshops'],['wellness','Wellness']];
let jcQuery='',jcCategory='all',jcSort='curated';
const jcCityRows=()=>Object.values(EXPS).filter(e=>e.city===jhCity);
const jcMatches=e=>[e.name,e.kind,e.venue,e.details?.summary,...e.cats,...e.does].join(' ').toLowerCase().includes(jcQuery.trim().toLowerCase());
function jcRows(){
  const rows=jcCityRows().filter(e=>(jcCategory==='all'||e.cats.includes(jcCategory))&&jcMatches(e));
  if(jcSort==='name')rows.sort((a,b)=>a.name.localeCompare(b.name,'en'));
  if(jcSort==='duration')rows.sort((a,b)=>parseFloat(a.dur)-parseFloat(b.dur)||a.name.localeCompare(b.name,'en'));
  if(jcSort==='price')rows.sort((a,b)=>a.price-b.price||a.name.localeCompare(b.name,'en'));
  return rows;
}
REGIONS.jcResults=()=>{const rows=jcRows();return '<div class="jc-result-meta"><span role="status" aria-live="polite">'+rows.length+' '+(rows.length===1?'experience':'experiences')+'</span><span>Sample catalog</span></div>'+(rows.length?'<div class="jc-grid">'+rows.map(e=>expCard(e.id)).join('')+'</div>':'<div class="jc-empty"><span>'+ic('search',28)+'</span><h2>No places found</h2><p>Try another word or explore a different category.</p><button class="btn btn-primary" data-act="jcReset">Clear filters</button></div>');};
A.jcOpen=()=>{jcQuery='';jcCategory=state.homeCat||'all';jcSort='curated';go('catalog');};
A.jcCity=city=>{if(!jhSetCity(city))return;state.homeCat='all';state.homeQuery='';jcCategory='all';jcQuery='';scrollTop=true;render();};
A.jcCategory=category=>{if(!jcCategories.some(([id])=>id===category))return;jcCategory=category;render();};
A.jcReset=()=>{jcCategory='all';jcQuery='';jcSort='curated';render();};
INPUTS.jcSearch=value=>{jcQuery=String(value).slice(0,200);updateRegion('jcResults');};
CHANGES.jcSort=el=>{if(['curated','name','duration','price'].includes(el.value)){jcSort=el.value;updateRegion('jcResults');}};
V.catalog=()=>({bar:bar({title:'Discover '+jhCity,back:true}),tabs:true,body:
  '<div class="jc-page"><div class="ix-citybar jc-citybar" role="group" aria-label="Catalog destination">'+Object.keys(jhCities).map(city=>'<button data-act="jcCity" data-a="'+city+'" aria-pressed="'+(city===jhCity)+'">'+city+'</button>').join('')+'</div>'+
  '<label class="input jc-search">'+ic('search',18)+'<input id="jc-search" type="search" data-in="jcSearch" value="'+esc(jcQuery)+'" placeholder="Search places, food, neighborhoods" aria-label="Search catalog"></label>'+
  '<div class="ix-categories jc-categories" role="group" aria-label="Catalog categories">'+jcCategories.filter(([key])=>key==='all'||jcCityRows().some(e=>e.cats.includes(key))).map(([key,label])=>'<button data-act="jcCategory" data-a="'+key+'" aria-pressed="'+(jcCategory===key)+'">'+label+'</button>').join('')+'</div>'+
  '<label class="jc-sort">Sort by <select data-ch="jcSort" aria-label="Sort catalog">'+[['curated','Featured'],['name','Name A–Z'],['duration','Shortest first'],['price','Sample price: low to high']].map(([key,label])=>'<option value="'+key+'"'+(jcSort===key?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
  '<div data-region="jcResults">'+REGIONS.jcResults()+'</div><p class="ix-note jc-note">Real places · Sample itineraries<br>Admission, meals and transport are separate. No payment taken.</p></div>'});
