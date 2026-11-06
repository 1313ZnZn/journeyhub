/* ai-plan.html was the standalone AI design prototype. build.cjs now replaces it with a redirect
   into the integrated app so old bookmarks keep working; this test guards that contract. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const out=path.resolve(__dirname,'../../outputs/JourneyHub-Supabase');
const html=fs.readFileSync(path.join(out,'ai-plan.html'),'utf8');
const doc=new JSDOM(html).window.document;
const refresh=doc.querySelector('meta[http-equiv="refresh"]');
assert(refresh,'ai-plan.html must redirect');
assert.match(refresh.getAttribute('content'),/^0;\s*url=\.\/$/,'redirect must open the integrated app');
assert.equal(doc.querySelector('a')?.getAttribute('href'),'./','manual fallback link must open the app');
assert.equal(doc.querySelectorAll('script').length,0,'redirect page must not run scripts');
assert(fs.existsSync(path.join(out,'index.html')),'redirect target must exist');
console.log('PASS: legacy ai-plan.html redirects to the integrated Journey app without scripts');
