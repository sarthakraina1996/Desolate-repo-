import os from 'node:os';

// Addresses other devices on the same network (office Wi-Fi) can open.
export function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// True when the request comes from the server computer itself (IPv4 or IPv6 loopback).
export const isLoopback = (ip = '') =>
  ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1';
