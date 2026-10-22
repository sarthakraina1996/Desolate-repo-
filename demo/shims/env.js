// Imported first by the demo entry so Node globals exist before any server
// module is evaluated.
import { Buffer } from 'buffer';

globalThis.Buffer = Buffer;
// A bare process.env; main.jsx turns on HRMS_AI once Claude is available.
globalThis.process = globalThis.process || { env: { HRMS_AI_MODEL: 'Claude' } };
// Browsers have no setImmediate; a zero-delay timeout is close enough here.
globalThis.setImmediate = globalThis.setImmediate || ((fn, ...args) => setTimeout(fn, 0, ...args));
