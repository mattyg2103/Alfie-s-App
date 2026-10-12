const nodemailer = require("nodemailer");

// Any SMTP account works (Gmail with an app password, Outlook, Brevo, Resend's
// SMTP relay, ...). Reset emails are disabled until SMTP_HOST, SMTP_USER and
// SMTP_PASS are set on the server.
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;

const emailConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

const transport = emailConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

async function sendPasswordResetEmail(to, link) {
  const text = [
    "Hello,",
    "",
    "Someone asked to reset the password for your My Voice and Safe Space parent account.",
    "To choose a new password, open this link (it works once, for the next hour):",
    "",
    link,
    "",
    "If this wasn't you, you can ignore this email — your password won't change.",
  ].join("\n");
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#1f2937;max-width:520px">
      <p>Hello,</p>
      <p>Someone asked to reset the password for your <strong>My Voice and Safe Space</strong> parent account.</p>
      <p><a href="${link}" style="display:inline-block;background:#ff6b4a;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Choose a new password</a></p>
      <p style="color:#6b7280;font-size:14px">This link works once, for the next hour. If this wasn't you, you can ignore this email — your password won't change.</p>
    </div>`;
  await transport.sendMail({ from: EMAIL_FROM || SMTP_USER, to, subject: "Reset your My Voice and Safe Space password", text, html });
}

module.exports = { emailConfigured, sendPasswordResetEmail };
