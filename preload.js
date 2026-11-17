const { contextBridge, ipcRenderer } = require('electron');
const portArgument = process.argv.find(argument => argument.startsWith('--borboto-port='));
const port = Number(portArgument?.split('=')[1]) || 3000;
contextBridge.exposeInMainWorld('__BORBOTO_RUNTIME_CONFIG__', Object.freeze({
  apiBaseUrl: `http://127.0.0.1:${port}/api`, socketUrl: `http://127.0.0.1:${port}`,
}));

const invokes = new Set(['get-hardware-id', 'get-license-status', 'get-system-printers', 'print-ticket-silent', 'get-app-version', 'get-update-state', 'check-for-updates', 'download-update', 'quit-and-install']);
const events = new Set(['init-license-view', 'submit-license-key-response', 'app-notification', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'update-error']);
function validPrint(payload) {
  return payload && typeof payload === 'object' && typeof payload.content === 'string' && payload.content.length <= 200000 &&
    typeof payload.printerName === 'string' && payload.printerName.length > 0 && payload.printerName.length <= 200;
}
function listen(channel, callback, once) {
  if (!events.has(channel) || typeof callback !== 'function') throw new Error('Canal no permitido');
  const listener = (_event, payload) => callback(undefined, payload);
  if (once) ipcRenderer.once(channel, listener);
  else ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('borbotoElectron', Object.freeze({
  invoke(channel, payload) {
    if (!invokes.has(channel) || (channel === 'print-ticket-silent' && !validPrint(payload))) return Promise.reject(new Error('IPC no permitido'));
    return ipcRenderer.invoke(channel, payload);
  },
  send(channel, payload) {
    if (channel !== 'submit-license-key' || typeof payload !== 'string' || payload.length > 20000) throw new Error('IPC no permitido');
    ipcRenderer.send(channel, payload);
  },
  on: (channel, callback) => listen(channel, callback, false),
  once: (channel, callback) => listen(channel, callback, true),
}));