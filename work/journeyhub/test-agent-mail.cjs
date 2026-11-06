// Fully mocked tests. No provider, database, or email network calls are made.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const api=import(pathToFileURL(path.join(__dirname,'supabase/functions/_shared/agent-mail.mjs')).href);
const smtpApi=import(pathToFileURL(path.join(__dirname,'supabase/functions/_shared/agent-smtp.mjs')).href);
const SECRET='test-worker-secret-012345678901234567890123456789';
const baseEnv={JOURNEYHUB_AGENT_WORKER_SECRET:SECRET,JOURNEYHUB_MAIL_PROVIDER:'resend',RESEND_API_KEY:'test-not-a-real-key',JOURNEYHUB_MAIL_FROM:'JourneyHub <bookings@example.invalid>',JOURNEYHUB_APP_URL:'https://journey.example.invalid/'};
const smtpEnv={...baseEnv,JOURNEYHUB_MAIL_PROVIDER:'smtp',SMTP_HOST:'smtp.example.invalid',SMTP_PORT:'465',SMTP_USER:'test-user',SMTP_PASSWORD:'test-not-a-password'};
const get=env=>name=>env[name];
const request=(token=SECRET,body={})=>new Request('https://edge.example.invalid/journeyhub-mail',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
const reply=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
function job(overrides={}) {return {id:'11111111-1111-4111-8111-111111111111',lease_token:'22222222-2222-4222-8222-222222222222',to_email:'traveler@example.invalid',verified_email:true,booking_status:'confirmed',template:'booking_confirmation',snapshot:{booking_id:'booking-1',session_id:'session-1',experience_title:'Shanghai Tea Experience',starts_at:'2026-11-01T09:00:00Z',time_zone:'Asia/Shanghai',party_size:2,venue_name:'Old Town Tea House',address:'Shanghai meeting point',traveler_name:'Alex',booking_reference:'JH-123'},...overrides};}
function queue(jobs,{finishFails=false}={}) {
  const calls=[];
  const rpc=async(name,args={})=>{calls.push({name,args});if(name==='journeyhub_agent_worker_config')return{worker_secret:SECRET};if(name==='journeyhub_agent_claim_mail')return jobs;if(name==='journeyhub_agent_finish_mail'){if(finishFails)throw new Error('simulated lost connection');return{ok:true,status:args.p_outcome==='sent'?'accepted':args.p_outcome,attempts:1};}throw new Error('Unexpected RPC '+name);};
  return {rpc,calls,finishes:()=>calls.filter(c=>c.name==='journeyhub_agent_finish_mail').map(c=>c.args)};
}

test('missing/wrong bearer and traveler JWT cannot claim jobs or invoke mail provider',async()=>{
  const {createMailWorker}=await api,q=queue([job()]);let sends=0;
  const handle=createMailWorker({envGet:get(baseEnv),rpc:q.rpc,providerFactory:()=>({send:async()=>{sends++;}})});
  for(const token of ['wrong-secret-012345678901234567890123456','eyJhbGciOiJIUzI1NiJ9.user-data.signature','']) assert.equal((await handle(request(token))).status,401);
  assert.equal(q.calls.length,0);assert.equal(sends,0);
});

test('Vault fallback uses protected config RPC; wrong bearer stops before claim',async()=>{
  const {createMailWorker}=await api,q=queue([]),env={...baseEnv,JOURNEYHUB_AGENT_WORKER_SECRET:''};
  const handle=createMailWorker({envGet:get(env),rpc:q.rpc});
  assert.equal((await handle(request('wrong-secret-012345678901234567890123456'))).status,401);
  assert.deepEqual(q.calls.map(c=>c.name),['journeyhub_agent_worker_config']);
  assert.equal((await handle(request())).status,200);
});

test('configuration readiness discloses names only and never claims a job when missing',async()=>{
  const {getMailReadiness,createMailWorker}=await api;
  for(const patch of [{RESEND_API_KEY:''},{JOURNEYHUB_MAIL_PROVIDER:'smtp'},{JOURNEYHUB_MAIL_FROM:'Bad\r\nBcc: person@example.invalid'},{JOURNEYHUB_MAIL_PROVIDER:''}]) {
    const env={...baseEnv,...patch},q=queue([job()]);
    const ready=getMailReadiness(get(env));assert.equal(ready.ready,false);assert(ready.missing.length);
    const handle=createMailWorker({envGet:get(env),rpc:q.rpc});const response=await handle(request());
    assert.equal(response.status,503);assert.equal(q.calls.length,0);
    assert(!(await response.text()).includes('test-not-a-real-key'));
  }
});

test('authenticated health probe never claims or sends',async()=>{
  const {createMailWorker}=await api,q=queue([job()]);
  const handle=createMailWorker({envGet:get(baseEnv),rpc:q.rpc});
  const response=await handle(new Request('https://edge.example.invalid/mail?health=1',{method:'POST',headers:{Authorization:'Bearer '+SECRET}}));
  assert.equal(response.status,200);assert.equal((await response.json()).ready,true);assert.equal(q.calls.length,0);
});

test('English template uses frozen local time, escapes HTML, and suppresses unsafe links',async()=>{
  const {renderBookingEmail}=await api,s=job();s.snapshot.experience_title='<img src=x onerror=alert(1)> & Tea';s.snapshot.traveler_name='<Alex>';s.snapshot.address='A "quoted" address';
  const rendered=renderBookingEmail(s,{from:baseEnv.JOURNEYHUB_MAIL_FROM,appUrl:'javascript:alert(1)'});
  assert(rendered.html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; Tea'));assert(!rendered.html.includes('<img'));assert(rendered.html.includes('&lt;Alex&gt;'));
  assert(rendered.text.includes('17:00'));assert(rendered.text.includes('Asia/Shanghai'));assert(rendered.text.includes('1 November 2026'));assert(!rendered.html.includes('javascript:'));
  assert.deepEqual(rendered.to,['traveler@example.invalid']);assert(rendered.subject.startsWith('Booking confirmed:'));
  assert.equal(renderBookingEmail({...s,template:'booking_reminder'},{from:baseEnv.JOURNEYHUB_MAIL_FROM}).subject.slice(0,9),'Reminder:');
});

test('unconfirmed bookings, unverified recipients, and invalid time zones never send',async()=>{
  const {createMailWorker}=await api;
  const jobs=[job({booking_status:'failed'}),job({id:'33333333-3333-4333-8333-333333333333',verified_email:false}),job({id:'44444444-4444-4444-8444-444444444444',snapshot:{...job().snapshot,time_zone:'not/a-zone'}})];
  const q=queue(jobs);let sends=0;
  const handle=createMailWorker({envGet:get(baseEnv),rpc:q.rpc,providerFactory:()=>({send:async()=>{sends++;}})});
  const result=await(await handle(request())).json();assert.equal(sends,0);assert.equal(result.failed,3);assert(q.finishes().every(f=>f.p_outcome==='failed'));
});

test('worker ignores caller recipient/payload and reports provider acceptance, not delivery',async()=>{
  const {createMailWorker}=await api,q=queue([job()]),sent=[];
  const handle=createMailWorker({envGet:get(baseEnv),rpc:q.rpc,providerFactory:()=>({send:async(message,id)=>{sent.push({message,id});return{outcome:'sent',providerId:'provider-id',error:null,retryAfterSeconds:0};}})});
  const result=await(await handle(request(SECRET,{to_email:'attacker@example.invalid',snapshot:{starts_at:'2099-01-01T00:00:00Z'},limit:100}))).json();
  assert.deepEqual(sent[0].message.to,['traveler@example.invalid']);assert(sent[0].message.text.includes('1 November 2026'));
  assert.equal(result.accepted,1);assert.equal(result.delivered,undefined);assert.equal(q.calls.find(c=>c.name==='journeyhub_agent_claim_mail').args.p_limit,3);
  assert.equal(q.finishes()[0].p_lease_token,job().lease_token);
});

test('Resend adapter retries only HTTP 429/5xx; other client errors are terminal',async()=>{
  const {createResendAdapter}=await api;
  for(const [status,outcome] of [[429,'retry'],[500,'retry'],[503,'retry'],[400,'failed'],[409,'failed'],[422,'failed'],[401,'config_missing'],[403,'config_missing']]) {
    let calls=0;
    const adapter=createResendAdapter({apiKey:'fake',fetchImpl:async()=>{calls++;return reply({message:'Do not expose this secret'},status,{'Retry-After':'999999'});}});
    const result=await adapter.send({subject:'test'},job().id);assert.equal(result.outcome,outcome,'status '+status);assert.equal(calls,1);assert(!JSON.stringify(result).includes('Do not expose'));assert(result.retryAfterSeconds<=3600);
  }
});

test('timeouts/ambiguous success do not automatically resend',async()=>{
  const {createResendAdapter}=await api;let aborted=false,calls=0;
  const adapter=createResendAdapter({apiKey:'fake',timeoutMs:10,fetchImpl:async(_url,init)=>{calls++;init.signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});}});
  assert.equal((await adapter.send({},job().id)).error,'provider_delivery_unknown');assert.equal(calls,1);assert.equal(aborted,true);
  const malformed=createResendAdapter({apiKey:'fake',fetchImpl:async()=>reply({ok:true})});
  assert.equal((await malformed.send({},job().id)).outcome,'failed');
  const hangingBody=createResendAdapter({apiKey:'fake',timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({start(){}}),{status:200})});
  assert.equal((await hangingBody.send({},job().id)).error,'provider_acceptance_unverified');
});

