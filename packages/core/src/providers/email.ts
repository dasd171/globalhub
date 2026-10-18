export type EmailResult = { status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED'; error?: string };
export interface EmailProvider { readonly name: string; send(msg: { to: string; subject: string; text: string }): Promise<EmailResult> }

/** No email configured: report NOT_CONFIGURED honestly instead of pretending it was sent. */
export class NoEmailProvider implements EmailProvider {
  readonly name = 'none';
  async send(): Promise<EmailResult> { return { status: 'NOT_CONFIGURED' }; }
}

/** Development: write the email to the log. Still reported as NOT_CONFIGURED (nothing was delivered). */
export class LogEmailProvider implements EmailProvider {
  readonly name = 'log';
  constructor(private log: (msg: string) => void = console.log) {}
  async send(m: { to: string; subject: string; text: string }): Promise<EmailResult> {
    this.log(`[email:log] to=${m.to} subject="${m.subject}"\n${m.text}`);
    return { status: 'NOT_CONFIGURED' };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  constructor(private apiKey: string, private from: string) {}
  async send(m: { to: string; subject: string; text: string }): Promise<EmailResult> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text }), signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? { status: 'SENT' } : { status: 'FAILED', error: `HTTP ${res.status}` };
    } catch (e) {
      return { status: 'FAILED', error: (e as Error).message };
    }
  }
}
