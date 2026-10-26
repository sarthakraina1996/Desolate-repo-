// Combined HRMS + Projects demo only, run before the Projects demo starts.
(function () {
  // The page around this one names the frame "brainadz-suite:<email>": start signed in as them.
  var m = /^brainadz-suite:(.+)$/.exec(window.name || '');
  // Some browsers block storage in embedded pages; then the demo keeps its choices in memory.
  var store;
  try {
    store = window.localStorage;
    store.setItem('bpm.suite.check', '1');
    store.removeItem('bpm.suite.check');
  } catch (e) {
    var mem = {};
    store = {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      },
      setItem: function (k, v) {
        mem[k] = String(v);
      },
      removeItem: function (k) {
        delete mem[k];
      },
      clear: function () {
        mem = {};
      },
      key: function (i) {
        return Object.keys(mem)[i] || null;
      },
      get length() {
        return Object.keys(mem).length;
      },
    };
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: store });
    } catch (e2) {
      /* the demo will ask who you are instead */
    }
  }
  if (m) store.setItem('bpm.demo.user', m[1]);
  // The page around this one has its own switcher; this demo's bar would sit on top of it.
  var css = document.createElement('style');
  css.textContent = '.demo-badge{display:none!important}';
  document.head.appendChild(css);
  if (!m) return;
  // Tell the page around this one when the person is signed in, or isn't in Projects.
  var tries = 0;
  var t = setInterval(function () {
    var d = window.__pmDemo;
    var ok = !!document.querySelector('.user-chip');
    var known = true;
    if (!ok && d && d.people().length) {
      known = d.people().some(function (p) {
        return String(p.email).toLowerCase() === m[1];
      });
    }
    if (ok || !known || ++tries > 600) {
      clearInterval(t);
      window.parent.postMessage({ type: 'brainadz:projects', ok: ok, email: m[1] }, '*');
    }
  }, 200);
})();
