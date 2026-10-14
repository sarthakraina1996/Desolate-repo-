// Entry point. Checks the basics first so common setup problems show a plain-English
// message instead of a stack trace, then starts the app.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13) || (major === 23 && minor < 4)) {
  console.error(`
  Subscription Manager needs Node.js 22.13 or newer, but this computer has ${process.version}.
  Download the "LTS" version from https://nodejs.org, install it, then start the app again.
`);
  process.exit(1);
}

try {
  await import('express');
  await import('nodemailer');
} catch {
  console.error(`
  The app's building blocks are not installed yet. In this folder, run:

      npm install

  then start the app again.
`);
  process.exit(1);
}

// node:sqlite prints an "experimental feature" notice on every start; it is stable
// enough for this app, so keep the console free of it.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  if (type === 'ExperimentalWarning' && String(warning).includes('SQLite')) return;
  emitWarning.call(process, warning, ...args);
};

try {
  await import('./server.js');
} catch (err) {
  console.error(`\n  Could not start Subscription Manager: ${err.message}\n`);
  process.exit(1);
}
