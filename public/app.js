import { daysBetween, describeDaysUntil, formatLongDate, nextRenewalDate } from './js/dates.js';

const DEFAULT_REMINDER_DAYS = { monthly: '7, 1', quarterly: '14, 3', yearly: '30, 7, 1' };
const CYCLE_LABELS = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const CYCLE_SUFFIX = { monthly: '/mo', quarterly: '/qtr', yearly: '/yr' };

const state = { status: null, settings: null, clients: [], subscriptions: [], log: [], dashboard: null };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// ---------- helpers ----------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 7000 : 4000);
}

function money(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

function daysBadge(days) {
  if (days === null || days === undefined) return '<span class="badge">—</span>';
  const label = describeDaysUntil(days);
  const cls = days <= 7 ? 'urgent' : days <= 30 ? 'soon' : 'ok';
  return `<span class="badge ${cls}">${esc(label[0].toUpperCase() + label.slice(1))}</span>`;
}

function localDateTime(sqlUtc) {
  return new Date(`${sqlUtc.replace(' ', 'T')}Z`).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function emptyState(message, action = '') {
  return `<div class="empty"><div>${message}</div>${action}</div>`;
}

async function withBusy(button, fn) {
  if (button) button.disabled = true;
  try {
    await fn();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------- data loading ----------

async function loadAll() {
  const [status, settings, clients, subscriptions, dashboard, log] = await Promise.all([
    api('/status'), api('/settings'), api('/clients'), api('/subscriptions'), api('/dashboard'), api('/reminders'),
  ]);
  Object.assign(state, { status, settings, clients, subscriptions, dashboard, log });
  renderAll();
}

function renderAll() {
  $('#business-name').textContent = state.settings.business_name;
  renderBanners();
  renderDashboard();
  renderClientFilter();
  renderSubscriptions();
  renderClients();
  renderLog();
  renderSettings();
}

// ---------- rendering ----------

function renderBanners() {
  const banners = [];
  if (state.status.notice) {
    banners.push(esc(state.status.notice));
  } else if (!state.status.emailConfigured) {
    banners.push('Email sending is not set up yet, so no reminders can go out. Add your SMTP details to the <code>.env</code> file and restart — see the README.');
  }
  if (!state.status.ownerEmailSet) {
    banners.push('Add your own email address in <a href="#settings">Settings</a> so you receive renewal reminders.');
  }
  $('#banners').innerHTML = banners.map((b) => `<div class="banner">${b}</div>`).join('');
}

function totalsLines(totals, key) {
  if (!totals.length) return money(0, state.settings.default_currency);
  return totals.map((t) => esc(money(t[key], t.currency))).join('<br>');
}

function renderDashboard() {
  const d = state.dashboard;
  $('#kpis').innerHTML = `
    <div class="card kpi"><div class="kpi-label">Active subscriptions</div><div class="kpi-value">${d.activeCount}</div><div class="kpi-sub">${d.clientCount} client${d.clientCount === 1 ? '' : 's'}</div></div>
    <div class="card kpi"><div class="kpi-label">Renewing in 30 days</div><div class="kpi-value">${d.renewingIn30Days}</div><div class="kpi-sub">as of ${esc(formatLongDate(d.today))}</div></div>
    <div class="card kpi"><div class="kpi-label">Monthly cost</div><div class="kpi-value">${totalsLines(d.totals, 'monthly')}</div><div class="kpi-sub">quarterly &amp; yearly spread per month</div></div>
    <div class="card kpi"><div class="kpi-label">Yearly cost</div><div class="kpi-value">${totalsLines(d.totals, 'yearly')}</div><div class="kpi-sub">all active subscriptions</div></div>`;

  if (!d.upcoming.length) {
    $('#upcoming').innerHTML = emptyState(
      d.activeCount ? 'Nothing renews in the next 60 days. 🎉' : 'No subscriptions yet.',
      d.activeCount ? '' : '<button class="btn primary" data-action="new-subscription">+ Add your first subscription</button>',
    );
    return;
  }
  $('#upcoming').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Software</th><th>Client</th><th>Renews</th><th class="num">Amount</th><th></th></tr></thead>
    <tbody>${d.upcoming.map((s) => `
      <tr>
        <td><div class="primary-text">${esc(s.name)}</div><div class="secondary-text">${esc([s.plan, s.vendor].filter(Boolean).join(' · '))}</div></td>
        <td>${s.client_name ? esc(s.client_name) : '<span class="muted">—</span>'}</td>
        <td><div>${esc(formatLongDate(s.next_renewal))}</div>${daysBadge(s.days_until)}</td>
        <td class="num">${esc(money(s.amount, s.currency))}<span class="muted">${CYCLE_SUFFIX[s.billing_cycle]}</span></td>
        <td class="actions"><button class="btn small" data-action="preview" data-id="${s.id}">Preview &amp; send</button></td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function renderClientFilter() {
  const select = $('#sub-filter-client');
  const current = select.value;
  select.innerHTML = `<option value="">All clients</option><option value="none">No client</option>${
    state.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}`;
  select.value = [...select.options].some((o) => o.value === current) ? current : '';
}

function filteredSubscriptions() {
  const q = $('#sub-search').value.trim().toLowerCase();
  const client = $('#sub-filter-client').value;
  const cycle = $('#sub-filter-cycle').value;
  const status = $('#sub-filter-status').value;
  return state.subscriptions
    .filter((s) => !status || s.status === status)
    .filter((s) => !cycle || s.billing_cycle === cycle)
    .filter((s) => !client || (client === 'none' ? !s.client_id : String(s.client_id) === client))
    .filter((s) => !q || [s.name, s.vendor, s.plan, s.client_name, s.client_company].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => (a.days_until ?? Infinity) - (b.days_until ?? Infinity) || a.name.localeCompare(b.name));
}

function reminderSummary(s) {
  const who = [s.notify_owner && 'me', s.notify_client && s.client_email && 'client'].filter(Boolean);
  const days = s.reminder_days.split(',').join(', ');
  if (!who.length) return '<span class="muted">Off</span>';
  return `<div>${esc(days)} days before</div><div class="secondary-text">to ${esc(who.join(' + '))}${
    s.notify_client && s.client_id && !s.client_email ? ' (client has no email)' : ''}</div>`;
}

function renderSubscriptions() {
  const rows = filteredSubscriptions();
  const container = $('#subscriptions-table');
  if (!state.subscriptions.length) {
    container.innerHTML = emptyState('No subscriptions yet.', '<button class="btn primary" data-action="new-subscription">+ Add your first subscription</button>');
    return;
  }
  if (!rows.length) {
    container.innerHTML = emptyState('No subscriptions match these filters.');
    return;
  }
  container.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Software</th><th>Client</th><th>Cycle</th><th class="num">Amount</th><th>Next renewal</th><th>Reminders</th><th></th></tr></thead>
    <tbody>${rows.map((s) => `
      <tr>
        <td><div class="primary-text">${esc(s.name)}</div><div class="secondary-text">${esc([s.plan, s.vendor].filter(Boolean).join(' · '))}</div></td>
        <td>${s.client_name ? `<div>${esc(s.client_name)}</div><div class="secondary-text">${esc(s.client_company ?? '')}</div>` : '<span class="muted">—</span>'}</td>
        <td><span class="badge cycle">${CYCLE_LABELS[s.billing_cycle]}</span></td>
        <td class="num"><div>${esc(money(s.amount, s.currency))}</div>${s.billing_cycle !== 'monthly' ? `<div class="secondary-text">≈ ${esc(money(s.monthly_equivalent, s.currency))}/mo</div>` : ''}</td>
        <td>${s.status === 'active'
          ? `<div>${esc(formatLongDate(s.next_renewal))}</div>${daysBadge(s.days_until)}`
          : '<span class="badge">Cancelled</span>'}</td>
        <td>${s.status === 'active' ? reminderSummary(s) : '<span class="muted">—</span>'}</td>
        <td class="actions">
          ${s.status === 'active' ? `<button class="btn small" data-action="preview" data-id="${s.id}">Preview &amp; send</button>` : ''}
          <button class="btn small" data-action="edit-subscription" data-id="${s.id}">Edit</button>
          <button class="btn small danger" data-action="delete-subscription" data-id="${s.id}">Delete</button>
        </td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function renderClients() {
  const container = $('#clients-table');
  if (!state.clients.length) {
    container.innerHTML = emptyState('No clients yet. Add clients so they can receive renewal reminders too.', '<button class="btn primary" data-action="new-client">+ Add client</button>');
    return;
  }
  container.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Client</th><th>Email</th><th>Phone</th><th class="num">Active subscriptions</th><th></th></tr></thead>
    <tbody>${state.clients.map((c) => `
      <tr>
        <td><div class="primary-text">${esc(c.name)}</div><div class="secondary-text">${esc(c.company ?? '')}</div></td>
        <td>${c.email ? esc(c.email) : '<span class="badge soon">No email — won\'t get reminders</span>'}</td>
        <td>${esc(c.phone ?? '')}</td>
        <td class="num">${c.active_subscriptions}</td>
        <td class="actions">
          <button class="btn small" data-action="client-subscriptions" data-id="${c.id}">View subscriptions</button>
          <button class="btn small" data-action="edit-client" data-id="${c.id}">Edit</button>
          <button class="btn small danger" data-action="delete-client" data-id="${c.id}">Delete</button>
        </td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function renderLog() {
  const container = $('#reminders-table');
  if (!state.log.length) {
    container.innerHTML = emptyState('No reminder emails have been sent yet.');
    return;
  }
  container.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>When</th><th>Subscription</th><th>Renewal</th><th>Sent to</th><th>Type</th><th>Result</th></tr></thead>
    <tbody>${state.log.map((l) => `
      <tr>
        <td>${esc(localDateTime(l.sent_at))}</td>
        <td>${esc(l.subscription_name)}</td>
        <td>${esc(formatLongDate(l.renewal_date))}</td>
        <td><div>${l.recipient_type === 'owner' ? 'Me' : 'Client'}</div><div class="secondary-text">${esc(l.recipient_email)}</div></td>
        <td>${l.manual ? 'Sent manually' : `Automatic · ${l.days_before} day${l.days_before === 1 ? '' : 's'} before`}</td>
        <td>${l.status === 'sent' ? '<span class="badge ok">Sent</span>' : `<span class="badge urgent">Failed</span><div class="secondary-text">${esc(l.error)}</div>`}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function renderSettings() {
  const form = $('#settings-form');
  for (const key of ['business_name', 'owner_email', 'default_currency', 'client_note']) {
    if (document.activeElement !== form.elements[key]) form.elements[key].value = state.settings[key] ?? '';
  }
  const s = state.status;
  $('#email-status').innerHTML = `
    <div class="status-row"><span>Email server</span>${s.emailConfigured ? '<span class="badge ok">Connected</span>' : '<span class="badge urgent">Not set up</span>'}</div>
    <div class="status-row"><span>Sending from</span><span>${esc(s.mailFrom || '—')}</span></div>
    <div class="status-row"><span>Daily reminder check</span><span>${esc(s.reminderTime)} (${esc(s.timezone)})</span></div>`;
}

// ---------- tabs ----------

function showTab(name) {
  const tab = $(`#tab-${name}`) ? name : 'dashboard';
  for (const panel of $$('.panel')) panel.hidden = panel.id !== `tab-${tab}`;
  for (const button of $$('.tab')) button.classList.toggle('active', button.dataset.tab === tab);
}

window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

// ---------- subscription form ----------

const subDialog = $('#subscription-dialog');
const subForm = $('#subscription-form');
let editingSubscriptionId = null;
let reminderDaysEdited = false;

function fillClientOptions(selected) {
  subForm.elements.client_id.innerHTML = `<option value="">— No client (my own subscription) —</option>${
    state.clients.map((c) => `<option value="${c.id}">${esc(c.name)}${c.company ? ` (${esc(c.company)})` : ''}</option>`).join('')}`;
  subForm.elements.client_id.value = selected ?? '';
}

function updateSubscriptionHints() {
  const f = subForm.elements;
  const client = state.clients.find((c) => String(c.id) === f.client_id.value);
  $('#client-email-hint').textContent = !client
    ? '(choose a client above)'
    : client.email ? `(${client.email})` : '(this client has no email address — add one on the Clients page)';

  const preview = $('#next-renewal-preview');
  if (f.start_date.value && f.status.value === 'active') {
    const today = state.status.today;
    const next = nextRenewalDate(f.start_date.value, f.billing_cycle.value, today);
    preview.textContent = `Next renewal: ${formatLongDate(next)} (${describeDaysUntil(daysBetween(today, next))})`;
  } else {
    preview.textContent = '';
  }
}

function openSubscriptionForm(sub = null, presetClientId = null) {
  editingSubscriptionId = sub?.id ?? null;
  reminderDaysEdited = Boolean(sub);
  $('#subscription-dialog-title').textContent = sub ? 'Edit subscription' : 'Add subscription';
  subForm.reset();
  fillClientOptions(sub?.client_id ?? presetClientId);
  const f = subForm.elements;
  const cycle = sub?.billing_cycle ?? 'monthly';
  f.name.value = sub?.name ?? '';
  f.plan.value = sub?.plan ?? '';
  f.vendor.value = sub?.vendor ?? '';
  f.billing_cycle.value = cycle;
  f.start_date.value = sub?.start_date ?? state.status.today;
  f.amount.value = sub ? sub.amount : '';
  f.currency.value = sub?.currency ?? state.settings.default_currency;
  f.reminder_days.value = sub ? sub.reminder_days.split(',').join(', ') : DEFAULT_REMINDER_DAYS[cycle];
  f.notify_owner.checked = sub ? sub.notify_owner : true;
  f.notify_client.checked = sub ? sub.notify_client : true;
  f.status.value = sub?.status ?? 'active';
  f.notes.value = sub?.notes ?? '';
  updateSubscriptionHints();
  subDialog.showModal();
  f.name.focus();
}

subForm.addEventListener('input', (e) => {
  if (e.target.name === 'reminder_days') reminderDaysEdited = true;
  updateSubscriptionHints();
});

subForm.elements.billing_cycle.addEventListener('change', () => {
  if (!reminderDaysEdited) subForm.elements.reminder_days.value = DEFAULT_REMINDER_DAYS[subForm.elements.billing_cycle.value];
  updateSubscriptionHints();
});

subForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = subForm.elements;
  const body = {
    name: f.name.value,
    plan: f.plan.value,
    vendor: f.vendor.value,
    client_id: f.client_id.value || null,
    billing_cycle: f.billing_cycle.value,
    start_date: f.start_date.value,
    amount: f.amount.value,
    currency: f.currency.value,
    reminder_days: f.reminder_days.value,
    notify_owner: f.notify_owner.checked,
    notify_client: f.notify_client.checked,
    status: f.status.value,
    notes: f.notes.value,
  };
  withBusy(e.submitter, async () => {
    if (editingSubscriptionId) await api(`/subscriptions/${editingSubscriptionId}`, { method: 'PUT', body });
    else await api('/subscriptions', { method: 'POST', body });
    subDialog.close();
    toast(editingSubscriptionId ? 'Subscription updated.' : 'Subscription added.');
    await loadAll();
  });
});

// ---------- client form ----------

const clientDialog = $('#client-dialog');
const clientForm = $('#client-form');
let editingClientId = null;

function openClientForm(client = null) {
  editingClientId = client?.id ?? null;
  $('#client-dialog-title').textContent = client ? 'Edit client' : 'Add client';
  clientForm.reset();
  for (const key of ['name', 'email', 'company', 'phone', 'notes']) clientForm.elements[key].value = client?.[key] ?? '';
  clientDialog.showModal();
  clientForm.elements.name.focus();
}

clientForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(clientForm));
  withBusy(e.submitter, async () => {
    if (editingClientId) await api(`/clients/${editingClientId}`, { method: 'PUT', body });
    else await api('/clients', { method: 'POST', body });
    clientDialog.close();
    toast(editingClientId ? 'Client updated.' : 'Client added.');
    await loadAll();
  });
});

// ---------- email preview ----------

const previewDialog = $('#preview-dialog');
let preview = { id: null, recipient: 'owner', to: null };

async function showPreview(id, recipient) {
  const data = await api(`/subscriptions/${id}/preview?recipient=${recipient}`);
  preview = { id, recipient, to: data.to };
  for (const b of $$('[data-preview]')) b.classList.toggle('selected', b.dataset.preview === recipient);
  $('#preview-to').textContent = data.to || (recipient === 'client' ? 'No client email address' : 'Your email is not set in Settings');
  $('#preview-subject').textContent = data.subject;
  $('#preview-frame').srcdoc = data.html;
  $('#preview-send').disabled = !data.to;
  if (!previewDialog.open) previewDialog.showModal();
}

for (const button of $$('[data-preview]')) {
  button.addEventListener('click', () => withBusy(null, () => showPreview(preview.id, button.dataset.preview)));
}

$('#preview-send').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
  const { results } = await api(`/subscriptions/${preview.id}/send`, { method: 'POST', body: { recipients: [preview.recipient] } });
  const failed = results.find((r) => r.status === 'failed');
  if (failed) toast(`Could not send to ${failed.recipientEmail}: ${failed.error}`, 'error');
  else toast(`Reminder sent to ${results.map((r) => r.recipientEmail).join(', ')}.`);
  await loadAll();
}));

// ---------- confirmation ----------

const confirmDialog = $('#confirm-dialog');

// Resolves true when the person clicks the confirm button, false otherwise.
function confirmAction(title, message, confirmLabel) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-ok').textContent = confirmLabel;
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true });
  });
}

