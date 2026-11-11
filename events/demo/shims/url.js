// node:url stand-in: every server module "lives" in /server.
export const fileURLToPath = () => '/server/module.js';
export default { fileURLToPath };
