// Camera QR scanning for the web scanner and lead capture. Decodes frames with jsQR so it
// works in every browser, including Edge and Chrome on Windows.
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Notice } from './ui.jsx';

export function QrCamera({ onCode, paused }) {
  const video = useRef(null);
  const last = useRef({ text: '', at: 0 });
  const handler = useRef(onCode);
  handler.current = onCode;
  const [state, setState] = useState('starting'); // starting | live | denied | none
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stream;
    let timer;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        const scale = Math.min(1, 640 / v.videoWidth);
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, {
          inversionAttempts: 'dontInvert',
        });
        // The same code held in front of the camera is reported once every three seconds.
        if (found?.data && (found.data !== last.current.text || Date.now() - last.current.at > 3000)) {
          last.current = { text: found.data, at: Date.now() };
          handler.current(found.data);
        }
      }
    };
    if (!navigator.mediaDevices?.getUserMedia) setState('none');
    else
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then((s) => {
          if (stopped) return s.getTracks().forEach((t) => t.stop());
          stream = s;
          video.current.srcObject = s;
          video.current.play().catch(() => {});
          setState('live');
          timer = setInterval(tick, 180);
        })
        .catch((e) => setState(e.name === 'NotAllowedError' ? 'denied' : 'none'));
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [attempt]);

  if (state === 'denied')
    return (
      <Notice tone="error">
        <strong>Camera access is blocked.</strong> Allow the camera for this site in the browser's address bar, then try again. You can
        still type or paste a code, or use a USB scanner.
        <div style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={() => (setState('starting'), setAttempt((a) => a + 1))}>
            Try again
          </button>
        </div>
      </Notice>
    );
  if (state === 'none') return <Notice>No camera found on this device. Use a USB scanner or type the code below.</Notice>;
  return (
    <div className="camera" style={paused ? { display: 'none' } : undefined}>
      <video ref={video} muted playsInline aria-label="Camera view" />
      <div className="frame" aria-hidden="true" />
    </div>
  );
}
