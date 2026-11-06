const assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),{source}=require('./swipe-stability-fixture.cjs');
const dom=new JSDOM('<div id="app"></div>',{url:'https://fixture.test',runScripts:'outside-only'}),w=dom.window;
const preloads=[];w.Image=class{constructor(){preloads.push(this);}set src(v){this._src=v;}get src(){return this._src;}};
w.eval(source());const f=w.swipeFixture,app=w.document.querySelector('#app'),card=()=>app.querySelector('.jp-swipe-card'),image=()=>card()?.querySelector('img'),photos=(id)=>({url:'https://example.test/'+id+'-bad.jpg',alternatives:['https://example.test/'+id+'-good.jpg']});
const places=['a','b','c'].map(id=>({id,name:'Place '+id,reason:'Local test',address:'Test address',kind:'restaurant',source:'Amap',sourceURL:'https://amap.com',attributions:[],openingHours:[],photo:photos(id)}));
const pointer=(target,type,x,y)=>{const event=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{pointerId:7,button:0,clientX:x,clientY:y});target.dispatchEvent(event);};
try{
 f.reset(places);const first=card(),firstImage=image();assert.equal(preloads.length,2);
 for(let i=0;i<8;i++)f.completeSave();assert.equal(card(),first);assert.equal(image(),firstImage);assert.equal(preloads.length,2,'background saves do not repeat preloads');
 f.pd.historyError='Save interrupted';f.render();assert.equal(card(),first);assert(app.querySelector('.th-save-status').textContent.includes('Save interrupted'));
 f.pd.historySaving=true;f.render();assert.equal(card(),first);assert(app.querySelector('.th-save-status').textContent.includes('Saving'));
 f.pd.historySaving=false;f.pd.historyError='';f.render();assert.equal(card(),first);assert(!app.querySelector('.th-save-status'),'save status updates in place without rebuilding the card');
 f.bindPhotos();f.bindPhotos();firstImage.dispatchEvent(new w.Event('error'));assert.equal(firstImage.src,'https://example.test/a-good.jpg','one failed event advances one alternative despite repeat after hook');
 firstImage.dispatchEvent(new w.Event('load'));assert(first.querySelector('.pd-photo-fallback').hidden);assert.equal(first.querySelector('.pd-photo-fallback').getAttribute('aria-hidden'),'true');
 f.completeSave();assert.equal(image(),firstImage);assert.equal(firstImage.src,'https://example.test/a-good.jpg');
 pointer(first,'pointerdown',100,100);pointer(first,'pointermove',210,100);const transform=first.style.transform;f.completeSave();assert.equal(card(),first,'background save must not cancel connected pointer target');assert.equal(first.style.transform,transform);
 Object.defineProperties(first,{offsetWidth:{value:300},offsetHeight:{value:400}});first.getBoundingClientRect=()=>({left:150,top:40,width:320,height:420});
 const motions=[];w.Element.prototype.animate=function(frames){motions.push({frames,element:this});return {finished:new Promise(()=>{})};};
 pointer(first,'pointerup',210,100);assert.equal(card().dataset.pickId,'b');assert.deepEqual(Array.from(f.pd.wanted),['a']);assert.equal(motions.length,1);assert.equal(motions[0].frames[0].transform,transform,'exit starts at finger transform, without snap to center');
 const second=card();f.completeSave();f.render();assert.equal(card(),second,'save completes without a second arrival animation');
 second.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));assert.deepEqual(Array.from(f.pd.skipped),['b']);f.A.pdUndo();assert.equal(card().dataset.pickId,'b');
 f.A.pdUndo();assert.equal(card().dataset.pickId,'a');assert.equal(image().src,'https://example.test/a-good.jpg','undo retains known-working photo alternative');
 image().dispatchEvent(new w.Event('error'));const failed=card();assert(image().hidden);assert.equal(failed.querySelector('.pd-photo-label').textContent,'Photo unavailable');assert.equal(failed.querySelector('.pd-photo-fallback [aria-hidden="true"]').textContent,'⌖','fallback updates its label, not a nested icon span');assert(!failed.querySelector('.pd-photo-fallback').textContent.includes('Loading photo'));f.completeSave();assert.equal(card(),failed,'exhausted photo stays stable');f.A.jpPick('a','skip');f.A.pdUndo();assert(!image(),'exhausted sources are not retried on undo');
 f.pd.error='Retry required';f.render();assert(app.querySelector('[role="alert"]'));assert.notEqual(card(),failed,'visible errors still redraw');
 f.owner('other');assert.equal(f.pd.owner,'other');assert.equal(f.pd.places.length,0,'account change cannot keep previous owner card');
 console.log('PASS: native card/image identity across saves, preload dedup, image failover/undo/exhaustion, drag continuity, one exit, keyboard/undo, visible error updates and owner isolation. All local.');
}finally{w.close();}
