// Shared by the organiser console screens.
import { createContext, useContext } from 'react';
import { RESULTS } from '../../../shared/scanRules.js';

export const OrgCtx = createContext(null);
// { eid, base, api, cfg, can(perm), role, reloadConfig }
export const useOrg = () => useContext(OrgCtx);

export const PageTitle = ({ title, children }) => (
  <div className="title">
    <h1>{title}</h1>
    <div className="row wrap no-print">{children}</div>
  </div>
);
// Status tone for a scan result.
export const scanTone = (r) => ({ ok: 'ok', warn: 'pending', deny: 'error' })[RESULTS[r]?.tone] || '';
