/* Local photo journals. Explicit owners isolate every read, write and archive. */
(function(global){
  'use strict';
  const DB='journeyhub-memories-v1', VERSION=1;
  const MAX_FILE=25*1024*1024, MAX_ARCHIVE=128*1024*1024, MAX_PHOTOS=250, MAX_TRIPS=200;
  const TYPES=new Set(['image/jpeg','image/png','image/webp','image/avif']);
  let database;
  const fail=message=>{throw new Error(message);};
  const text=(value,max)=>String(value??'').slice(0,max);
  const ownerOf=value=>typeof value==='string'&&value.length>0&&value.length<=200?value:fail('A valid journal owner is required.');
  const idOf=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)?value:fail('Invalid journal identifier.');
  const uuid=()=>global.crypto.randomUUID();
  const dateOf=value=>{
    if(value==null||value==='')return '';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)fail('Use a valid YYYY-MM-DD date.');
    return value;
  };
  const timeOf=value=>value==null||value===''?'':/^([01]\d|2[0-3]):[0-5]\d$/.test(value)?value:fail('Use a valid HH:MM time.');
  function coordinates(lat,lng){
    if(lat==null&&lng==null)return {lat:null,lng:null};
    if(typeof lat!=='number'||typeof lng!=='number'||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)fail('Invalid photo coordinates.');
    return {lat,lng};
  }
  // Pip's recap of this memory and the traveler's answers to its reflection questions.
  function agentRecord(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined;
    const r=raw.recap&&typeof raw.recap==='object'?raw.recap:null;
    const recap=r&&typeof r.story==='string'&&r.story.trim()?{title:text(r.title,120),story:text(r.story,1200),
      highlights:(Array.isArray(r.highlights)?r.highlights:[]).slice(0,3).filter(h=>Number.isInteger(h?.stop)&&h.stop>=0&&h.stop<200).map(h=>({stop:h.stop,line:text(h.line,240)})),
      mood:(Array.isArray(r.mood)?r.mood:[]).slice(0,3).map(m=>text(m,24)).filter(Boolean),question:text(r.question,240),hash:text(r.hash,40),at:Number.isFinite(Date.parse(r.at))?new Date(r.at).toISOString():new Date().toISOString()}:null;
    const reflections=(Array.isArray(raw.reflections)?raw.reflections:[]).slice(-20).map(x=>({q:text(x?.q,240),a:text(x?.a,1200),at:Number.isFinite(Date.parse(x?.at))?new Date(x.at).toISOString():new Date().toISOString()})).filter(x=>x.q&&x.a);
    return recap||reflections.length?{recap,reflections}:undefined;
  }
  function tripRecord(owner,input){
    if(!input||typeof input!=='object'||Array.isArray(input))fail('Invalid trip.');
    if(input.stops!=null&&!Array.isArray(input.stops))fail('Invalid trip stops.');
    if((input.stops||[]).length>200)fail('A journal supports up to 200 stops.');
    const seen=new Set();
    const stops=(input.stops||[]).map(s=>{
      if(!s||typeof s!=='object')fail('Invalid trip stop.');
      const id=text(s.id||uuid(),100);if(seen.has(id))fail('Trip stop identifiers must be unique.');seen.add(id);
      return {id,title:text(s.title,200),time:text(s.time,80),visited:!!s.visited,note:text(s.note,4000)};
    });
    return {id:input.id?idOf(input.id):uuid(),owner,title:text(input.title||'My journey',200),city:text(input.city,120),country:text(input.country,120),countryCode:text(input.countryCode,3).toUpperCase(),...coordinates(input.lat,input.lng),date:dateOf(input.date),timeZone:text(input.timeZone,80),source:text(input.source,80),stops,...(agentRecord(input.agent)?{agent:agentRecord(input.agent)}:{}),createdAt:Number.isFinite(Date.parse(input.createdAt))?new Date(input.createdAt).toISOString():new Date().toISOString(),updatedAt:new Date().toISOString()};
  }
  function storageError(error){
    if(error?.name==='QuotaExceededError')return new Error('Browser storage is full. Export a journal or remove some photos, then try again.');
    if(error?.name==='SecurityError'||error?.name==='InvalidStateError')return new Error('Local storage is unavailable in this browser. Check its storage settings.');
    return error instanceof Error?error:new Error('The journal could not be saved in this browser.');
  }
  function open(){
    if(database)return database;
    database=new Promise((resolve,reject)=>{
      if(!global.indexedDB){reject(new Error('This browser does not support local photo storage.'));return;}
      const request=global.indexedDB.open(DB,VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        const trips=db.createObjectStore('trips',{keyPath:['owner','id']});trips.createIndex('owner','owner');
        const photos=db.createObjectStore('photos',{keyPath:['owner','id']});
        photos.createIndex('trip',['owner','tripId']);photos.createIndex('hash',['owner','tripId','hash'],{unique:true});
      };
      request.onerror=()=>reject(storageError(request.error));
      request.onblocked=()=>reject(new Error('Close other Journey Hub tabs, then retry opening the journal.'));
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();database=null;};resolve(db);};
    }).catch(error=>{database=null;throw error;});
    return database;
  }
  const request=operation=>new Promise((resolve,reject)=>{operation.onsuccess=()=>resolve(operation.result);operation.onerror=()=>reject(operation.error);});
  async function transaction(names,mode,fn){
    const db=await open(),tx=db.transaction(names,mode);
    const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Local journal transaction was cancelled.'));tx.onerror=()=>{};});
    // Attach the rejection handler immediately, including when a request fails first.
    done.catch(()=>{});
    try{const result=await fn(tx);await done;return result;}catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw storageError(error);}
  }
  const listTrips=async owner=>{owner=ownerOf(owner);return (await transaction(['trips'],'readonly',tx=>request(tx.objectStore('trips').index('owner').getAll(owner)))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));};
  const getTrip=async(owner,id)=>transaction(['trips'],'readonly',tx=>request(tx.objectStore('trips').get([ownerOf(owner),idOf(id)]))).then(t=>t||null);
  async function saveTrip(owner,input){
    owner=ownerOf(owner);const prepared=tripRecord(owner,input);
    return transaction(['trips'],'readwrite',async tx=>{
      const store=tx.objectStore('trips'),old=await request(store.get([owner,prepared.id]));
      if(!old&&(await request(store.index('owner').count(owner)))>=MAX_TRIPS)fail('Export or remove a trip before adding another journal.');
      if(old)prepared.createdAt=old.createdAt;
      await request(store.put(prepared));return prepared;
    });
  }
  const listPhotos=async(owner,tripId)=>{owner=ownerOf(owner);tripId=idOf(tripId);return (await transaction(['photos'],'readonly',tx=>request(tx.objectStore('photos').index('trip').getAll([owner,tripId])))).sort((a,b)=>(a.takenDate+' '+a.takenTime).localeCompare(b.takenDate+' '+b.takenTime)||a.createdAt.localeCompare(b.createdAt));};
  async function updatePhoto(owner,id,patch){
    owner=ownerOf(owner);id=idOf(id);if(!patch||typeof patch!=='object')fail('Invalid photo update.');
    return transaction(['photos','trips'],'readwrite',async tx=>{
      const photos=tx.objectStore('photos'),photo=await request(photos.get([owner,id]));if(!photo)fail('Photo not found in this account.');
      const trip=await request(tx.objectStore('trips').get([owner,photo.tripId]));if(!trip)fail('Trip not found.');
      if('note' in patch)photo.note=text(patch.note,4000);
      if('stopId' in patch){photo.stopId=text(patch.stopId,100)||null;if(photo.stopId&&!trip.stops.some(s=>s.id===photo.stopId))fail('Choose a stop from this trip.');}
      if('takenDate' in patch||'takenTime' in patch){
        const date=dateOf(patch.takenDate??photo.takenDate),time=timeOf(patch.takenTime??photo.takenTime);
        if(date!==photo.takenDate||time!==photo.takenTime){photo.takenDate=date;photo.takenTime=time;photo.dateSource='manual';}
      }
      if('lat' in patch||'lng' in patch){
        const coords=coordinates('lat' in patch?patch.lat:photo.lat,'lng' in patch?patch.lng:photo.lng);
        if(coords.lat!==photo.lat||coords.lng!==photo.lng){Object.assign(photo,coords);photo.locationSource=photo.lat==null?null:'manual';}
      }
      photo.updatedAt=new Date().toISOString();await request(photos.put(photo));return photo;
    });
  }
  const sha=async blob=>Array.from(new Uint8Array(await global.crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
  function canvas(width,height){
    if(global.OffscreenCanvas)return new global.OffscreenCanvas(width,height);
    if(!global.document)fail('Image decoding is unavailable in this browser.');
    const c=global.document.createElement('canvas');c.width=width;c.height=height;return c;
  }
  async function decode(file){
    if(global.createImageBitmap){try{return await global.createImageBitmap(file);}catch{}}
    if(!global.Image||!global.URL?.createObjectURL)fail('This image format cannot be opened in this browser. Try JPEG, PNG or WebP.');
    const url=global.URL.createObjectURL(file);
    try{return await new Promise((resolve,reject)=>{const image=new global.Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This image could not be decoded. Try JPEG, PNG or WebP.'));image.src=url;});}finally{global.URL.revokeObjectURL(url);}
  }
  async function resize(image,max){
    const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
    if(!width||!height||width*height>120000000)fail('Image dimensions are unsupported.');
    const ratio=Math.min(1,max/Math.max(width,height)),c=canvas(Math.max(1,Math.round(width*ratio)),Math.max(1,Math.round(height*ratio))),ctx=c.getContext('2d');
    if(!ctx)fail('Image preview creation is unavailable.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);
    const result=c.convertToBlob?await c.convertToBlob({type:'image/jpeg',quality:max>500?.86:.78}):await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',max>500?.86:.78));
    if(!result)fail('Could not create a photo preview.');return result;
  }
  async function metadata(file){
    const fallback=new Date(Number.isFinite(file.lastModified)?file.lastModified:Date.now());
    let takenDate=fallback.toISOString().slice(0,10),takenTime=fallback.toISOString().slice(11,16),dateSource='file',lat=null,lng=null,locationSource=null;
    if(global.exifr){
      try{
        const tags=await global.exifr.parse(file,{pick:['DateTimeOriginal','OffsetTimeOriginal'],reviveValues:false});
        const match=String(tags?.DateTimeOriginal||'').match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})/);
        if(match){const parsedDate=dateOf(match[1]+'-'+match[2]+'-'+match[3]),parsedTime=timeOf(match[4]+':'+match[5]);takenDate=parsedDate;takenTime=parsedTime;dateSource='exif';}
      }catch{}
      try{const gps=await global.exifr.gps(file);if(gps){const c=coordinates(gps.latitude,gps.longitude);lat=c.lat;lng=c.lng;if(lat!=null)locationSource='exif';}}catch{}
    }
    return {takenDate,takenTime,dateSource,lat,lng,locationSource};
  }
  async function importPhotos(owner,tripId,files,options={}){
    owner=ownerOf(owner);tripId=idOf(tripId);const trip=await getTrip(owner,tripId);if(!trip)fail('Trip not found in this account.');
    const selected=Array.from(files||[]);if(selected.length>100)fail('Import up to 100 photos at a time.');
    const stopId=text(options.stopId,100)||null;if(stopId&&!trip.stops.some(s=>s.id===stopId))fail('Choose a stop from this trip.');
    const result={added:0,duplicates:0,failed:[]};
    for(const file of selected){
      try{
        if(!file||typeof file.arrayBuffer!=='function'||!TYPES.has(String(file.type).toLowerCase()))fail('Choose a JPEG, PNG, WebP or AVIF image.');
        if(!file.size||file.size>MAX_FILE)fail('Each photo must be smaller than 25 MB.');
        const hash=await sha(file);
        const exists=await transaction(['photos'],'readonly',tx=>request(tx.objectStore('photos').index('hash').getKey([owner,tripId,hash])));
        if(exists){result.duplicates++;continue;}
        const details=await metadata(file),image=await decode(file);let blob,thumb;
        try{blob=await resize(image,1800);thumb=await resize(image,360);}finally{image.close?.();}
        const photo={id:uuid(),tripId,owner,name:text(file.name||'Photo',240),hash,blob,thumb,...details,stopId,note:'',createdAt:new Date().toISOString()};
        const added=await transaction(['trips','photos'],'readwrite',async tx=>{
          const p=tx.objectStore('photos');if(!await request(tx.objectStore('trips').get([owner,tripId])))fail('This trip was removed during import.');
          if(await request(p.index('hash').getKey([owner,tripId,hash])))return false;
          if(await request(p.index('trip').count([owner,tripId]))>=MAX_PHOTOS)fail('This journal holds up to 250 photos. Create another journal for more.');
          await request(p.add(photo));return true;
        });
        if(added)result.added++;else result.duplicates++;
      }catch(error){result.failed.push({name:text(file?.name||'Photo',240),message:storageError(error).message});}
    }
    return result;
  }
  async function removePhoto(owner,id){owner=ownerOf(owner);id=idOf(id);await transaction(['photos'],'readwrite',tx=>request(tx.objectStore('photos').delete([owner,id])));}
  async function deleteTrip(owner,id){
    owner=ownerOf(owner);id=idOf(id);
    await transaction(['trips','photos'],'readwrite',async tx=>{
      const photos=tx.objectStore('photos'),keys=await request(photos.index('trip').getAllKeys([owner,id]));
      for(const key of keys)await request(photos.delete(key));await request(tx.objectStore('trips').delete([owner,id]));
    });
  }
  async function base64(blob){
    const bytes=new Uint8Array(await blob.arrayBuffer());let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return global.btoa(value);
  }
  function binary(value,type,limit){
    if(typeof value!=='string'||value.length>Math.ceil(limit/3)*4||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('Invalid or oversized archive photo.');
    let decoded;try{decoded=global.atob(value);}catch{fail('Invalid archive photo encoding.');}
    if(!decoded.length||decoded.length>limit)fail('Invalid archive photo size.');
    return new Blob([Uint8Array.from(decoded,c=>c.charCodeAt(0))],{type});
  }
  async function exportArchive(owner,tripId){
    owner=ownerOf(owner);tripId=idOf(tripId);
    const {trip,photos}=await transaction(['trips','photos'],'readonly',async tx=>{
      const trip=await request(tx.objectStore('trips').get([owner,tripId]));if(!trip)fail('Trip not found in this account.');
      const photos=await request(tx.objectStore('photos').index('trip').getAll([owner,tripId]));return {trip,photos};
    });
    if(photos.reduce((n,p)=>n+p.blob.size+p.thumb.size,0)>MAX_ARCHIVE*.7)fail('This journal is too large for a single archive. Remove some photos before exporting.');
    const archive={format:'JourneyHubMemory',version:1,exportedAt:new Date().toISOString(),trip:{...trip},photos:[]};delete archive.trip.owner;
    for(const p of photos){const {owner:ignored,blob,thumb,...record}=p;archive.photos.push({...record,blob:{type:blob.type,data:await base64(blob)},thumb:{type:thumb.type,data:await base64(thumb)}});}
    const output=new Blob([JSON.stringify(archive)],{type:'application/json'});if(output.size>MAX_ARCHIVE)fail('This journal archive is too large.');return output;
  }
  async function importArchive(owner,file){
    owner=ownerOf(owner);if(!file||typeof file.text!=='function'||!file.size||file.size>MAX_ARCHIVE)fail('Choose a Journey Hub JSON archive smaller than 128 MB.');
    let data;try{data=JSON.parse(await file.text());}catch{fail('This file is not a valid journal archive.');}
    if(data?.format!=='JourneyHubMemory'||data.version!==1||!data.trip||typeof data.trip!=='object'||Array.isArray(data.trip)||!Array.isArray(data.photos)||data.photos.length>MAX_PHOTOS)fail('Unsupported journal archive format.');
    const trip=tripRecord(owner,{...data.trip,id:uuid()}),photos=[],seen=new Set();
    for(const source of data.photos){
      if(!source||typeof source!=='object'||!/^[a-f0-9]{64}$/.test(source.hash)||seen.has(source.hash))fail('Invalid or duplicate archive photo.');seen.add(source.hash);
      if(!TYPES.has(source.blob?.type)||!TYPES.has(source.thumb?.type))fail('Unsupported archive image format.');
      const blob=binary(source.blob.data,source.blob.type,MAX_FILE),thumb=binary(source.thumb.data,source.thumb.type,2*1024*1024);
      // Decode before committing; a corrupt archive never creates a half-imported trip.
      const image=await decode(blob);image.close?.();const preview=await decode(thumb);preview.close?.();
      const stopId=text(source.stopId,100)||null;if(stopId&&!trip.stops.some(s=>s.id===stopId))fail('Archive photo refers to an unknown stop.');
      const location=coordinates(source.lat,source.lng);
      photos.push({id:uuid(),tripId:trip.id,owner,name:text(source.name||'Photo',240),hash:source.hash,blob,thumb,takenDate:dateOf(source.takenDate),takenTime:timeOf(source.takenTime),dateSource:['exif','file','manual'].includes(source.dateSource)?source.dateSource:'file',...location,locationSource:location.lat==null?null:source.locationSource==='exif'?'exif':'manual',stopId,note:text(source.note,4000),createdAt:new Date().toISOString()});
    }
    await transaction(['trips','photos'],'readwrite',async tx=>{
      const trips=tx.objectStore('trips');if(await request(trips.index('owner').count(owner))>=MAX_TRIPS)fail('Export or remove a trip before adding another journal.');
      await request(trips.add(trip));for(const photo of photos)await request(tx.objectStore('photos').add(photo));
    });return trip;
  }
  global.JourneyMemoryStore=Object.freeze({listTrips,getTrip,saveTrip,listPhotos,updatePhoto,importPhotos,exportArchive,importArchive,removePhoto,deleteTrip});
})(window);
