import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { SystemSettingsService } from './system-settings.service';

/**
 * Minimal SMTP mailer driven by SystemSettingsService (DB-over-env config).
 * Used today for the Admin "send test email" check and available for future
 * transactional mail (member invites, reconciliation alerts, etc.).
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);

  constructor(private readonly settings: SystemSettingsService) {}

  get configured(): boolean {
    const c = this.settings.smtp();
    return !!(c.host && c.fromEmail);
  }

  private transport() {
    const c = this.settings.smtp();
    if (!c.host) throw new BadRequestException('SMTP host is not configured.');
    return createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: c.username ? { user: c.username, pass: c.password } : undefined,
    });
  }

  async send(to: string, subject: string, text: string) {
    const c = this.settings.smtp();
    if (!c.fromEmail) {
      throw new BadRequestException('SMTP "from" address is not configured.');
    }
    const info = await this.transport().sendMail({
      from: c.fromName ? `${c.fromName} <${c.fromEmail}>` : c.fromEmail,
      to,
      subject,
      text,
    });
    this.log.log(`Sent mail to ${to} (id ${info.messageId})`);
    return { messageId: info.messageId };
  }

  async sendWithAttachment(
    to: string,
    subject: string,
    text: string,
    attachments: { filename: string; content: Buffer; contentType?: string }[],
  ) {
    const c = this.settings.smtp();
    if (!c.fromEmail) {
      throw new BadRequestException('SMTP "from" address is not configured.');
    }
    const info = await this.transport().sendMail({
      from: c.fromName ? `${c.fromName} <${c.fromEmail}>` : c.fromEmail,
      to,
      subject,
      text,
      attachments,
    });
    this.log.log(`Sent mail+attachment to ${to} (id ${info.messageId})`);
    return { messageId: info.messageId };
  }

  async sendTest(to: string) {
    if (!to?.trim()) throw new BadRequestException('A recipient email is required.');
    await this.send(
      to.trim(),
      'OpenBooks SMTP test',
      'This is a test email from OpenBooks. If you received it, your SMTP settings are working.',
    );
    return { sent: true, to: to.trim() };
  }
}
