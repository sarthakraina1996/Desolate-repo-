// The messages the platform sends. All go through the email adapter (and WhatsApp when a
// person opted in and the integration is on). Plain text keeps them readable everywhere.
import { inr } from '../core.js';

const sign = (event) => `\n\n${event.name}\n${event.venue_name || ''}${event.city ? `, ${event.city}` : ''}`;

// Sends without making the caller wait or fail: delivery problems are recorded in the outbox.
function send(ctx, event, to, subject, text, template) {
  ctx.adapters.email.send({ eventId: event?.id, to, subject, text, template }).catch((e) => console.error('Email failed', e.message));
}

export const mail = {
  signinCode(ctx, to, code) {
    send(
      ctx,
      null,
      to,
      `${code} is your BrainADZ Events sign-in code`,
      `Your sign-in code is ${code}.\n\nIt works for 10 minutes. If you did not ask for it, ignore this email.`,
      'signin_code',
    );
  },
  registrationCode(ctx, event, reg, code) {
    send(
      ctx,
      event,
      reg.email,
      `${code} is your code for ${event.name}`,
      `Hello ${reg.name},\n\nEnter this code to confirm your email and finish registering: ${code}\n\nIt works for 10 minutes. Reference: ${reg.ref}.${sign(event)}`,
      'registration_code',
    );
  },
  // token is a new ticket link, or null when the visitor's earlier link still works.
  passReady(ctx, event, reg, token) {
    const link = token ? `${ctx.baseUrl}/p/${token}` : `${ctx.baseUrl}/signin`;
    const how = token
      ? `Open your ticket here:\n${link}\n\nThe link opens the ticket in the BrainADZ Events app if you have it, or in your browser.`
      : `Your ticket is ready. Open it from the link in our earlier email, or sign in with this email address on any phone or computer:\n${link}`;
    send(
      ctx,
      event,
      reg.email,
      `Your ticket for ${event.name}`,
      `Hello ${reg.name},\n\nYou are confirmed. ${how}\n\nShow the QR at the gate. Reference: ${reg.ref}.${sign(event)}`,
      'pass_ready',
    );
    if (reg.whatsapp_opt_in && reg.phone)
      ctx.adapters.whatsapp.send({ eventId: event.id, to: reg.phone, text: link, template: 'pass_ready' }).catch(() => {});
  },
  passLink(ctx, event, reg, token) {
    send(
      ctx,
      event,
      reg.email,
      `Your pass link for ${event.name}`,
      `Hello ${reg.name},\n\nHere is a new link to your registration:\n${ctx.baseUrl}/p/${token}\n\nEarlier links no longer work. Reference: ${reg.ref}.${sign(event)}`,
      'pass_link',
    );
  },
  underReview(ctx, event, reg) {
    send(
      ctx,
      event,
      reg.email,
      `We are reviewing your registration for ${event.name}`,
      `Hello ${reg.name},\n\nThanks for registering. The organiser reviews this pass type and will email you a decision. You do not need to do anything now. Reference: ${reg.ref}.${sign(event)}`,
      'under_review',
    );
  },
  paymentDue(ctx, event, reg, order, token) {
    send(
      ctx,
      event,
      reg.email,
      `Complete payment for ${event.name}`,
      `Hello ${reg.name},\n\nYour place is held. Pay ${inr(order.total_paise)} to receive your pass:\n${ctx.baseUrl}/p/${token}\n\nOrder ${order.number}. Reference: ${reg.ref}.${sign(event)}`,
      'payment_due',
    );
  },
  rejected(ctx, event, reg) {
    send(
      ctx,
      event,
      reg.email,
      `Your registration for ${event.name}`,
      `Hello ${reg.name},\n\nThe organiser could not approve this registration.${reg.review_note ? `\n\nNote from the organiser: ${reg.review_note}` : ''}\n\nReference: ${reg.ref}.${sign(event)}`,
      'rejected',
    );
  },
  cancelled(ctx, event, reg) {
    send(
      ctx,
      event,
      reg.email,
      `Registration cancelled for ${event.name}`,
      `Hello ${reg.name},\n\nYour registration ${reg.ref} has been cancelled and its pass no longer works.${reg.payment_status === 'paid' ? ' The organiser will process your refund.' : ''}${sign(event)}`,
      'cancelled',
    );
  },
  exhibitorStatus(ctx, event, exhibitor, headline, detail) {
    if (!exhibitor.contact_email) return;
    send(
      ctx,
      event,
      exhibitor.contact_email,
      `${headline}: ${exhibitor.company_name} at ${event.name}`,
      `Hello ${exhibitor.contact_name || 'there'},\n\n${detail}\n\nOpen your exhibitor workspace: ${ctx.baseUrl}/x/${exhibitor.id}${sign(event)}`,
      'exhibitor_status',
    );
  },
  teamInvite(ctx, event, exhibitor, badge) {
    send(
      ctx,
      event,
      badge.email,
      `Your exhibitor badge for ${event.name}`,
      `Hello ${badge.name},\n\n${exhibitor.company_name} added you to its team at ${event.name}. Sign in with this email address to see your badge${badge.role === 'booth_staff' ? ' and scan leads at the booth' : ' and manage the booth'}:\n${ctx.baseUrl}/signin${sign(event)}`,
      'team_invite',
    );
  },
  staffInvite(ctx, event, to, name, roleLabel) {
    send(
      ctx,
      event,
      to,
      `You have been added to ${event.name}`,
      `Hello ${name},\n\nYou now have ${roleLabel} access to ${event.name}. Sign in with this email address:\n${ctx.baseUrl}/signin${sign(event)}`,
      'staff_invite',
    );
  },
  receipt(ctx, event, to, order, amountPaise) {
    send(
      ctx,
      event,
      to,
      `Payment received: ${order.number}`,
      `We received ${inr(amountPaise)} for order ${order.number}.${order.invoice_no ? ` Tax invoice ${order.invoice_no}.` : ''} Balance due: ${inr(order.total_paise - order.paid_paise)}.${sign(event)}`,
      'receipt',
    );
  },
};
