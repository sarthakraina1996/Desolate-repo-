import { audit, fail } from '../core.js';
import { projectsLink, signPass } from '../services/sso.js';

// Switching to BrainADZ Projects without signing in again.
export default function appRoutes(r, { db }) {
  // A one-time pass for the signed-in person, and the Projects address that accepts it.
  r.post('/apps/projects/pass', (req, res) => {
    const link = projectsLink();
    if (!link) fail(404, 'BrainADZ Projects is not connected to this HRMS');
    if (req.user.mustChangePassword) fail(403, 'Change your password first');
    const pass = signPass(link.secret, { email: req.user.email, name: req.user.name });
    audit(db, req.user, 'Opened BrainADZ Projects', 'user', req.user.id);
    // After "#", so the pass never reaches server logs or another site's Referer header.
    res.json({ url: `${link.url}/#sso=${pass}` });
  });
}
