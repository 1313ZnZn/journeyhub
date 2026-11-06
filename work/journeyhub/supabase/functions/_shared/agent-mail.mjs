/** Provider-independent JourneyHub mail worker. No browser imports or runtime dependencies.
 * RPCs are service-role-only; the inbound bearer is a separate worker secret.
 * Resend HTTP contract: https://resend.com/docs/api-reference/emails/send-email
 * Idempotency retention (24h): https://resend.com/docs/dashboard/emails/idempotency-keys
 */
const MAX_JOBS = 3;
const RPC_TIMEOUT_MS = 5000;
const PROVIDER_TIMEOUT_MS = 8000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RPC_NAMES = new Set(['journeyhub_agent_worker_config', 'journeyhub_agent_claim_mail', 'journeyhub_agent_finish_mail']);
const envValue = (get, name) => String(get(name) || '').trim();
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,63}$/i.test(value);
}

function validSender(value) {
  if (!value || value.length > 320 || /[\r\n\x00]/.test(value)) return false;
  const match = value.match(/^[^<>]+<([^<>]+)>$/);
  return validEmail(match ? match[1].trim() : value);
}

/** Safe for a user-facing health endpoint: returns field names, never values/secrets. */
export function getMailReadiness(envGet) {
  const provider = envValue(envGet, 'JOURNEYHUB_MAIL_PROVIDER').toLowerCase();
  const missing = [];
  if (!provider) missing.push('JOURNEYHUB_MAIL_PROVIDER');
  else if (!['resend','smtp'].includes(provider)) missing.push('provider_adapter');
  if (provider === 'resend' && !envValue(envGet, 'RESEND_API_KEY')) missing.push('RESEND_API_KEY');
  if (provider === 'smtp') {
    const host=envValue(envGet,'SMTP_HOST'),port=envValue(envGet,'SMTP_PORT');
    if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(host)) missing.push('SMTP_HOST');
    if (!['465','587'].includes(port)) missing.push('SMTP_PORT');
    if (port==='587' && envValue(envGet,'JOURNEYHUB_SMTP_RUNTIME')!=='self_hosted') missing.push('SMTP_PORT_587_BLOCKED_ON_SUPABASE_HOSTED');
    if (!envValue(envGet,'SMTP_USER')) missing.push('SMTP_USER');
    if (!envValue(envGet,'SMTP_PASSWORD')) missing.push('SMTP_PASSWORD');
  }
  if (!validSender(envValue(envGet, 'JOURNEYHUB_MAIL_FROM'))) missing.push('JOURNEYHUB_MAIL_FROM');
  return {ready:missing.length === 0, provider: /^[a-z0-9_-]{1,40}$/.test(provider) ? provider : null, missing};
}

function safeAppUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|\[?::1)/i.test(url.hostname)) return '';
    return url.toString();
  } catch { return ''; }
}

function nonempty(value, max = 500) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00]/.test(value);
}

/** All job fields must come from the claimed, frozen database snapshot. */
export function validateMailJob(job) {
  if (!job || !UUID.test(job.id || '') || !UUID.test(job.lease_token || '')) return 'invalid_job_identity';
  if (job.booking_status !== 'confirmed') return 'booking_not_confirmed';
  if (job.verified_email !== true || !validEmail(job.to_email)) return 'recipient_not_verified';
  if (!['booking_confirmation','booking_reminder'].includes(job.template)) return 'unsupported_mail_template';
  const snapshot = job.snapshot;
  if (!snapshot || !nonempty(snapshot.booking_id,128) || !nonempty(snapshot.session_id,128) || !nonempty(snapshot.experience_title,500)) return 'invalid_booking_snapshot';
  if (!nonempty(snapshot.starts_at,80) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(snapshot.starts_at) || !Number.isFinite(Date.parse(snapshot.starts_at))) return 'invalid_booking_time';
  if (!Number.isInteger(snapshot.party_size) || snapshot.party_size < 1 || snapshot.party_size > 100) return 'invalid_party_size';
  if (!nonempty(snapshot.time_zone,80)) return 'invalid_time_zone';
  try {new Intl.DateTimeFormat('en-GB',{timeZone:snapshot.time_zone}).format(new Date(snapshot.starts_at));} catch {return 'invalid_time_zone';}
  for (const name of ['venue_name','address','traveler_name','booking_reference']) {
    if (snapshot[name] != null && (typeof snapshot[name] !== 'string' || snapshot[name].length > 1500)) return 'invalid_booking_snapshot';
  }
  return null;
}