test('provider credentials rejected: release all leases without consuming retry budget',async()=>{
  const {createMailWorker}=await api,jobs=[job(),job({id:'33333333-3333-4333-8333-333333333333'})],q=queue(jobs);let sends=0;
  const handle=createMailWorker({envGet:get(baseEnv),rpc:q.rpc,providerFactory:()=>({send:async()=>{sends++;return{outcome:'config_missing',providerId:null,error:'provider_credentials_or_sender_rejected',retryAfterSeconds:900};}})});
  const result=await(await handle(request())).json();assert.equal(sends,1);assert.equal(result.configurationBlocked,2);assert(q.finishes().every(f=>f.p_outcome==='config_missing'));
});

test('stable idempotency key and identical frozen content survive an unsettled lease',async()=>{
  const {createMailWorker,createResendAdapter}=await api;const calls=[],stored=new Map();let actualSends=0;
  const fetchImpl=async(url,init)=>{
    assert.equal(url,'https://api.resend.com/emails');assert.equal(init.redirect,'error');
    const key=init.headers['Idempotency-Key'];calls.push({key,body:init.body});
    if(!stored.has(key)){stored.set(key,init.body);actualSends++;}else assert.equal(stored.get(key),init.body);
    return reply({id:'accepted-one'});
  };
  const provider=createResendAdapter({apiKey:'fake',fetchImpl});
  const first=createMailWorker({envGet:get(baseEnv),rpc:queue([job()],{finishFails:true}).rpc,providerFactory:()=>provider});
  const failed=await first(request());assert.equal(failed.status,503);assert.equal((await failed.json()).accepted,0);
  const nextJob=job({lease_token:'99999999-9999-4999-8999-999999999999'});
  const next=createMailWorker({envGet:get(baseEnv),rpc:queue([nextJob]).rpc,providerFactory:()=>provider});
  assert.equal((await next(request())).status,200);assert.equal(actualSends,1);assert.equal(calls.length,2);assert.equal(calls[0].key,'journeyhub-mail/'+job().id);
});

