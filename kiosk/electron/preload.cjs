const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('stech', {
  call: (action, payload) => ipcRenderer.invoke('kiosk:call', action, payload),
  on: (name, callback) => {
    if (!['locked', 'countdown', 'admin'].includes(name)) return;
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(`kiosk:${name}`, listener);
    return () => ipcRenderer.removeListener(`kiosk:${name}`, listener);
  }
});