/** Deterministic English HTML/plaintext: no current clock or client-supplied links. */
export function renderBookingEmail(job, {from, appUrl = ''}) {
  const invalid = validateMailJob(job);
  if (invalid) throw new Error(invalid);
  if (!validSender(from)) throw new Error('mail_sender_not_configured');
  const s = job.snapshot, reminder = job.template === 'booking_reminder';
  const title = reminder ? 'Your experience is coming up' : 'Your booking is confirmed';
  const intro = reminder ? 'Here are the details of your confirmed experience.' : 'Your place is reserved. Keep these details for your visit.';
  const date = new Intl.DateTimeFormat('en-GB',{timeZone:s.time_zone,weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}).format(new Date(s.starts_at));
  const details = [
    ['Experience',s.experience_title], ['Date and time',date + ' (' + s.time_zone + ')'],
    ['Guests',String(s.party_size)], ['Booking reference',s.booking_reference || s.booking_id]
  ];
  if (s.venue_name) details.push(['Meeting place',s.venue_name]);
  if (s.address) details.push(['Address',s.address]);
  const greeting = s.traveler_name ? 'Hi ' + s.traveler_name + ',' : 'Hello,';
  const link = safeAppUrl(appUrl);
  const text = [title,'',greeting,intro,'',...details.map(([label,value])=>label + ': ' + value),'',
    'Please review the meeting place and arrive before the scheduled start.',
    ...(link ? ['', 'Open JourneyHub: ' + link] : []), '', 'JourneyHub', 'This message relates to your confirmed booking.'].join('\n');
  const rows = details.map(([label,value])=>'<tr><td style="padding:10px 0;vertical-align:top;color:#718074;width:32%">'+escapeHtml(label)+'</td><td style="padding:10px 0;vertical-align:top;color:#253e31;font-weight:600">'+escapeHtml(value)+'</td></tr>').join('');
  const html = '<!doctype html><html lang="en"><body style="margin:0;background:#f4f5ef;color:#253e31;font-family:Arial,Helvetica,sans-serif">'+
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border-radius:20px;overflow:hidden">'+
    '<tr><td style="background:#244b3a;color:#fff;padding:28px 32px;font-size:24px;font-weight:700">JourneyHub</td></tr><tr><td style="padding:28px 32px">'+
    '<h1 style="font-size:25px;line-height:1.25;margin:0 0 24px">'+title+'</h1><p>'+escapeHtml(greeting)+'</p><p style="line-height:1.6">'+intro+'</p>'+
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;border-top:1px solid #e5eadf;margin:24px 0">'+rows+'</table>'+
    '<p style="font-size:14px;line-height:1.6;color:#718074">Please review the meeting place and arrive before the scheduled start.</p>'+
    (link ? '<p style="margin-top:28px"><a href="'+escapeHtml(link)+'" style="display:inline-block;background:#244b3a;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Open JourneyHub</a></p>' : '')+
    '</td></tr><tr><td style="padding:20px 32px;background:#fafbf7;font-size:12px;color:#718074">This message relates to your confirmed booking.</td></tr></table></td></tr></table></body></html>';
  return {from,to:[job.to_email],subject:((reminder?'Reminder: ':'Booking confirmed: ')+s.experience_title).replace(/[\r\n]/g,' ').slice(0,200),html,text};
}

async function timedFetch(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      fetchImpl(url,{...init,signal:controller.signal,redirect:'error'}),
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('request_timeout'));},timeoutMs);})
    ]);
  } finally {clearTimeout(timer);}
}

