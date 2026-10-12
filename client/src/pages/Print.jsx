import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useApi } from '../lib/hooks.js';
import { fmtDate } from '../lib/format.js';
import { Loading, ErrorBox, Button } from '../components/ui.jsx';
import { PayslipView } from './Payroll.jsx';

// Print-friendly pages: /print/payslip/:id and /print/experience|relieving/:resignationId
export default function Print() {
  const { kind, id } = useParams();
  const path = kind === 'payslip' ? `/payroll/payslips/${id}` : `/resignations/${id}`;
  const { data, error } = useApi(path);
  const navigate = useNavigate();
  useEffect(() => {
    if (data) document.title = kind === 'payslip' ? `Payslip ${data.label} - ${data.data.employee?.name}` : `${kind === 'experience' ? 'Experience' : 'Relieving'} letter - ${data.name}`;
  }, [data, kind]);
  if (error) return <div className="print-page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading />;
  return (
    <div>
      <div className="no-print row" style={{ justifyContent: 'center', gap: 10, padding: 16 }}>
        {window.hrmsDemo ? <>
          <Button onClick={() => navigate(-1)}>Back</Button>
          <span className="small muted">Printing and PDF export work in the installed app, not in this demo.</span>
        </> : <>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>Print / Save as PDF</Button>
          <Button onClick={() => window.close()}>Close</Button>
        </>}
      </div>
      <div className="print-page">
        {kind === 'payslip' ? <PayslipView data={data.data} label={data.label} company={data.company.name} /> : <Letter kind={kind} r={data} />}
      </div>
    </div>
  );
}

function Letter({ kind, r }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div style={{ lineHeight: 1.75, fontSize: 15 }}>
      <div className="row between" style={{ borderBottom: '2px solid var(--navy)', paddingBottom: 12, marginBottom: 28 }}>
        <div className="logo"><div className="b">BrainADZ</div><div className="tg">People | Process | Possibilities</div></div>
        <div className="small muted right">Date: {fmtDate(today)}<br />Ref: BZ/HR/{kind === 'experience' ? 'EXP' : 'REL'}/{r.code}</div>
      </div>
      <h2 style={{ textAlign: 'center', marginBottom: 24, fontSize: 20, textDecoration: 'underline' }}>{kind === 'experience' ? 'TO WHOMSOEVER IT MAY CONCERN' : 'RELIEVING LETTER'}</h2>
      {kind === 'experience' ? (
        <p>This is to certify that <b>{r.name}</b> (Employee ID {r.code}) was employed with BrainADZ as <b>{r.designation}</b> in the {r.department} department from <b>{fmtDate(r.join_date)}</b> to <b>{fmtDate(r.last_working_day)}</b>.<br /><br />During this period we found {r.name.split(' ')[0]} sincere, hardworking and a valued member of the team. We wish them every success in their future endeavours.</p>
      ) : (
        <p>Dear {r.name},<br /><br />This refers to your resignation submitted on {fmtDate(r.submitted_on)}. We confirm that your resignation has been accepted and you are relieved from your duties as <b>{r.designation}</b> at the close of business on <b>{fmtDate(r.last_working_day)}</b>.<br /><br />We confirm that you have completed all handover formalities and that your full and final settlement {r.settlement?.paidOn ? `was processed on ${fmtDate(r.settlement.paidOn)}` : 'will be processed as per company policy'}.<br /><br />We thank you for your contributions and wish you the very best.</p>
      )}
      <div style={{ marginTop: 60 }}>For <b>BrainADZ</b><br /><br /><br />Authorised Signatory<br />Human Resources</div>
    </div>
  );
}