// ---------- actions ----------

const actions = {
  'new-subscription': () => openSubscriptionForm(),
  'edit-subscription': (id) => openSubscriptionForm(state.subscriptions.find((s) => s.id === id)),
  'delete-subscription': async (id) => {
    const sub = state.subscriptions.find((s) => s.id === id);
    const ok = await confirmAction(
      `Delete "${sub.name}"?`,
      'This cannot be undone. To stop reminders but keep its history, edit it and set the status to Cancelled instead.',
      'Delete subscription',
    );
    if (!ok) return;
    await api(`/subscriptions/${id}`, { method: 'DELETE' });
    toast('Subscription deleted.');
    await loadAll();
  },
  preview: (id) => showPreview(id, 'owner'),
  'new-client': () => openClientForm(),
  'edit-client': (id) => openClientForm(state.clients.find((c) => c.id === id)),
  'delete-client': async (id) => {
    const client = state.clients.find((c) => c.id === id);
    const ok = await confirmAction(
      `Delete client "${client.name}"?`,
      'Their subscriptions are kept, but will no longer be linked to a client or send them reminders.',
      'Delete client',
    );
    if (!ok) return;
    await api(`/clients/${id}`, { method: 'DELETE' });
    toast('Client deleted.');
    await loadAll();
  },
  'client-subscriptions': (id) => {
    $('#sub-filter-client').value = String(id);
    $('#sub-filter-status').value = '';
    location.hash = 'subscriptions';
    renderSubscriptions();
  },
  'run-reminders': async () => {
    const summary = await api('/reminders/run', { method: 'POST' });
    toast(summary.sent || summary.failed
      ? `Reminder check done: ${summary.sent} sent, ${summary.failed} failed.`
      : 'Reminder check done: nothing is due today.', summary.failed ? 'error' : 'info');
    await loadAll();
  },
  'test-email': async () => {
    const { sentTo } = await api('/test-email', { method: 'POST' });
    toast(`Test email sent to ${sentTo}. Check your inbox (and spam folder).`);
  },
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) {
    location.hash = tab.dataset.tab;
    return;
  }
  if (e.target.closest('[data-close]')) {
    e.target.closest('dialog').close();
    return;
  }
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const handler = actions[button.dataset.action];
  if (handler) withBusy(button, () => handler(Number(button.dataset.id)));
});

for (const id of ['sub-search', 'sub-filter-client', 'sub-filter-cycle', 'sub-filter-status']) {
  $(`#${id}`).addEventListener('input', renderSubscriptions);
}

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  withBusy(e.submitter, async () => {
    await api('/settings', { method: 'PUT', body });
    toast('Settings saved.');
    await loadAll();
  });
});

// ---------- start ----------

showTab(location.hash.slice(1));
loadAll().catch((err) => toast(`Could not load data: ${err.message}`, 'error'));

// Keep "days until renewal" fresh if the page stays open overnight.
setInterval(() => { if (!document.querySelector('dialog[open]')) loadAll().catch(() => {}); }, 15 * 60 * 1000);
