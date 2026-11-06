/* Provider reviews are quotations; AI preference matches are labelled separately. */
function pdReviewHTML(place){
  if(!place||!/restaurant|cafe|café|coffee|bakery|tea house|dessert|food court|\bbar\b|bistro|meal/i.test(place.kind||''))return '';
  const review=place.review,sourceURL=pdReviewURL(review?.sourceURL||review?.url),authorURL=pdReviewURL(review?.authorURL),avatar=pdReviewPhotoURL(review?.authorPhotoURL);
  if(review?.source==='Google Maps'&&review.rating>=4&&typeof review.text==='string'&&review.text.trim()&&typeof review.author==='string'&&review.author.trim()&&sourceURL){
    return '<figure class="pd-review"><blockquote>'+esc('“'+review.text+(review.excerpt?'…':'')+'”')+'</blockquote><figcaption>'+(avatar?'<img src="'+esc(avatar)+'" alt="" width="16" height="16" loading="lazy">':'')+(authorURL?'<a href="'+esc(authorURL)+'" target="_blank" rel="noopener noreferrer">'+esc(review.author)+'</a>':esc(review.author))+' · <a href="'+esc(sourceURL)+'" target="_blank" rel="noopener noreferrer">Google Maps</a> · Selected 4–5★'+(review.translated?' · Translated':'')+'</figcaption></figure>';
  }
  const reason=typeof place.reason==='string'?place.reason.trim():'';
  return reason?'<p class="pd-match"><span>Why it fits</span> '+esc(reason)+'</p>':'';
}
function pdReviewURL(value){
  try{const url=new URL(value);return url.protocol==='https:'&&(/(^|\.)google\.com$/.test(url.hostname)||url.hostname==='maps.app.goo.gl'||url.hostname==='goo.gl')?url.href:'';}catch{return '';}
}
function pdReviewPhotoURL(value){
  try{const url=new URL(value);return url.protocol==='https:'&&/(^|\.)googleusercontent\.com$/.test(url.hostname)?url.href:'';}catch{return '';}
}
