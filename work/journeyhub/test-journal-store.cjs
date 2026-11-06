const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto'),{IDBFactory}=require('fake-indexeddb');
const source=fs.readFileSync(path.join(__dirname,'journal-store.js'),'utf8'),indexedDB=new IDBFactory();
function boot(idb=indexedDB){
  class Canvas{
    constructor(width,height){this.width=width;this.height=height;}
    getContext(){return {fillRect(){},drawImage(){}};}
    async convertToBlob(){return new Blob(['image:'+this.width+'x'+this.height],{type:'image/jpeg'});}
  }
  const context={window:null,indexedDB:idb,crypto:webcrypto,Blob,Uint8Array,Date,URL,btoa,atob,OffscreenCanvas:Canvas,
    createImageBitmap:async blob=>{if((await blob.text()).startsWith('corrupt'))throw Error('invalid image');return {width:4000,height:2000,close(){}};},
    exifr:{parse:async file=>file.name?.includes('gps')?{DateTimeOriginal:'2026:10:24 14:35:03'}:undefined,gps:async file=>file.name?.includes('gps')?{latitude:31.23,longitude:121.47}:undefined}};
  context.window=context;vm.runInNewContext(source,context);return context.JourneyMemoryStore;
}
function file(name,body='source-image',type='image/jpeg'){
  const value=new Blob([body],{type});Object.defineProperties(value,{name:{value:name},lastModified:{value:Date.UTC(2026,9,24,10,20)}});return value;
}
const plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
  let store=boot();
  await assert.rejects(()=>store.listTrips(''),/owner/);
  const trip=await store.saveTrip('alice',{owner:'mallory',title:'Shanghai memories',city:'Shanghai',date:'2026-10-24',timeZone:'Asia/Shanghai',stops:[{id:'bund',title:'The Bund',visited:false,note:''}]});
  assert.equal(trip.owner,'alice');assert.match(trip.id,/^[a-f0-9-]{36}$/);assert.equal(await store.getTrip('bob',trip.id),null);
  const one=file('gps-photo.jpg');
  assert.deepEqual(plain(await store.importPhotos('alice',trip.id,[one,one],{stopId:'bund'})),{added:1,duplicates:1,failed:[]});
  let photos=await store.listPhotos('alice',trip.id);assert.equal(photos.length,1);
  const photo=photos[0];assert.equal(photo.dateSource,'exif');assert.equal(photo.takenDate,'2026-10-24');assert.equal(photo.takenTime,'14:35');assert.equal(photo.lat,31.23);assert.equal(photo.locationSource,'exif');assert.equal(photo.stopId,'bund');assert.equal(photo.hash.length,64);
  assert.equal(await photo.blob.text(),'image:1800x900');assert.equal(await photo.thumb.text(),'image:360x180');
  assert.equal((await store.listPhotos('bob',trip.id)).length,0);
  await assert.rejects(()=>store.importPhotos('bob',trip.id,[one]),/account/);
  await assert.rejects(()=>store.updatePhoto('bob',photo.id,{note:'stolen'}),/account/);
  const edited=await store.updatePhoto('alice',photo.id,{owner:'bob',tripId:'forged',hash:'forged',note:'A lovely walk',takenDate:'2026-10-25',takenTime:'09:10',lat:0,lng:0});
  assert.equal(edited.owner,'alice');assert.equal(edited.tripId,trip.id);assert.equal(edited.hash,photo.hash);assert.equal(edited.dateSource,'manual');assert.equal(edited.locationSource,'manual');assert.equal(edited.lat,0);
  await assert.rejects(()=>store.updatePhoto('alice',photo.id,{lat:91,lng:0}),/coordinates/);
  await assert.rejects(()=>store.updatePhoto('alice',photo.id,{takenDate:'2026-02-30'}),/date/);
  await assert.rejects(()=>store.updatePhoto('alice',photo.id,{stopId:'missing'}),/stop/);
  const fallback=await store.importPhotos('alice',trip.id,[file('plain.png','second-image','image/png')]);assert.equal(fallback.added,1);
  photos=await store.listPhotos('alice',trip.id);assert.equal(photos.find(p=>p.name==='plain.png').dateSource,'file');
  const fail=await store.importPhotos('alice',trip.id,[file('bad.txt','text','text/plain'),file('bad.jpg','corrupt-image')]);assert.equal(fail.added,0);assert.equal(fail.failed.length,2);
  const large=file('large.jpg');Object.defineProperty(large,'size',{value:26*1024*1024});assert.equal((await store.importPhotos('alice',trip.id,[large])).failed.length,1,'oversized photos are rejected before decoding');
  await assert.rejects(()=>store.importPhotos('alice',trip.id,Array(101).fill(one)),/100 photos/);
  // Two importer instances sharing one database cannot win the same hash race.
  const race=file('race.webp','third-image','image/webp');const raced=await Promise.all([store.importPhotos('alice',trip.id,[race]),boot().importPhotos('alice',trip.id,[race])]);
  assert.equal(raced.reduce((n,r)=>n+r.added,0),1);assert.equal(raced.reduce((n,r)=>n+r.duplicates,0),1);
  store=boot();assert.equal((await store.getTrip('alice',trip.id)).title,'Shanghai memories');assert.equal((await store.listPhotos('alice',trip.id)).length,3,'data survives a fresh script instance');
  const other=await store.saveTrip('bob',{title:'Private journal'});assert.equal((await store.importPhotos('bob',other.id,[one])).added,1,'deduplication is scoped to trip and owner');
  await store.removePhoto('bob',photo.id);assert.equal((await store.listPhotos('alice',trip.id)).length,3,'foreign deletion is harmless');
  const archive=await store.exportArchive('alice',trip.id);assert.equal(archive.type,'application/json');
  const raw=JSON.parse(await archive.text());assert.equal(raw.trip.owner,undefined);assert(!raw.photos.some(p=>'owner' in p));
  const imported=await store.importArchive('bob',archive);assert.notEqual(imported.id,trip.id);assert.equal(imported.owner,'bob');
  const copied=await store.listPhotos('bob',imported.id);assert.equal(copied.length,3);assert(copied.every(p=>p.owner==='bob'&&p.tripId===imported.id&&!photos.some(old=>old.id===p.id)));
  assert.equal(copied.find(p=>p.name==='gps-photo.jpg').note,'A lovely walk');
  const before=(await store.listTrips('bob')).length;
  const invalid=structuredClone(raw);invalid.photos[1].lat=300;invalid.photos[1].lng=0;
  await assert.rejects(()=>store.importArchive('bob',new Blob([JSON.stringify(invalid)])),/coordinates/);assert.equal((await store.listTrips('bob')).length,before,'invalid archive is atomic');
  await assert.rejects(()=>store.importArchive('bob',new Blob(['not-json'])),/valid journal/);
  await assert.rejects(()=>store.importArchive('bob',new Blob([JSON.stringify({format:'JourneyHubMemory',version:1,photos:[]})])),/format/);
  const dup=structuredClone(raw);dup.photos.push(dup.photos[0]);await assert.rejects(()=>store.importArchive('bob',new Blob([JSON.stringify(dup)])),/duplicate/);
  await store.deleteTrip('bob',trip.id);assert(await store.getTrip('alice',trip.id),'foreign trip delete is harmless');
  await store.deleteTrip('alice',trip.id);assert.equal(await store.getTrip('alice',trip.id),null);assert.equal((await store.listPhotos('alice',trip.id)).length,0,'trip removal cascades only to its own photos');
  assert.equal((await store.listPhotos('bob',imported.id)).length,3);
  await assert.rejects(()=>boot(null).listTrips('alice'),/does not support/);
  console.log('PASS: local journal persistence, owner isolation, image resize/metadata, scoped and concurrent SHA-256 dedup, edits, archive round-trip/validation/atomicity, deletion and unavailable-storage errors. Browser image decode and EXIF are mocked; IndexedDB is fake-indexeddb.');
})().catch(error=>{console.error(error);process.exitCode=1;});
