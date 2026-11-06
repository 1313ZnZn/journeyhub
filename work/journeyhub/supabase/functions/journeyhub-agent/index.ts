import {createAgentHandler} from './handler.mjs';
Deno.serve(createAgentHandler({envGet:(name:string)=>Deno.env.get(name),waitUntil:(task:Promise<unknown>)=>EdgeRuntime.waitUntil(task)}));
