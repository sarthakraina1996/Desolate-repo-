// Runs the API (with auto-restart) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', '--watch-path=server', 'server/index.js'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT || '3000' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'client/vite.config.js'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) stop(); }));
