import { describeDaysUntil, formatLongDate } from './dates.js';

const CYCLE_LABELS = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

function detailRows(rows) {
  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `
      <tr>
        <td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;white-space:nowrap">${escapeHtml(label)}</td>
        <td style="padding:8px 12px;color:#0f172a;border-bottom:1px solid #e2e8f0;font-weight:600">${escapeHtml(value)}</td>
      </tr>`)
    .join('');
}

function layout({ heading, intro, rows, outro, footer }) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
    <tr><td style="background:#4f46e5;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:700">${heading}</td></tr>
    <tr><td style="padding:24px;color:#0f172a;font-size:15px;line-height:1.6">
      ${intro}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;font-size:14px">
        ${detailRows(rows)}
      </table>
      ${outro}
    </td></tr>
    <tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px">${footer}</td></tr>
  </table>
</body></html>`;
}

function textVersion(lines, rows) {
  return [
    ...lines.slice(0, 1),
    '',
    ...rows.filter(([, v]) => v).map(([label, value]) => `${label}: ${value}`),
    '',
    ...lines.slice(1),
  ].join('\n');
}

function commonRows(sub, renewalDate) {
  return [
    ['Software', sub.name],
    ['Plan', sub.plan],
    ['Vendor', sub.vendor],
    ['Billing cycle', CYCLE_LABELS[sub.billing_cycle]],
    ['Amount', formatMoney(sub.amount, sub.currency)],
    ['Renewal date', formatLongDate(renewalDate)],
  ];
}

// Reminder sent to you (the account owner).
export function ownerReminderEmail({ sub, settings, renewalDate, daysUntil, appUrl }) {
  const when = describeDaysUntil(daysUntil);
  const clientLabel = sub.client_name
    ? `${sub.client_name}${sub.client_company ? ` (${sub.client_company})` : ''}`
    : '';
  const subject = `Renewal ${when}: ${sub.name}${sub.client_name ? ` for ${sub.client_name}` : ''} (${formatLongDate(renewalDate)})`;
  const rows = [
    ...commonRows(sub, renewalDate),
    ['Client', clientLabel],
    ['Client email', sub.client_email],
    ['Notes', sub.notes],
  ];
  const clientLine = sub.notify_client && sub.client_email
    ? `Your client also gets renewal reminders at ${sub.client_email}.`
    : 'Your client does not get renewal reminders for this subscription.';

  const html = layout({
    heading: `Renewal ${escapeHtml(when)}`,
    intro: `<p style="margin:0">The <strong>${escapeHtml(sub.name)}</strong> subscription${sub.client_name ? ` for <strong>${escapeHtml(sub.client_name)}</strong>` : ''} renews <strong>${escapeHtml(when)}</strong>.</p>`,
    rows,
    outro: `<p style="margin:0;color:#475569">${escapeHtml(clientLine)}</p>${
      appUrl ? `<p style="margin:16px 0 0"><a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open Subscription Manager</a></p>` : ''
    }`,
    footer: `Sent by ${escapeHtml(settings.business_name)} Subscription Manager.`,
  });
  const text = textVersion(
    [
      `The ${sub.name} subscription${sub.client_name ? ` for ${sub.client_name}` : ''} renews ${when}.`,
      clientLine,
      ...(appUrl ? [`Open Subscription Manager: ${appUrl}`] : []),
    ],
    rows,
  );
  return { subject, html, text };
}

// Reminder sent to the client who owns the subscription.
export function clientReminderEmail({ sub, settings, renewalDate, daysUntil }) {
  const when = describeDaysUntil(daysUntil);
  const greeting = sub.client_name ? `Hi ${sub.client_name},` : 'Hello,';
  const subject = `Reminder: your ${sub.name} subscription renews on ${formatLongDate(renewalDate)}`;
  const rows = commonRows(sub, renewalDate);
  const note = settings.client_note?.trim();
  const closing = 'If you have any questions or would like to make changes before the renewal, just reply to this email.';

  const html = layout({
    heading: `${escapeHtml(sub.name)} renews ${escapeHtml(when)}`,
    intro: `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>
      <p style="margin:0">This is a friendly reminder that your <strong>${escapeHtml(sub.name)}</strong> subscription will renew <strong>${escapeHtml(when)}</strong>.</p>`,
    rows,
    outro: `${note ? `<p style="margin:0 0 12px;white-space:pre-line">${escapeHtml(note)}</p>` : ''}
      <p style="margin:0 0 12px">${escapeHtml(closing)}</p>
      <p style="margin:0">Thank you,<br><strong>${escapeHtml(settings.business_name)}</strong></p>`,
    footer: `You are receiving this because ${escapeHtml(settings.business_name)} manages this subscription for you.`,
  });
  const text = textVersion(
    [
      `${greeting}\n\nThis is a friendly reminder that your ${sub.name} subscription will renew ${when}.`,
      ...(note ? [note, ''] : []),
      closing,
      '',
      `Thank you,\n${settings.business_name}`,
    ],
    rows,
  );
  return { subject, html, text };
}

export function testEmail({ settings }) {
  const subject = 'Subscription Manager: test email';
  const html = layout({
    heading: 'Email is working',
    intro: '<p style="margin:0">Your email settings are working. Renewal reminders will be delivered from this address.</p>',
    rows: [],
    outro: '',
    footer: `Sent by ${escapeHtml(settings.business_name)} Subscription Manager.`,
  });
  return { subject, html, text: 'Your email settings are working. Renewal reminders will be delivered from this address.' };
}
