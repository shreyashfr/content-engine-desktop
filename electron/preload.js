const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // LinkedIn operations — these run on the user's machine via stealth browser
  linkedinValidate: (params) => ipcRenderer.invoke('linkedin:validate', params),
  linkedinPost: (params) => ipcRenderer.invoke('linkedin:post', params),
});
