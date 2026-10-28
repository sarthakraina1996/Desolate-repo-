// Opening an app from the picker: the tile splits down a seam of light, rushes toward the
// viewer and dissolves into a glow in the app's colour, which stays (pulsing) until the app
// is on screen. Drawn in its own layer on <body>, so it outlives the picker.
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Starts the animation from `tile` (a picker tile; "hrms" or "projects" sets the colours).
// `covered` resolves once the glow fills the screen; then done() fades it out, or cancel()
// puts the tile back after a failure.
export function launch(tile, app) {
  const fx = document.createElement('div');
  fx.className = `launch ${app}`;
  fx.setAttribute('aria-hidden', 'true');
  const glow = document.createElement('div');
  glow.className = 'launch-glow';
  glow.append(Object.assign(document.createElement('i'), { className: 'launch-orb' }));
  fx.append(glow);
  document.body.append(fx);

  const steps = [];
  const play = (el, frames, opts) => {
    const a = el.animate(frames, { fill: 'both', ...opts });
    steps.push(a);
    return a;
  };

  let cover;
  if (reduced()) {
    cover = play(glow, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  } else {
    // A copy of the tile flies from where the tile is; the tile itself waits, hidden.
    const r = tile.getBoundingClientRect();
    const card = document.createElement('div');
    card.className = `picker-app launch-tile ${app}`;
    card.innerHTML = tile.innerHTML;
    Object.assign(card.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const seam = document.createElement('i');
    seam.className = 'launch-seam';
    card.append(seam);
    // The page behind fades to its plain background, leaving the tile on its own.
    const back = document.createElement('div');
    back.className = 'launch-back';
    fx.prepend(back, card);
    tile.style.visibility = 'hidden';

    // To the middle of the screen, and big enough that the logo overfills it. Blur is drawn
    // before scaling, so it is divided by the scale to stay a soft rush on screen.
    const dx = window.innerWidth / 2 - (r.left + r.width / 2);
    const dy = window.innerHeight / 2 - (r.top + r.height / 2);
    const s = 3 * Math.max(window.innerWidth / r.width, window.innerHeight / r.height);
    play(back, [{ opacity: 0 }, { opacity: 1 }], { delay: 120, duration: 480, easing: 'ease-out' });
    play(
      seam,
      [
        { transform: 'translateX(-50%) scaleY(0)', opacity: 0 },
        { transform: 'translateX(-50%) scaleY(1)', opacity: 1 },
      ],
      {
        duration: 280,
        easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
      },
    );
    play(
      card,
      [
        { transform: 'none', filter: 'blur(0)', opacity: 1 },
        {
          offset: 0.55,
          transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(${s * 0.12})`,
          filter: `blur(${1 / s}px)`,
          opacity: 1,
        },
        {
          offset: 0.8,
          transform: `translate(${dx}px, ${dy}px) scale(${s * 0.5})`,
          filter: `blur(${16 / s}px)`,
          opacity: 0.9,
        },
        {
          transform: `translate(${dx}px, ${dy}px) scale(${s})`,
          filter: `blur(${36 / s}px)`,
          opacity: 0,
        },
      ],
      { delay: 200, duration: 950, easing: 'cubic-bezier(0.5, 0, 0.85, 0.5)' },
    );
    cover = play(glow, [{ opacity: 0 }, { opacity: 1 }], {
      delay: 920,
      duration: 380,
      easing: 'ease-out',
    });
    // The bright point the rush ends in: a bloom that settles into the pulsing orb (the
    // pulse itself is the orb's ::before, so the two don't fight over transform).
    play(
      glow.firstChild,
      [
        { transform: 'scale(3)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { delay: 920, duration: 600, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
    );
  }

  let gone = false;
  const remove = () => {
    if (gone) return;
    gone = true;
    fx.remove();
    tile.style.visibility = '';
  };
  const fadeOut = (ms) => {
    steps.forEach((a) => a.pause());
    fx.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' }).finished.then(
      remove,
      remove,
    );
  };
  return {
    covered: cover.finished.then(() => undefined),
    // The app is on screen: fade the glow away.
    done: () => fadeOut(reduced() ? 150 : 420),
    // Opening failed: back to the picker as it was.
    cancel: () => {
      tile.style.visibility = '';
      fadeOut(150);
    },
  };
}
