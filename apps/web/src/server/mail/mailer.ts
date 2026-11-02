/**
 * 送信の抽象化。既定は「送信箱に積み、mailto: リンクを返す」。SMTP_URL があれば nodemailer で送る。
 * 送信内容（宛先・件名・本文）は常に送信箱で確認できる。
 */
import type { MailVia } from "../../shared/requests.ts";

export type MailMessage = { to?: string | undefined; subject: string; text: string };
export type MailResult = {
  via: MailVia;
  mailtoUrl: string;
  sentAt?: string;
  messageId?: string;
  /** SMTP で送れなかったときの理由（送信箱には残る） */
  error?: string;
};

export interface Mailer {
  readonly via: MailVia;
  send(msg: MailMessage): Promise<MailResult>;
}

/** メールソフトで開くリンク */
export function mailtoUrl(msg: MailMessage): string {
  const q = new URLSearchParams();
  q.set("subject", msg.subject);
  q.set("body", msg.text);
  // URLSearchParams は空白を + にするので、mailto 向けに %20 へ
  const query = q.toString().replace(/\+/g, "%20");
  return `mailto:${encodeURIComponent(msg.to ?? "")}?${query}`;
}

/** 既定：送信箱に積むだけ（実際には送らない） */
export class OutboxMailer implements Mailer {
  readonly via = "outbox" as const;
  async send(msg: MailMessage): Promise<MailResult> {
    return { via: "outbox", mailtoUrl: mailtoUrl(msg) };
  }
}

export type SmtpOptions = { url: string; from: string };

/** SMTP_URL（例 smtp://user:pass@host:587）で送る。失敗しても例外にせず、送信箱に理由を残す */
export class SmtpMailer implements Mailer {
  readonly via = "smtp" as const;
  private readonly opts: SmtpOptions;
  constructor(opts: SmtpOptions) {
    this.opts = opts;
  }
  async send(msg: MailMessage): Promise<MailResult> {
    const mailto = mailtoUrl(msg);
    if (!msg.to) return { via: "outbox", mailtoUrl: mailto, error: "宛先がありません" };
    try {
      const { createTransport } = await import("nodemailer");
      const transport = createTransport(this.opts.url);
      const info = await transport.sendMail({
        from: this.opts.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
      });
      return {
        via: "smtp",
        mailtoUrl: mailto,
        sentAt: new Date().toISOString(),
        messageId: info.messageId,
      };
    } catch (e) {
      return {
        via: "outbox",
        mailtoUrl: mailto,
        error: `SMTP で送れませんでした：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

/** 環境変数から送信手段を選ぶ。SMTP_URL が無ければ送信箱 */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const url = env.SMTP_URL?.trim();
  if (!url) return new OutboxMailer();
  return new SmtpMailer({ url, from: env.MAIL_FROM?.trim() || "uchidai@localhost" });
}
