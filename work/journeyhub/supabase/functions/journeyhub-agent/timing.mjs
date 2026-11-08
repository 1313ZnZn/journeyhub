// One bounded, aggregate record per request. Never include IDs, prompts, URLs,
// provider bodies, tokens, or exception messages in performance telemetry.
const actions=new Set(['pip_chat','place_debate','memory_recap','care_chat_history','care_chat','care_chat_apply','care_chat_pay','planner_start','planner_status','planner_retry','calendar_weather','amap_config','demo_state','demo_topup','demo_quote','demo_session_quote','demo_book','demo_cancel','discover_revise','discover_revise_apply','care_confirm','care_status','care_check','care_event','care_accept','care_stop','history_list','history_open','history_refresh','history_choices','history_import','discover','discover_plan','plan']);
const stages=new Set(['auth','database','catalog_schedule','discovery_intent','discovery_search','discovery_rank','discovery_rank_repair','discovery_photos','plan_details','plan_localize','plan_schedule','plan_routes','history_details','history_localize','history_routes','revision_routes']);
export function requestTiming({clock=()=>performance.now(),log=record=>console.info(JSON.stringify(record))}={}){
 const start=clock(),totals=new Map();let action='unknown',finished=false;
 const elapsed=from=>Math.max(0,Math.round(clock()-from));
 return {
  action(value){action=actions.has(value)?value:'unknown';},
  async measure(stage,task){
   if(!stages.has(stage))return task();
   const from=clock();try{return await task();}finally{const value=totals.get(stage)||{stage,calls:0,durationMs:0};value.calls++;value.durationMs+=elapsed(from);totals.set(stage,value);}
  },
  finish(status){
   const durationMs=elapsed(start);
   if(!finished){finished=true;try{log({event:'journeyhub_timing',action,status,durationMs,stages:[...totals.values()]});}catch{/* Metrics must never interrupt a workflow. */}}
   return durationMs;
  }
 };
}
