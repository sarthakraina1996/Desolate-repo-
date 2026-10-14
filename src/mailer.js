import nodemailer from 'nodemailer';

// Returns { configured, from, send(message) }. When SMTP is not set up the app still
// runs; it just refuses to send and the UI shows a warning.
export function createMailer(smtp) {
  if (!smtp.host || !smtp.from) {
    return {
      configured: false,
      from: '',
      async send() {
        throw new Error('Email is not configured. Add your SMTP settings to the .env file and restart the app.');
      },
    };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  return {
    configured: true,
    from: smtp.from,
    async send({ to, subject, html, text, replyTo, fromName }) {
      // Show the business name as the sender unless MAIL_FROM already includes a name.
      const from = fromName && !smtp.from.includes('<') ? { name: fromName, address: smtp.from } : smtp.from;
      await transport.sendMail({ from, to, subject, html, text, replyTo: replyTo || undefined });
    },
  };
}
