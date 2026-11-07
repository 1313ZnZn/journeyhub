const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'outputs/JourneyHub-Supabase');
const target = path.join(root, 'outputs/JourneyHub-Vercel');
const url = process.env.JOURNEYHUB_PUBLIC_SUPABASE_URL || '';
const key = process.env.JOURNEYHUB_PUBLIC_SUPABASE_KEY || '';
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) ||
    !/^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(key)) {
  throw Error('Set valid JOURNEYHUB_PUBLIC_SUPABASE_URL and JOURNEYHUB_PUBLIC_SUPABASE_KEY in the build environment.');
}
execFileSync(process.execPath, [path.join(__dirname, 'build.cjs')], {stdio:'inherit'});
fs.rmSync(target, {recursive:true, force:true});
fs.mkdirSync(target, {recursive:true});
for (const name of ['index.html', 'ai-plan.html']) fs.copyFileSync(path.join(source,name),path.join(target,name));
fs.cpSync(path.join(source,'vendor'),path.join(target,'vendor'),{recursive:true});
// Desktop landing film, poster and backdrop, when the build produced them.
if(fs.existsSync(path.join(source,'media')))fs.cpSync(path.join(source,'media'),path.join(target,'media'),{recursive:true});
fs.writeFileSync(path.join(target,'config.js'),
  'window.JOURNEYHUB_CONFIG = '+JSON.stringify({url,publishableKey:key})+';\n');
const files=[];
function inspect(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())inspect(full);
  else files.push(path.relative(target,full).replaceAll('\\','/'));
}}
inspect(target);
if(files.some(file=>/\.(?:sql|env|map|lock|cjs|mjs|ts)$/i.test(file) || /(?:fixture|test|backend|database)/i.test(file)))
  throw Error('Forbidden file in preview output');
const textFiles=files.filter(file=>/\.(?:html|js|css|txt)$/i.test(file));
for(const file of textFiles){
  const content=fs.readFileSync(path.join(target,file),'utf8');
  if(/development-placeholder|127\.0\.0\.1:54321|SUPABASE_SERVICE_ROLE_KEY\s*[:=]|sb_secret_[A-Za-z0-9_-]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}/.test(content))
    throw Error('Unsafe preview output: '+file);
}
console.log(JSON.stringify({previewDirectory:target,files:files.length}));