async function limitedJson(response, timeoutMs=5000) {
  if (Number(response.headers.get('content-length')) > 65536) throw new Error('invalid_response');
  if (!response.body) throw new Error('invalid_response');
  const reader=response.body.getReader();
  let timer,done=false;
  try {
    return await Promise.race([
      (async()=>{
        const decoder=new TextDecoder();let text='',size=0;
        while(true) {
          const part=await reader.read();
          if(part.done) break;
          size+=part.value.byteLength;
          if(size>65536) throw new Error('invalid_response');
          text+=decoder.decode(part.value,{stream:true});
        }
        text+=decoder.decode();done=true;return JSON.parse(text);
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('response_timeout')),timeoutMs);})
    ]);
  } finally {clearTimeout(timer);if(!done) void reader.cancel().catch(()=>{});}
}

function retryDelay(response) {
  const raw=response.headers.get('retry-after'), seconds=Number(raw);
  // Cap retry hints. The database supplies bounded exponential backoff otherwise.
  return raw && Number.isFinite(seconds) ? Math.min(3600,Math.max(30,Math.ceil(seconds))) : 60;
}

/** Isolated provider adapter. Other providers can be added without changing job semantics. */
export function createResendAdapter({apiKey,fetchImpl=fetch,timeoutMs=PROVIDER_TIMEOUT_MS}) {
  return {async send(message,jobId) {
    let response;
    try {
      response=await timedFetch(fetchImpl,'https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':'journeyhub-mail/'+jobId},body:JSON.stringify(message)},timeoutMs);
    } catch {
      // A timeout can occur after acceptance: stop and request review, never blindly resend.
      return {outcome:'failed',error:'provider_delivery_unknown',providerId:null,retryAfterSeconds:0};
    }
    if (response.status===429 || response.status>=500) return {outcome:'retry',error:'provider_http_'+response.status,providerId:null,retryAfterSeconds:retryDelay(response)};
    if (response.status===401 || response.status===403) return {outcome:'config_missing',error:'provider_credentials_or_sender_rejected',providerId:null,retryAfterSeconds:900};
    if (!response.ok) return {outcome:'failed',error:'provider_http_'+response.status,providerId:null,retryAfterSeconds:0};
    try {
      const result=await limitedJson(response,timeoutMs);
      if (typeof result.id!=='string' || !/^[a-z0-9_-]{1,128}$/i.test(result.id)) throw new Error('missing_id');
      return {outcome:'sent',error:null,providerId:result.id,retryAfterSeconds:0};
    } catch {return {outcome:'failed',error:'provider_acceptance_unverified',providerId:null,retryAfterSeconds:0};}
  }};
}

function databaseConfig(envGet) {
  let key='';
  try {key=JSON.parse(envValue(envGet,'SUPABASE_SECRET_KEYS') || '{}').default || '';} catch { /* legacy fallback */ }
  key=key || envValue(envGet,'SUPABASE_SERVICE_ROLE_KEY');
  const raw=envValue(envGet,'SUPABASE_URL');
  try {
    const url=new URL(raw);
    if (!key || url.protocol!=='https:' || url.username || url.password) return null;
    return {url:url.origin,key};
  } catch {return null;}
}

function createRpc(config,fetchImpl) {
  return async (name,payload={})=>{
    if (!RPC_NAMES.has(name)) throw new Error('rpc_not_allowed');
    const headers={'Content-Type':'application/json',apikey:config.key};
    // New secret API keys go only in apikey; legacy service-role JWTs also use Bearer.
    if (!config.key.startsWith('sb_secret_')) headers.Authorization='Bearer '+config.key;
    const response=await timedFetch(fetchImpl,config.url+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(payload)},RPC_TIMEOUT_MS);
    if (!response.ok) throw new Error('database_rpc_failed');
    return limitedJson(response);
  };
}

async function sameSecret(left,right) {
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(left)),crypto.subtle.digest('SHA-256',encoder.encode(right))]);
  const x=new Uint8Array(a),y=new Uint8Array(b);let mismatch=0;
  for(let i=0;i<x.length;i++) mismatch |= x[i]^y[i];
  return mismatch===0;
}

/** The request body is deliberately ignored: callers cannot choose recipients or bookings.
 * @param {{envGet:(name:string)=>string|undefined,fetchImpl?:typeof fetch,rpc?:(name:string,payload?:object)=>Promise<any>,providerFactory?:(provider:string)=>any}} options
 */
