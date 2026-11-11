// Venue display mode for BrainADZ Live kiosks and screens: read-only agenda and map from
// published data, with a fixed "You are here" per kiosk. Shows no personal data. When the
// network drops it keeps showing the last copy and says when that copy was fetched.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { get } from '../api.js';
import { HallPlan } from '../components.jsx';
import { Notice } from '../ui.jsx';
import { clock, weekday } from '../format.js';

export default function Display() {
  const { slug, kiosk } = useParams();
  const key = `display:${slug}:${kiosk}`;
  const [data, setData] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  });
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const load = () =>
      get(`/public/display/${slug}/${kiosk}`)
        .then((d) => {
          const stamped = { ...d, fetchedAt: new Date().toISOString() };
          setData(stamped);
          setOffline(false);
          setError(null);
          try {
            localStorage.setItem(key, JSON.stringify(stamped));
          } catch {
            // Without storage the display simply has no offline copy.
          }
        })
        .catch((e) => (e.status === 404 ? setError(e.message) : setOffline(true)));
    load();
    const poll = setInterval(load, 30000);
    const tick = setInterval(() => setNow(new Date()), 10000);
    return () => (clearInterval(poll), clearInterval(tick));
  }, [slug, kiosk, key]);

  if (error)
    return (
      <div className="display">
        <Notice tone="error">{error}</Notice>
      </div>
    );
  if (!data)
    return (
      <div className="display">
        <p role="status">{offline ? 'Waiting for the network…' : 'Loading…'}</p>
      </div>
    );
  const { event, kiosk: k } = data;
  const showMap = k.mode !== 'agenda';
  const showAgenda = k.mode !== 'map';
  const slot = (s) => (
    <div className="slot" key={s.id}>
      <div className="t num">
        {s.startTime}–{s.endTime}
      </div>
      <div>
        <strong>{s.title}</strong>
        <div className="muted">
          {s.room}
          {s.full ? ' · Full' : ''}
        </div>
      </div>
    </div>
  );
  return (
    <div className="display">
      <header className="row between">
        <div>
          <div className="eyebrow">
            {weekday(data.today)} · {k.name}
          </div>
          <h1>{event.name}</h1>
        </div>
        <div className="num" style={{ fontSize: '2.4em', fontWeight: 600 }}>
          {clock(now)}
        </div>
      </header>
      <div className="cols" style={showMap && showAgenda ? undefined : { gridTemplateColumns: '1fr' }}>
        {showMap && <HallPlan halls={data.halls} here={{ zoneId: k.zoneId, x: k.x, y: k.y }} />}
        {showAgenda && (
          <div>
            <h2 style={{ fontSize: '1.4em' }}>On now</h2>
            {data.now.length ? (
              data.now.map(slot)
            ) : (
              <p className="muted" style={{ padding: '0.7em 0' }}>
                Nothing on stage right now.
              </p>
            )}
            <h2 style={{ fontSize: '1.4em', marginTop: '1em' }}>Coming up</h2>
            {data.next.length ? (
              data.next.map(slot)
            ) : (
              <p className="muted" style={{ padding: '0.7em 0' }}>
                No more sessions today.
              </p>
            )}
          </div>
        )}
      </div>
      <footer className="stack tight">
        {data.announcements.slice(0, 2).map((a) => (
          <Notice key={a.id} tone="pending">
            <strong>{a.title}.</strong> {a.body}
          </Notice>
        ))}
        <p className={offline ? 'sync-line pending' : 'muted'} role="status">
          {offline ? `Offline. Showing information from ${clock(data.fetchedAt)}.` : `Last updated ${clock(data.fetchedAt)}`}
        </p>
      </footer>
    </div>
  );
}
