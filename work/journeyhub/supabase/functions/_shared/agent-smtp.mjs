/** SMTP adapter with injected Nodemailer transport for isolated, network-free tests.
 * https://nodemailer.com/smtp — implicit TLS 465; mandatory STARTTLS on 587.
 * https://nodemailer.com/errors — error.command proves pre-DATA failures.
 * Hosted Supabase blocks 25/587; 587 is enabled only for an explicitly self-hosted runtime.
 * SMTP Message-ID is NOT an idempotency guarantee. Expired SMTP job leases must
 * be terminal delivery_unknown in the database, rather than automatically resent.
 */
const result=(outcome,error,providerId=null,retryAfterSeconds=0)=>({outcome,error,providerId,retryAfterSeconds});

/** A Nodemailer custom transport owns its SMTP connection so close() really aborts it.
 * The built-in non-pooled SMTP transport's close() only releases OAuth listeners.
 * Plugin contract: https://nodemailer.com/plugins/create
 * SMTPConnection is version-pinned with Nodemailer in the Edge entrypoint.
 */
export function createCancellableSmtpTransport({options,createTransport,SMTPConnection}) {
  let active=null,finish=null,closed=false;
  return createTransport({
    name:'JourneyHubSMTP',version:'1.0.0',
    send(mail,done) {
      if(closed) {done(Object.assign(new Error('smtp_closed'),{code:'ECONNECTION',command:'UNKNOWN'}));return;}
      const connection=new SMTPConnection(options);active=connection;let completed=false;
      const complete=(error,info)=>{
        if(completed)return;completed=true;active=null;finish=null;
        connection.close();
        done(error,error?undefined:{...info,messageId:mail.message.messageId()});
      };
      finish=complete;
      connection.once('error',complete);
      connection.once('end',()=>{if(!completed)complete(Object.assign(new Error('smtp_connection_ended'),{code:'ECONNECTION',command:'UNKNOWN'}));});
      connection.connect(error=>{
        if(completed)return;
        if(error){complete(error);return;}
        connection.login(options.auth,error=>{
          if(completed)return;
          if(error){complete(error);return;}
          connection.send(mail.message.getEnvelope(),mail.message.createReadStream(),complete);
        });
      });
    },
    close() {
      closed=true;
      // Mark the operation complete before closing so no later callback can start DATA.
      if(finish)finish(Object.assign(new Error('smtp_delivery_unknown'),{code:'ECONNECTION',command:'UNKNOWN'}));
      else if(active)active.close();
    }
  },{disableFileAccess:true,disableUrlAccess:true,maxRecipients:1});
}

export function smtpTransportOptions(envGet) {
  const host=String(envGet('SMTP_HOST') || '').trim(),port=Number(envGet('SMTP_PORT'));
  if (![465,587].includes(port) || !host) throw new Error('smtp_not_configured');
  if (port===587 && envGet('JOURNEYHUB_SMTP_RUNTIME')!=='self_hosted') throw new Error('smtp_port_blocked');
  return {
    host,port,secure:port===465,requireTLS:port===587,ignoreTLS:false,opportunisticTLS:false,
    auth:{user:envGet('SMTP_USER'),pass:envGet('SMTP_PASSWORD')},
    tls:{rejectUnauthorized:true,minVersion:'TLSv1.2',servername:host},
    pool:false,maxRecipients:1,disableFileAccess:true,disableUrlAccess:true,
    connectionTimeout:5000,greetingTimeout:5000,socketTimeout:8000,dnsTimeout:5000,
    logger:false,debug:false,transactionLog:false
  };
}

export function classifySmtpError(error) {
  const code=String(error?.code || ''),command=String(error?.command || '').toUpperCase();
  const responseCode=Number(error?.responseCode || 0);
  if (['EAUTH','ENOAUTH','EOAUTH2','ECONFIG','ETLS','EREQUIRETLS'].includes(code)) return result('config_missing','smtp_authentication_or_tls_configuration',null,900);
  // These commands occur before DATA. No message body can have been accepted.
  const preData=/^(CONN|CONNECT|EHLO|HELO|STARTTLS|AUTH(?: .*)?|MAIL FROM|RCPT TO)$/.test(command);
  if (preData && (responseCode>=400 && responseCode<500 || ['EDNS','ECONNECTION','ESOCKET','ETIMEDOUT'].includes(code))) return result('retry','smtp_pre_data_connection_failed',null,60);
  if (preData && responseCode>=500) return result('failed','smtp_recipient_or_envelope_rejected');
  // A documented explicit rejection is terminal; unclassified/connection failures
  // during or after DATA are ambiguous and must be reviewed without automatic resend.
  if (responseCode>=500 && responseCode<600) return result('failed','smtp_message_rejected');
  return result('failed','smtp_delivery_unknown');
}

export function createSmtpAdapter({envGet,createTransport,timeoutMs=12000}) {
  const options=smtpTransportOptions(envGet);
  return {async send(message,jobId) {
    let transport,timer,timedOut=false;
    try {
      transport=createTransport(options);
      const fromAddress=message.from.match(/<([^<>]+)>$/)?.[1] || message.from;
      const messageId='<journeyhub-'+jobId+'@'+fromAddress.split('@')[1]+'>';
      const response=await Promise.race([
        transport.sendMail({...message,messageId,disableFileAccess:true,disableUrlAccess:true}),
        new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;try{transport.close();}catch{}reject(new Error('smtp_delivery_unknown'));},timeoutMs);})
      ]);
      // Exactly one recipient is permitted. Partial/rejected delivery never appears successful.
      const accepted=(response?.accepted || []).map(value=>typeof value==='string'?value:value?.address);
      if (accepted.length!==1 || accepted[0]?.toLowerCase()!==message.to[0]?.toLowerCase() || response?.rejected?.length) return result('failed','smtp_acceptance_unverified');
      return result('sent',null,messageId);
    } catch(error) {return timedOut ? result('failed','smtp_delivery_unknown') : classifySmtpError(error);}
    finally {clearTimeout(timer);try{transport?.close();}catch{}}
  }};
}
