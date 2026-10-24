// BrainADZ brand marks. The wordmark is the vector artwork extracted from the BrainADZ Live
// booklet (public/brand/); the "Br" monogram is the trace used across BrainADZ products.
const MONOGRAM =
  'M31.7 0.0L26.3 0.4L22.7 1.1L19.1 2.2L17.4 2.9L14.9 4.2L11.9 6.3L9.9 8.2L8.6 9.6L7.4 11.3L6.3 13.0L4.9 16.2L4.2 18.5L3.6 20.8L3.1 25.6L3.3 30.1L3.6 32.2L4.2 34.2L4.8 35.6L6.1 38.1L8.4 41.1L10.1 42.8L11.8 44.1L13.2 44.9L15.2 45.8L15.2 45.9L13.5 46.6L10.1 48.4L7.7 50.1L6.0 51.7L4.3 53.9L3.5 55.3L2.0 58.3L1.4 60.1L0.5 63.5L0.2 66.3L0.0 68.9L0.1 72.4L0.4 75.9L1.1 79.0L2.0 81.7L3.2 84.4L4.7 86.9L6.3 89.0L9.2 91.9L12.0 94.1L15.5 95.9L17.7 96.9L21.3 98.1L23.9 98.7L26.5 99.2L30.2 99.6L34.9 99.9L82.2 100.0L82.3 55.8L82.8 54.0L83.4 52.3L84.1 50.9L85.8 48.6L87.6 46.9L88.9 46.0L90.3 45.3L92.3 44.6L93.9 44.1L97.2 43.7L101.3 43.6L105.2 44.1L105.2 23.9L99.8 23.9L97.7 24.1L94.4 24.6L92.2 25.2L89.1 26.6L86.7 28.1L85.1 29.4L83.5 30.9L82.7 32.0L82.4 32.2L82.4 0.1ZM62.3 22.4L62.2 39.0L34.9 39.0L32.0 38.7L30.6 38.4L29.0 37.9L27.6 37.2L26.2 36.1L25.4 35.2L24.5 34.0L23.9 32.6L23.6 31.4L23.3 29.4L23.3 26.4L23.8 23.9L24.6 22.1L25.5 20.8L26.7 19.7L28.6 18.6L30.8 17.9L32.9 17.5L35.2 17.3L62.3 17.4ZM20.4 69.3L20.3 68.0L20.6 65.3L21.2 63.1L22.1 61.3L23.0 60.1L24.6 58.7L25.6 58.1L28.0 57.0L30.3 56.4L33.9 56.0L62.2 56.0L62.2 83.0L33.8 82.9L31.9 82.6L29.9 82.2L28.1 81.5L25.8 80.1L24.5 79.1L23.0 77.4L21.9 75.6L21.0 73.4L20.5 71.5Z';

export function Monogram({ size = 20, color = '#233E85', label = null }) {
  return (
    <svg width={size} height={(size * 100) / 105.2} viewBox="0 0 105.2 100" {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      <path fill={color} fillRule="evenodd" d={MONOGRAM} />
    </svg>
  );
}

// White wordmark for the navy header; the coloured lock-up for light surfaces.
export function Wordmark({ height = 14, variant = 'white' }) {
  return <img className="brand-word" src={variant === 'white' ? '/brand/brainadz-wordmark-white.svg' : '/brand/brainadz-wordmark.svg'} alt="BrainADZ" style={{ height }} />;
}
