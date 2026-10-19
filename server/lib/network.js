import os from 'node:os';

// Addresses other devices on the same network (office Wi-Fi) can open.
export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

export const isLoopback = (ip = '') => ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1';