test('queue cannot exceed the bounded batch',async()=>{
  const {createMailWorker}=await api,q=queue([job(),job(),job(),job()]);let sends=0;
  const handle=createMailWorker({envGet:get(baseEnv),rpc:q.rpc,providerFactory:()=>({send:async()=>{sends++;}})});
  assert.equal((await handle(request())).status,502);assert.equal(sends,0);
});

test('service RPC uses new secret keys only as apikey; legacy JWT retains bearer compatibility',async()=>{
  const {createMailWorker}=await api;
  for(const modern of [true,false]) {
    const key=modern?'sb_secret_mock-key':'legacy-service-role-mock-key';
    const env={...baseEnv,SUPABASE_URL:'https://db.example.invalid',...(modern?{SUPABASE_SECRET_KEYS:JSON.stringify({default:key})}:{SUPABASE_SERVICE_ROLE_KEY:key})};
    let rpcCalls=0;
    const fetchImpl=async(url,init)=>{rpcCalls++;assert.equal(url,'https://db.example.invalid/rest/v1/rpc/journeyhub_agent_claim_mail');assert.equal(init.headers.apikey,key);assert.equal(init.headers.Authorization,modern?undefined:'Bearer '+key);return reply([]);};
    const response=await createMailWorker({envGet:get(env),fetchImpl})(request());assert.equal(response.status,200);assert.equal(rpcCalls,1);
  }
});

