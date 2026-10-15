// Modals shared by several pages: apply leave, raise a helpdesk request,
// submit a reimbursement claim, show a one-time password.
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../context.jsx';
import { useAction, useDebounced } from '../lib/hooks.js';
import { Button, EmployeeSelect, Field, Input, Modal, Select, Textarea } from './ui.jsx';

export function ApplyLeaveModal({ onClose, onDone, employeeId: fixedEmployee, onBehalf }) {
  const { meta, user, toast } = useApp();
  const T = meta.today;
  const [f, setF] = useState({ employee_id: fixedEmployee || '', leave_type_id: '', from_date: T, to_date: T, half_day: false, reason: '', approve: true });
  const target = onBehalf ? f.employee_id : fixedEmployee || user.employeeId;
  const [balances, setBalances] = useState([]);
  const [preview, setPreview] = useState(null);
  const [run, busy] = useAction(toast);
  useEffect(() => {
    if (!target) return;
    api.get(`/leave/balances?employee=${target}`).then((r) => {
      setBalances(r.items);
      setF((s) => ({ ...s, leave_type_id: s.leave_type_id || r.items[0]?.typeId || '' }));
    }).catch(() => setBalances([]));
  }, [target]);
  const body = { ...f, employee_id: onBehalf ? f.employee_id : fixedEmployee || undefined, to_date: f.half_day ? f.from_date : f.to_date };
  const key = useDebounced(JSON.stringify(body), 250);
  useEffect(() => {
    const b = JSON.parse(key);
    if (!b.leave_type_id || !b.from_date || (onBehalf && !b.employee_id)) return setPreview(null);
    api.post('/leave/preview', b).then(setPreview).catch(() => setPreview(null));
  }, [key]);
  const bal = balances.find((b) => b.typeId === Number(f.leave_type_id));
  const submit = async () => {
    const out = await run(() => api.post('/leave/requests', body), (r) => (onBehalf && f.approve ? `Recorded ${r.days} day(s) of leave` : `Leave request sent for ${r.days} day(s)`));
    if (out) { onDone?.(); onClose(); }
  };
  return (
    <Modal title={onBehalf ? 'Apply leave on behalf' : 'Apply for leave'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!preview?.ok} onClick={submit}>{onBehalf && f.approve ? 'Record leave' : 'Submit request'}</Button></>}>
      <div className="form-grid">
        {onBehalf && <Field label="Employee" className="full"><EmployeeSelect value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: Number(e.target.value) || '', leave_type_id: '' })} /></Field>}
        <Field label="Leave type" className="full">
          <Select value={f.leave_type_id} onChange={(e) => setF({ ...f, leave_type_id: Number(e.target.value) })} placeholder={balances.length ? undefined : 'Select'}
            options={balances.map((b) => ({ value: b.typeId, label: `${b.name}${b.available != null ? ` · ${b.available} day(s) available` : ''}` }))} />
          {bal?.kind === 'wfh' && <span className="hint">Work from home days count as present in attendance.</span>}
          {bal && !bal.paid && <span className="hint">Loss of pay days are deducted in payroll.</span>}
        </Field>
        <Field label="From"><Input type="date" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value, to_date: e.target.value > f.to_date ? e.target.value : f.to_date })} /></Field>
        <Field label="To"><Input type="date" value={f.half_day ? f.from_date : f.to_date} min={f.from_date} disabled={f.half_day} onChange={(e) => setF({ ...f, to_date: e.target.value })} /></Field>
        <label className="check full"><input type="checkbox" checked={f.half_day} onChange={(e) => setF({ ...f, half_day: e.target.checked })} />Half day</label>
        <Field label="Reason" className="full"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={500} placeholder="Optional" /></Field>
        {onBehalf && <label className="check full"><input type="checkbox" checked={f.approve} onChange={(e) => setF({ ...f, approve: e.target.checked })} />Mark as approved (HR recording leave already agreed)</label>}
        <div className="full">
          {preview && (preview.ok ? <div className="alert info">This request uses <b>{preview.days}</b> working day(s){bal?.available != null ? `; ${bal.available - preview.days} will remain.` : '.'}</div> : <div className="alert error">{preview.error}</div>)}
        </div>
      </div>
    </Modal>
  );
}

export function RaiseRequestModal({ onClose, onDone }) {
  const { toast } = useApp();
  const [f, setF] = useState({ category: 'HR', subject: '', description: '' });
  const [run, busy] = useAction(toast);
  return (
    <Modal title="Raise a request" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post('/requests', f), 'Request sent to HR')) { onDone?.(); onClose(); } }}>Send request</Button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={['HR', 'IT', 'Payroll', 'Admin', 'Other']} /></Field>
        <Field label="Subject"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={150} placeholder="e.g. Address proof letter" /></Field>
        <Field label="Details"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function ClaimModal({ onClose, onDone, hr }) {
  const { toast, meta } = useApp();
  const [f, setF] = useState({ employee_id: '', kind: 'Reimbursement', amount: '', note: '', month: meta.today.slice(0, 7), approve: true });
  const [run, busy] = useAction(toast);
  return (
    <Modal title={hr ? 'Add payroll adjustment' : 'Submit a reimbursement claim'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post('/payroll/adjustments', { ...f, employee_id: hr ? f.employee_id : undefined }), hr ? 'Adjustment added' : 'Claim submitted')) { onDone?.(); onClose(); } }}>Save</Button></>}>
      <div className="form-grid">
        {hr && <Field label="Employee" className="full"><EmployeeSelect value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: Number(e.target.value) || '' })} /></Field>}
        {hr && <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={['Reimbursement', 'Bonus', 'Arrears', 'Deduction']} /></Field>}
        <Field label="Amount (₹)"><Input type="number" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Payroll month"><Input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></Field>
        <Field label="Note" className="full"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={hr ? 'e.g. Performance bonus' : 'e.g. Client travel, bill attached by email'} maxLength={200} /></Field>
        {hr && <label className="check full"><input type="checkbox" checked={f.approve} onChange={(e) => setF({ ...f, approve: e.target.checked })} />Approved (include in this month's payroll)</label>}
      </div>
    </Modal>
  );
}

export function TempPasswordModal({ email, password, onClose, note }) {
  const { toast } = useApp();
  return (
    <Modal title="Login details" size="narrow" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="alert warn">This temporary password is shown only once. Share it privately; the employee must change it at first sign-in.</div>
        <div className="kv"><dt>Email</dt><dd>{email}</dd><dt>Temporary password</dt><dd><code style={{ fontSize: 15 }}>{password}</code></dd></div>
        <Button size="sm" icon={Copy} onClick={() => { navigator.clipboard?.writeText(`Email: ${email}\nTemporary password: ${password}`); toast('Copied', 'success'); }}>Copy</Button>
        {note && <div className="small muted">{note}</div>}
      </div>
    </Modal>
  );
}
