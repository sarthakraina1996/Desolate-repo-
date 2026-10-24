// First start of the demo: progress while the year of operations is simulated.
import { Monogram } from '../components/Brand.jsx';

export default function Preparing({ progress }) {
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <Monogram size={44} />
        <h1 style={{ fontSize: 20, margin: '14px 0 6px' }}>Preparing the demo environment</h1>
        <p className="muted">
          Simulating a year of operations across five fictional hotels — bookings, check-ins, folios, housekeeping and night audits — through the real application
          services, so every figure reconciles. This happens once.
        </p>
        <div className="progress" style={{ margin: '20px 0 8px', height: 8 }}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="small muted num">
          {progress?.phase || 'Starting'} · {progress?.done ?? 0} of {progress?.total ?? '…'} days
        </div>
      </div>
    </div>
  );
}
