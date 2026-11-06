import assert from 'node:assert/strict';
import {fetchPlaceReview,isReviewVenue,selectPlaceReview} from './supabase/functions/journeyhub-agent/reviews.mjs';
import {discoveryAction,historyAction,readSelection} from './supabase/functions/journeyhub-agent/discovery.mjs';

const restaurant={id:'restaurant_1',source:'Google Maps',kind:'italian restaurant'};
const sourceReview={rating:5,text:{text:'Excellent pasta and friendly service.',languageCode:'en'},originalText:{text:'Excellent pasta and friendly service.',languageCode:'en'},authorAttribution:{displayName:'Review Author',uri:'https://www.google.com/maps/contrib/123',photoUri:'https://lh3.googleusercontent.com/author-avatar'},googleMapsUri:'https://www.google.com/maps/reviews/data=review-1'};
const source={id:restaurant.id,reviews:[sourceReview]};
const result=selectPlaceReview(source,restaurant.id);
assert.equal(result.text,sourceReview.originalText.text);
assert.equal(result.rating,5);assert.equal(result.excerpt,false);assert.equal(result.translated,false);
assert.equal(result.sourceURL,sourceReview.googleMapsUri);assert.equal(result.authorPhotoURL,sourceReview.authorAttribution.photoUri);
assert.equal(selectPlaceReview({...source,id:'wrong-id'},restaurant.id),null);
for(const patch of [{rating:3},{rating:NaN},{rating:'5'},{rating:6},{authorAttribution:{}},{googleMapsUri:'javascript:alert(1)'},{googleMapsUri:'https://google.com.evil.example/review'},{googleMapsUri:undefined},{text:{text:'Excellent!',languageCode:'zh'},originalText:{text:'非常好吃',languageCode:'zh'}},{text:{text:'<script>evil()</script>',languageCode:'en'},originalText:undefined},{text:{text:'很好吃',languageCode:'en'},originalText:undefined}]){
  assert.equal(selectPlaceReview({id:restaurant.id,reviews:[{...sourceReview,...patch}]},restaurant.id),null);
}
const translated=selectPlaceReview({id:restaurant.id,reviews:[{...sourceReview,originalText:{text:'Très bon.',languageCode:'fr'}}]},restaurant.id);
assert.equal(translated.text,sourceReview.text.text);assert.equal(translated.translated,true);
const longText='Excellent pasta and friendly service. '+Array.from({length:40},(_,i)=>'word'+i).join(' ');
const excerpt=selectPlaceReview({id:restaurant.id,reviews:[{...sourceReview,originalText:{text:longText,languageCode:'en'}}]},restaurant.id);
assert.equal(excerpt.text,'Excellent pasta and friendly service.');assert.equal(excerpt.excerpt,true);assert(longText.startsWith(excerpt.text));
const longSentence=Array.from({length:40},(_,i)=>'word'+i).join(' ');
const prefix=selectPlaceReview({id:restaurant.id,reviews:[{...sourceReview,originalText:{text:longSentence,languageCode:'en'}}]},restaurant.id);
assert.equal(prefix.text.split(/\s+/).length,25);assert(longSentence.startsWith(prefix.text));assert.equal(prefix.excerpt,true);
assert.equal(selectPlaceReview({id:restaurant.id,reviews:[{...sourceReview,rating:2},sourceReview]},restaurant.id).rating,5);
for(const place of [{...restaurant,source:'Amap',id:'amap_B123'}, {...restaurant,kind:'museum'}, {...restaurant,kind:undefined,category:'Local food'}, {...restaurant,unavailable:true}, {...restaurant,id:42}]){
  assert.equal(isReviewVenue(place),false);
  assert.equal(await fetchPlaceReview(place,'fixture',()=>{throw Error('Should not call an unrelated provider');}),null);
}
assert.equal(isReviewVenue({...restaurant,kind:'cafe'}),true);
assert.equal(await fetchPlaceReview(restaurant,'',()=>{throw Error('Missing key');}),null);
for(const response of [new Response('Unavailable',{status:503}),new Response('{invalid json'),new Response('x'.repeat(300000)),Response.json({...source,id:'wrong-id'})]){
  assert.equal(await fetchPlaceReview(restaurant,'fixture',async()=>response),null);
}
assert.equal(await fetchPlaceReview(restaurant,'fixture',async()=>{throw Error('Network failed');}),null);
let request;
assert.equal((await fetchPlaceReview(restaurant,'server-only-secret',async(url,options)=>{request={url,options};return Response.json(source);})).text,result.text);
assert(!request.url.includes('server-only-secret'));assert.equal(request.options.headers['X-Goog-FieldMask'],'id,reviews');assert.equal(request.options.redirect,'error');

