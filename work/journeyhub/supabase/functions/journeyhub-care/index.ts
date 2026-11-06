import {createCareWorker} from './worker.mjs';
Deno.serve(createCareWorker({env:(name:string)=>Deno.env.get(name)}));