export function createMailWorker({envGet,fetchImpl=fetch,rpc:injectedRpc,providerFactory} = {}) {
  if (typeof envGet!=='function') throw new Error('env_get_required');
  return async function handleMail(request) {
    if (request.method!=='POST') return json({error:'method_not_allowed'},405);
    const bearer=request.headers.get('Authorization')?.match(/^Bearer ([^\s]{32,256})$/i)?.[1];
    if (!bearer) return json({error:'unauthorized'},401);
    const db=databaseConfig(envGet);
    if (!db && !injectedRpc) return json({error:'worker_not_configured'},503);
    const rpc=injectedRpc || createRpc(db,fetchImpl);
    let secret=envValue(envGet,'JOURNEYHUB_AGENT_WORKER_SECRET');
    if (!secret) {
      try {secret=(await rpc('journeyhub_agent_worker_config'))?.worker_secret || '';} catch {return json({error:'worker_not_configured'},503);}
    }
    if (typeof secret!=='string' || secret.length<32 || secret.length>256) return json({error:'worker_not_configured'},503);
    if (!await sameSecret(bearer,secret)) return json({error:'unauthorized'},401);
    const readiness=getMailReadiness(envGet);
    if (new URL(request.url).searchParams.get('health')==='1') return json(readiness);
    // Do not lease jobs or spend a retry when the provider has not been configured.
    if (!readiness.ready) return json({error:'mail_not_configured',...readiness},503);
    const config={from:envValue(envGet,'JOURNEYHUB_MAIL_FROM'),appUrl:envValue(envGet,'JOURNEYHUB_APP_URL') || envValue(envGet,'APP_URL')};
    let provider;
    try {
      if (providerFactory) provider=await providerFactory(readiness.provider);
      else if (readiness.provider==='resend') provider=createResendAdapter({apiKey:envValue(envGet,'RESEND_API_KEY'),fetchImpl});
      if (!provider || typeof provider.send!=='function') throw new Error('provider_adapter_missing');
    } catch {return json({error:'mail_adapter_unavailable'},503);}
    let jobs;
    try {jobs=await rpc('journeyhub_agent_claim_mail',{p_limit:MAX_JOBS,p_provider:readiness.provider});} catch {return json({error:'mail_queue_unavailable'},503);}
    if (!Array.isArray(jobs) || jobs.length>MAX_JOBS) return json({error:'invalid_mail_queue_response'},502);
    const counts={claimed:jobs.length,accepted:0,retry:0,failed:0,configurationBlocked:0,unsettled:0};
    let providerBlocked=false;
    for(const job of jobs) {
      // Malformed identity cannot safely address a lease. Let the database recover it.
      if (!job || !UUID.test(job.id || '') || !UUID.test(job.lease_token || '')) {counts.unsettled++;continue;}
      const invalid=validateMailJob(job);
      let result;
      if (invalid) result={outcome:'failed',error:invalid,providerId:null,retryAfterSeconds:0};
      else if (providerBlocked) result={outcome:'config_missing',error:'provider_configuration_blocked',providerId:null,retryAfterSeconds:900};
      else {
        try {result=await provider.send(renderBookingEmail(job,config),job.id);} catch {result={outcome:'failed',error:'provider_delivery_unknown',providerId:null,retryAfterSeconds:0};}
      }
      if (result.outcome==='config_missing') providerBlocked=true;
      try {
        const finished=await rpc('journeyhub_agent_finish_mail',{p_job_id:job.id,p_lease_token:job.lease_token,p_outcome:result.outcome,p_provider_id:result.providerId,p_error:result.error,p_retry_after_seconds:result.retryAfterSeconds});
        if (!finished?.ok) throw new Error('lease_not_settled');
        if (result.outcome==='sent') counts.accepted++;
        else if (result.outcome==='config_missing') counts.configurationBlocked++;
        else counts[result.outcome]++;
      } catch {counts.unsettled++;}
    }
    // Accepted means the provider queued the email; delivery needs provider webhooks.
    return json({ok:counts.unsettled===0,provider:readiness.provider,...counts},counts.unsettled?503:200);
  };
}
