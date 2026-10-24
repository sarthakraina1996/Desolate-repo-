// node:sqlite does not exist in the browser; the web demo hands db/connection.js an adapter
// through wrapDb() instead, so this constructor is never called.
export class DatabaseSync {
  constructor() {
    throw new Error('node:sqlite is not available in the browser');
  }
}
