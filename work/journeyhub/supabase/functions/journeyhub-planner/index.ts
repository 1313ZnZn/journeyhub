import {createPlannerWorker} from './worker.mjs';
Deno.serve(createPlannerWorker({env:(name:string)=>Deno.env.get(name)}));
