// Cross-platform, offline verification of the Python decision service and its Edge callers.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const service=fileURLToPath(new URL('../services/agent-api/',import.meta.url));
function run(command,args,cwd=root){
 console.log('\n> '+command+' '+args.join(' '));
 const result=spawnSync(command,args,{cwd,stdio:'inherit',shell:false});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
run('uv',['sync','--frozen'],service);
run('uv',['run','--frozen','ruff','check','.'],service);
run('uv',['run','--frozen','pytest','-q'],service);
for(const script of [
 'test-decision-runtime.mjs','test-python-agent-integration.mjs',
 'test-care-chat.mjs','test-care-chat-actions.mjs','test-care-chat-snapshots.mjs',
 'test-trip-chat-handler.mjs','test-traveler-planner.mjs','test-traveler-planner-tasks.mjs',
 'test-traveler-planner-handler.mjs','test-planner-adjust.mjs','test-planner-latency.mjs',
 'test-agent-planner.cjs',
])run(process.execPath,['work/journeyhub/'+script]);
