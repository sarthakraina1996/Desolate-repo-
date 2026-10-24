// Node globals the server modules expect, installed before any of them is evaluated.
import { Buffer } from 'buffer';

globalThis.Buffer ??= Buffer;
globalThis.process ??= { env: {} };
