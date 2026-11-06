const assert=require('node:assert/strict');
(async()=>{
  const {createAgentHandler}=await import('./supabase/functions/journeyhub-agent/handler.mjs');
  for(const code of ['CARE_PROPOSAL_STALE','CARE_UNSAFE_ADJUSTMENT','CARE_RESERVATION_PROTECTED']){
    const handler=createAgentHandler({
      envGet:name=>({SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'}[name]),
      authenticate:async()=>({id:'8bc241d3-f6bf-40ad-bbaa-ed6aa8e24b00'}),
      fetchImpl:async()=>Response.json({message:code+' private SQL context'},{status:409})
    });
    const response=await handler(new Request('https://app.example.invalid/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'care_confirm',historyId:'e9678da5-f77a-4a50-a061-922be3499e0c'})}));
    const body=await response.json();
    assert.equal(response.status,409);assert.equal(body.error.code,code);
    assert(!body.error.message.includes('private SQL context'));
  }
  console.log('PASS: expired, unsafe and newly protected proposals return actionable 409 errors without internal diagnostics.');
})();
