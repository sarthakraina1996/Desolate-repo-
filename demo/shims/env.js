// Imported first by the demo entry so Node globals exist before any server
// module is evaluated.
import { Buffer } from 'buffer';

globalThis.Buffer = Buffer;
globalThis.process = globalThis.process || { env: { HRMS_AI_MODEL: 'Claude' } };
globalThis.setImmediate = globalThis.setImmediate || ((fn, ...args) => setTimeout(fn, 0, ...args));
