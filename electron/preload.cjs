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
  confirm: (message, detail) => ipcRenderer.invoke('dialog:confirm', message, detail),
  onAudienceClosed: (cb) => {
    const h = () => cb();
    ipcRenderer.on('audience:closed', h);
    return () => ipcRenderer.removeListener('audience:closed', h);
  },
});
