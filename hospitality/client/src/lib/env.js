// Build flavour. The claude.ai web demo runs the API in the browser, inside a frame that
// cannot print, download or upload files, so those controls are hidden there.
export const WEB_DEMO = import.meta.env.VITE_WEB_DEMO === '1';
