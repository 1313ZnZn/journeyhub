// Optional, transient review excerpts from the same verified place provider.
// Amap's public POI response has ratings, not review text: never substitute an
// AI recommendation, scrape a different service, or cross-match venue names.
const VALID_ID=/^[A-Za-z0-9_-]{1,200}$/;
const MAX_BYTES=256*1024;
const ENGLISH=/^en(?:-|$)/i;
const NON_ENGLISH_SCRIPT=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Arabic}\p{Script=Cyrillic}]/u;

function googleURL(value,photo=false){
  if(typeof value!=='string'||value.length>4096)return '';
  try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return '';
    const allowed=photo?/(^|\.)googleusercontent\.com$/.test(u.hostname):/(^|\.)google\.com$/.test(u.hostname)||['maps.app.goo.gl','goo.gl'].includes(u.hostname);
    return allowed?u.href:'';
  }catch{return '';}
}

export function isReviewVenue(place){
  if(!place||place.unavailable||place.source!=='Google Maps'||typeof place.id!=='string'||!VALID_ID.test(place.id)||place.id.startsWith('amap_'))return false;
  // Use the provider's primaryType, never an AI-assigned category or reason.
  const kind=typeof place.kind==='string'?place.kind.toLowerCase().replaceAll('_',' '):'';
  return /(?:^| )restaurant$/.test(kind)||['cafe','coffee shop','tea house','bakery','dessert shop','ice cream shop'].includes(kind);
}

function quoteText(review){
  const original=review.originalText,localized=review.text;
  const selected=ENGLISH.test(original?.languageCode||'')?original:localized;
  if(!ENGLISH.test(selected?.languageCode||'')||typeof selected?.text!=='string')return null;
  const full=selected.text.trim();
  if(!full||full.length>12000||!/[a-z]/i.test(full)||/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(full)||NON_ENGLISH_SCRIPT.test(full))return null;
  const words=[...full.matchAll(/\S+/g)];if(!words.length)return null;
  let end=full.length;
  if(words.length>25){
    // Prefer the first complete sentence. Otherwise take a contiguous prefix;
    // the UI marks an excerpt and links directly to the complete source review.
    const sentence=/[.!?](?:["'”’])?(?=\s|$)/.exec(full);
    const sentenceEnd=sentence?sentence.index+sentence[0].length:0;
    end=sentenceEnd&&full.slice(0,sentenceEnd).match(/\S+/g).length<=25?sentenceEnd:words[24].index+words[24][0].length;
  }
  const text=full.slice(0,end);
  return {text,excerpt:end<full.length,translated:selected!==original&&!!original?.languageCode&&!ENGLISH.test(original.languageCode)};
}

export function selectPlaceReview(raw,placeId){
  if(raw?.id!==placeId||!Array.isArray(raw.reviews))return null;
  // Retain Google's relevance order, filtering only by rating, language and
  // complete attribution. This is a selected review, not an aggregate rating.
  for(const review of raw.reviews.slice(0,5)){
    if(!review||!Number.isFinite(review.rating)||review.rating<4||review.rating>5)continue;
    const quote=quoteText(review),author=review.authorAttribution?.displayName,sourceURL=googleURL(review.googleMapsUri);
    if(!quote||typeof author!=='string'||!author.trim()||author.length>120||/[<>\u0000-\u001f]/.test(author)||!sourceURL)continue;
    const visit=review.visitDate;
    return {...quote,author:author.trim(),authorURL:googleURL(review.authorAttribution?.uri),authorPhotoURL:googleURL(review.authorAttribution?.photoUri,true),source:'Google Maps',sourceURL,url:sourceURL,rating:review.rating,filterLabel:'Selected 4–5★ review',
      ...(Number.isInteger(visit?.year)&&visit.year>=1&&Number.isInteger(visit?.month)&&visit.month>=1&&visit.month<=12?{visitDate:{year:visit.year,month:visit.month}}:{})};
  }
  return null;
}

export async function fetchPlaceReview(place,key,fetcher){
  if(!key||!isReviewVenue(place))return null;
  try{
    // Request reviews only for shortlisted food venues. This field is a Google
    // Place Details Enterprise + Atmosphere SKU; do not add it to every search.
    const response=await fetcher('https://places.googleapis.com/v1/places/'+encodeURIComponent(place.id)+'?languageCode=en',{headers:{'X-Goog-Api-Key':key,'X-Goog-FieldMask':'id,reviews'},signal:AbortSignal.timeout(8000),redirect:'error'});
    if(!response.ok||!response.body){await response.body?.cancel();return null;}
    const reader=response.body.getReader();let size=0;const chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();return null;}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return selectPlaceReview(JSON.parse(new TextDecoder().decode(bytes)),place.id);
  }catch{return null;} // Optional enrichment must never break discovery.
}

export async function enrichPlaceReviews(places,key,fetcher){
  await Promise.all(places.map(async place=>{const review=await fetchPlaceReview(place,key,fetcher);if(review)place.review=review;}));
}
