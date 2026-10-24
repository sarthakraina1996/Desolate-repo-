// Runs the Hospitality OS API (auto-restart) and its Vite dev server together.
import { spawn } from 'node:child_process';

const env = { ...process.env, PORT: process.env.PORT || '3100' };
const procs = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', '--watch-path=hospitality/server', 'hospitality/server/index.js'], { stdio: 'inherit', env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'hospitality/client/vite.config.js'], { stdio: 'inherit', env }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => code && stop()));