// Integration: only a shortlisted food venue gets reviews; museums and an
// unselected restaurant do not. Search and history continue when reviews fail.
const user={id:'fixture-owner'},secret='fixture-secret',now=new Date('2026-11-04'),id='33333333-3333-4333-8333-333333333333';
const value={action:'discover',requestId:id,city:'Singapore',date:'2026-11-05',prompt:'Italian food and museums',guests:2,days:2,dayStart:'09:00',dayEnd:'20:00',transport:'drive'};
const env=n=>({DEEPSEEK_API_KEY:'fixture-ai',GOOGLE_PLACES_API_KEY:'server-only-secret'}[n]);
const rawPlace=(placeId,primaryType)=>({id:placeId,primaryType,displayName:{text:placeId==='museum_1'?'City Museum':'Italian Restaurant'},formattedAddress:'Fixture address',location:{latitude:1.30,longitude:103.85}});
const all=[rawPlace(restaurant.id,'italian_restaurant'),rawPlace('restaurant_unselected','restaurant'),rawPlace('museum_1','museum')];
let ai=0,failReviews=false,reviewCalls=[],saved=[],storedRow=null;
const rpc=async(name,args)=>{
  if(name==='journeyhub_trip_history_get')return storedRow;
  if(name==='journeyhub_trip_history_save'){saved.push(args);return {id:args.p_id};}
  return null;
};
const fetcher=async(url,init)=>{
  if(url.includes('deepseek')){const content=JSON.parse(init.body).messages[1].content;assert(!content.includes(sourceReview.text.text));return Response.json({choices:[{message:{content:JSON.stringify(ai++%2===0?{queries:[{category:'Food',query:'Italian restaurant'},{category:'Culture',query:'museum'}]}:{places:[{id:restaurant.id,name:'Italian Restaurant',category:'Food',reason:'Matches Italian food'},{id:'museum_1',name:'City Museum',category:'Culture',reason:'Matches museums'}]})}}]});}
  if(url.includes('places:searchText')){const query=JSON.parse(init.body).textQuery;return Response.json({places:query.includes('museum')?[all[2]]:all.slice(0,2)});}
  const placeId=new URL(url).pathname.split('/').pop();
  if(init.headers['X-Goog-FieldMask']==='id,reviews'){reviewCalls.push(placeId);return failReviews?new Response('unavailable',{status:403}):Response.json(source);}
  return Response.json(all.find(p=>p.id===placeId));
};
const discovered=await discoveryAction({value,user,env,fetcher,rpc,now,secret});
assert.deepEqual(reviewCalls,[restaurant.id]);assert.equal(discovered.places[0].review.text,result.text);assert.equal(discovered.places[1].review,undefined);
assert.equal(saved.length,1);assert(!JSON.stringify(saved).includes(sourceReview.text.text));assert(!JSON.stringify(discovered).includes('server-only-secret'));
const selection=await readSelection(discovered.token,secret,user.id,now);assert.deepEqual(selection.ids,[restaurant.id,'museum_1']);assert(!JSON.stringify(selection).includes('review'));
storedRow={id,input:selection.input,placeIds:selection.ids,wanted:[],skipped:[],plan:null};
reviewCalls=[];
const reopened=await historyAction({value:{action:'history_open',id},user,env,fetcher,rpc,now,secret});
assert.deepEqual(reviewCalls,[restaurant.id]);assert.equal(reopened.places[0].review.text,result.text);assert.equal(saved.length,1);
failReviews=true;reviewCalls=[];
const reopenedWithoutReviews=await historyAction({value:{action:'history_open',id},user,env,fetcher,rpc,now,secret});
assert.equal(reopenedWithoutReviews.places.length,2);assert.equal(reopenedWithoutReviews.places[0].review,undefined);
storedRow=null;
const discoveredWithoutReviews=await discoveryAction({value,user,env,fetcher,rpc,now,secret});
assert.equal(discoveredWithoutReviews.places.length,2);assert.equal(discoveredWithoutReviews.places[0].review,undefined);
console.log('PASS: real English review excerpts, author/source attribution, bounded fail-open requests, shortlisted Google food venues only, refreshed history and no review/key persistence. Mocked providers; no live API calls.');
