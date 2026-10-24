// Errors carrying an HTTP status (and optional machine-readable code and details); the app's
// error handler sends them to the client as { error, code, details }.
export class HttpError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const fail = (status, message, extra) => {
  throw new HttpError(status, message, extra);
};
export const notFound = (what = 'Record') => fail(404, `${what} not found`, { code: 'not_found' });
export const conflict = (message, extra = {}) =>
  fail(409, message, { code: extra.code || 'conflict', details: extra.details });