test('non-POST requests do not perform work',async()=>{
  const {createMailWorker}=await api,q=queue([job()]);
  assert.equal((await createMailWorker({envGet:get(baseEnv),rpc:q.rpc})(new Request('https://edge.example.invalid/mail'))).status,405);assert.equal(q.calls.length,0);
});

test('SMTP 465 requires verified TLS; 587 requires STARTTLS and explicit non-hosted runtime',async()=>{
  const {getMailReadiness}=await api,{smtpTransportOptions}=await smtpApi;
  assert.equal(getMailReadiness(get(smtpEnv)).ready,true);
  const implicit=smtpTransportOptions(get(smtpEnv));
  assert.equal(implicit.secure,true);assert.equal(implicit.tls.rejectUnauthorized,true);assert.equal(implicit.tls.minVersion,'TLSv1.2');assert.equal(implicit.pool,false);assert.equal(implicit.maxRecipients,1);
  assert.equal(implicit.disableFileAccess,true);assert.equal(implicit.disableUrlAccess,true);assert.equal(implicit.debug,false);
  const blocked={...smtpEnv,SMTP_PORT:'587'};
  assert(getMailReadiness(get(blocked)).missing.includes('SMTP_PORT_587_BLOCKED_ON_SUPABASE_HOSTED'));
  assert.throws(()=>smtpTransportOptions(get(blocked)),/smtp_port_blocked/);
  const starttls=smtpTransportOptions(get({...blocked,JOURNEYHUB_SMTP_RUNTIME:'self_hosted'}));
  assert.equal(starttls.secure,false);assert.equal(starttls.requireTLS,true);assert.equal(starttls.ignoreTLS,false);assert.equal(starttls.opportunisticTLS,false);
  for(const patch of [{SMTP_HOST:'smtp://evil.test'},{SMTP_PORT:'25'},{SMTP_PASSWORD:''},{SMTP_USER:''}])assert.equal(getMailReadiness(get({...smtpEnv,...patch})).ready,false);
});

test('SMTP accepts only the intended recipient, uses stable Message-ID without claiming idempotency',async()=>{
  const {renderBookingEmail}=await api,{createSmtpAdapter}=await smtpApi;let sent,closed=0;
  const adapter=createSmtpAdapter({envGet:get(smtpEnv),createTransport:()=>({sendMail:async value=>{sent=value;return{accepted:['traveler@example.invalid'],rejected:[]};},close(){closed++;}})});
  const result=await adapter.send(renderBookingEmail(job(),{from:smtpEnv.JOURNEYHUB_MAIL_FROM}),job().id);
  assert.equal(result.outcome,'sent');assert.equal(sent.messageId,'<journeyhub-'+job().id+'@example.invalid>');assert.equal(result.providerId,sent.messageId);assert.equal(closed,1);
  const partial=createSmtpAdapter({envGet:get(smtpEnv),createTransport:()=>({sendMail:async()=>({accepted:[],rejected:['traveler@example.invalid']}),close(){}})});
  assert.equal((await partial.send(sent,job().id)).error,'smtp_acceptance_unverified');
});

