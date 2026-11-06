// Copy an explicit allow-list only: filled environment files and test credentials never ship.
const fs=require('node:fs'),path=require('node:path');
const root=__dirname,out=path.resolve(root,'../../outputs/JourneyHub-Supabase');
const copy=(source,destination)=>{fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);};
const files=['journeyhub-agent/index.ts','journeyhub-agent/handler.mjs','journeyhub-agent/discovery.mjs','journeyhub-agent/roads.mjs','journeyhub-agent/planner.mjs','journeyhub-mail/index.ts','journeyhub-mail/deno.lock','_shared/agent-mail.mjs','_shared/agent-smtp.mjs'];
files.push('journeyhub-agent/care.mjs','journeyhub-agent/history.mjs','journeyhub-agent/sample-history.mjs','journeyhub-care/index.ts','journeyhub-care/worker.mjs');
for(const name of files)copy(path.join(root,'supabase/functions',name),path.join(out,'backend/supabase/functions',name));
for(const name of ['care.sql','care-db-test.sql','test-care.cjs','test-care-worker.cjs'])copy(path.join(root,name),path.join(out,'backend',name));
for(const name of ['discovery-backend.sql','test-discovery-db.sql','test-discovery.cjs','test-roads.cjs','agent-backend.sql','test-agent-db.sql','test-agent-trip-db.sql','test-agent-planner.cjs','test-agent-mail.cjs','.env.example'])copy(path.join(root,name),path.join(out,'backend',name));
copy(path.join(root,'supabase/migrations/20261023172642_journeyhub_agent_schedule.sql'),path.join(out,'backend/agent-schedule.sql'));
for(const name of ['20261023173356_journeyhub_agent_watchdog.sql','20261025061911_journeyhub_multiday_preferences_progress.sql'])copy(path.join(root,'supabase/migrations',name),path.join(out,'backend',name));
copy(path.join(root,'supabase/migrations/20261025071728_journeyhub_catalog_expansion.sql'),path.join(out,'backend/20261025071728_journeyhub_catalog_expansion.sql'));
for(const name of ['catalog-expansion.json','catalog-bangkok.json','catalog-shanghai.json','catalog-singapore.json'])copy(path.join(root,name),path.join(out,'backend',name));
copy(path.join(root,'catalog-expansion.json'),path.join(out,'catalog-expansion.json'));
copy(path.join(root,'README-Catalog.txt'),path.join(out,'README-Catalog.txt'));
copy(path.join(root,'README-Discovery.txt'),path.join(out,'README-Discovery.txt'));
copy(path.join(root,'README-Agent.txt'),path.join(out,'README-Agent.txt'));
fs.writeFileSync(path.join(out,'backend/supabase/config.toml'),'project_id = "journeyhub-agent"\n\n[functions.journeyhub-agent]\nverify_jwt = false\nentrypoint = "./functions/journeyhub-agent/index.ts"\n\n[functions.journeyhub-mail]\nverify_jwt = false\nentrypoint = "./functions/journeyhub-mail/index.ts"\n');
console.log('Packaged backend sources, SQL, offline tests and empty secret template.');
