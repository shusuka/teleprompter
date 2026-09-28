const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('sorot', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  getProject: (id) => ipcRenderer.invoke('projects:get', id),
  createProject: () => ipcRenderer.invoke('projects:create'),
  saveProject: (p) => ipcRenderer.invoke('projects:save', p),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  revealProject: (id) => ipcRenderer.invoke('projects:reveal', id),
  clearSlides: (id) => ipcRenderer.invoke('slides:clear', id),
  writeSlide: (id, name, bytes) => ipcRenderer.invoke('slides:write', id, name, bytes),
  exportPptx: (id, srcPath) => ipcRenderer.invoke('pptx:export', id, srcPath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openAudience: () => ipcRenderer.invoke('audience:open'),
  closeAudience: () => ipcRenderer.invoke('audience:close'),
  isAudienceOpen: () => ipcRenderer.invoke('audience:isOpen'),
  displayCount: () => ipcRenderer.invoke('displays:count'),
  toggleFullscreen: (on) => ipcRenderer.invoke('win:fullscreen', on),
  info: () => ipcRenderer.invoke('app:info'),
  getSecret: (name) => ipcRenderer.invoke('secret:get', name),
  setSecret: (name, value) => ipcRenderer.invoke('secret:set', name, value),
  confirm: (message, detail) => ipcRenderer.invoke('dialog:confirm', message, detail),
  pptWatch: (on) => ipcRenderer.invoke('ppt:watch', on),
  pptCmd: (cmd) => ipcRenderer.invoke('ppt:cmd', cmd),
  onPpt: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('ppt:status', h);
    return () => ipcRenderer.removeListener('ppt:status', h);
  },
  lastUpdate: () => ipcRenderer.invoke('update:last'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  onUpdate: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('update:status', h);
    return () => ipcRenderer.removeListener('update:status', h);
  },
  onAudienceClosed: (cb) => {
    const h = () => cb();
    ipcRenderer.on('audience:closed', h);
    return () => ipcRenderer.removeListener('audience:closed', h);
  },
});