test('SMTP retries only proven pre-DATA failures; post-DATA/ambiguous errors are terminal',async()=>{
  const {classifySmtpError}=await smtpApi;
  for(const error of [{code:'EDNS',command:'CONN'},{code:'ETIMEDOUT',command:'CONN'},{responseCode:450,command:'RCPT TO'}])assert.equal(classifySmtpError(error).outcome,'retry');
  for(const error of [{code:'EAUTH',command:'AUTH LOGIN',responseCode:535},{code:'ETLS',command:'STARTTLS'}])assert.equal(classifySmtpError(error).outcome,'config_missing');
  for(const error of [{code:'ETIMEDOUT',command:'DATA'},{code:'ECONNECTION',command:'DATA'},{code:'ECONNECTION'},{responseCode:451,command:'DATA'},new Error('Unknown')]) {
    assert.equal(classifySmtpError(error).outcome,'failed');assert.equal(classifySmtpError(error).error,'smtp_delivery_unknown');
  }
  assert.equal(classifySmtpError({responseCode:550,command:'RCPT TO'}).outcome,'failed');
});

test('SMTP total timeout closes the transport and never returns automatic retry',async()=>{
  const {createSmtpAdapter}=await smtpApi;let closed=0;
  const adapter=createSmtpAdapter({envGet:get(smtpEnv),timeoutMs:10,createTransport:()=>({sendMail:()=>new Promise(()=>{}),close(){closed++;}})});
  const result=await adapter.send({from:smtpEnv.JOURNEYHUB_MAIL_FROM,to:['traveler@example.invalid']},job().id);
  assert.equal(result.outcome,'failed');assert.equal(result.error,'smtp_delivery_unknown');assert(closed>=1);
});

test('SMTP provider is durably declared at claim; no fallback provider is silently used',async()=>{
  const {createMailWorker}=await api,q=queue([job()]);
  const handle=createMailWorker({envGet:get(smtpEnv),rpc:q.rpc,providerFactory:async name=>{assert.equal(name,'smtp');return{send:async()=>({outcome:'failed',error:'smtp_delivery_unknown',providerId:null,retryAfterSeconds:0})};}});
  const result=await(await handle(request())).json();assert.equal(result.failed,1);assert.equal(q.calls.find(c=>c.name==='journeyhub_agent_claim_mail').args.p_provider,'smtp');assert.equal(q.finishes()[0].p_outcome,'failed');
  const unavailable=queue([job()]);const response=await createMailWorker({envGet:get(smtpEnv),rpc:unavailable.rpc})(request());
  assert.equal(response.status,503);assert.equal(unavailable.calls.length,0);
});

test('SMTP custom transport actually closes the active socket and prevents later DATA',async()=>{
  const {createCancellableSmtpTransport}=await smtpApi,{EventEmitter}=require('node:events');
  let connection,callback,sendCalls=0,closeCalls=0;
  class FakeConnection extends EventEmitter {
    constructor(){super();connection=this;}
    connect(done){this.connected=done;}
    login(_auth,done){done();}
    send(){sendCalls++;}
    close(){closeCalls++;this.emit('end');}
  }
  const plugin=createCancellableSmtpTransport({options:{auth:{}},SMTPConnection:FakeConnection,createTransport:value=>value});
  plugin.send({message:{messageId:()=>'<test@example.invalid>',getEnvelope:()=>({}),createReadStream:()=>null}},error=>{callback=error;});
  plugin.close();assert.equal(closeCalls,1);assert.equal(callback.code,'ECONNECTION');
  connection.connected();assert.equal(sendCalls,0);
});
