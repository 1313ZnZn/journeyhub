import nodemailer from 'npm:nodemailer@10.2.1';
import SMTPConnection from 'npm:nodemailer@10.2.1/lib/smtp-connection/index.js';
import { createMailWorker, createResendAdapter } from '../_shared/agent-mail.mjs';
import { createSmtpAdapter, createCancellableSmtpTransport } from '../_shared/agent-smtp.mjs';

// Deploy with verify_jwt=false. The handler validates a dedicated worker bearer,
// not a traveler JWT. Secrets stay in Edge Function environment / Supabase Vault.
const envGet = (name: string) => Deno.env.get(name);
Deno.serve(createMailWorker({
  envGet,
  providerFactory: (provider: string) => provider === 'smtp'
    ? createSmtpAdapter({envGet, createTransport: (options: object) => createCancellableSmtpTransport({options,createTransport:nodemailer.createTransport,SMTPConnection})})
    : createResendAdapter({apiKey: envGet('RESEND_API_KEY') || ''})
}));
