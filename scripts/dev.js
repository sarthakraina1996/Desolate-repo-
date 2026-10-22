// Runs the API (with auto-restart) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  // API on port 3000 by default, restarted when anything in server/ changes.
  spawn(
    process.execPath,
    [
      '--env-file-if-exists=.env',
      '--disable-warning=ExperimentalWarning',
      '--watch-path=server',
      'server/index.js',
    ],
    { stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT || '3000' } },
  ),
  // Vite dev server for the React client.
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'client/vite.config.js'], {
    stdio: 'inherit',
  }),
];
// Ctrl+C, a kill signal, or either process failing stops both.
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) =>
  p.on('exit', (code) => {
    if (code) stop();
  }),
);
