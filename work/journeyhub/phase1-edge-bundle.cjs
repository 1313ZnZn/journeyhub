const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'supabase/functions');
const entry=process.argv[2];
const seen=new Map();
function visit(name){
 name=path.posix.normalize(name);
 if(seen.has(name))return;
 const content=fs.readFileSync(path.join(root,name),'utf8');
 seen.set(name,content);
 for(const match of content.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
  if(match[1].startsWith('.'))visit(path.posix.join(path.posix.dirname(name),match[1]));
 }
}
visit(entry);
process.stdout.write(JSON.stringify({entrypoint_path:entry,files:[...seen].map(([name,content])=>({name,content}))}));
