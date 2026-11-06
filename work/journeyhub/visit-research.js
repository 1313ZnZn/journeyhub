// Saved server-side research is separate from the short-lived map-provider snapshot.
const cvResearchCache=new Map();let cvResearchOwner='',cvResearchTimer;
function cvResearchKey(e){return e.manageKind+':'+e.manageId;}
function cvSavedResearch(e,id){
 if(!jhUser?.id||cvResearchOwner!==jhUser.id)return null;
 return cvResearchCache.get(cvResearchKey(e))?.rows?.find(r=>r.id===id&&r.date===e.date)||null;
}
async function cvLoadResearch(e,id){
 if(!jhUser?.id||!['history','run'].includes(e.manageKind)||!e.manageId||typeof sb==='undefined')return;
 const owner=jhUser.id,key=cvResearchKey(e);
 if(cvResearchOwner!==owner){cvResearchOwner=owner;cvResearchCache.clear();}
 clearTimeout(cvResearchTimer);
 const isOpen=()=>jhUser?.id===owner&&ui.sheet?.type==='calendar-visit'&&ui.sheet.key===e.key&&ui.sheet.id===id;
 const retry=(ms)=>{if(isOpen())cvResearchTimer=setTimeout(()=>{if(isOpen())void cvLoadResearch(e,id);},ms);};
 const prev=cvResearchCache.get(key)||{},current=cvSavedResearch(e,id),pending=!current||['queued','checking'].includes(current.state);
 if(prev.inFlight){retry(2500);return;}
 const ttl=pending?5000:90000;
 if(Date.now()-(prev.at||0)<ttl){if(pending)retry(7000);return;}
 const slot={...prev,inFlight:true};cvResearchCache.set(key,slot);
 try{
  const {data,error}=await sb.rpc('journeyhub_visit_details',{p_type:e.manageKind,p_id:e.manageId});if(error||!Array.isArray(data))throw Error();
  if(cvResearchCache.get(key)!==slot||cvResearchOwner!==owner||jhUser?.id!==owner)return;
  cvResearchCache.set(key,{rows:data,at:Date.now()});
  if(!isOpen())return;
  const updated=cvSavedResearch(e,id),el=document.querySelector('.cv-sheet .cv-attraction');
  if(el&&JSON.stringify(current)!==JSON.stringify(updated)){
   const stop=e.stops.find(s=>s.id===id);if(stop){const p=cvPlace(e,stop);el.outerHTML=cvAttractionHTML(p,e,cvStatus(e,p));}
  }
  if(updated&&['queued','checking'].includes(updated.state))retry(10000);
 }catch{if(cvResearchCache.get(key)===slot)cvResearchCache.set(key,{...prev,at:Date.now()});retry(18000);}
}
