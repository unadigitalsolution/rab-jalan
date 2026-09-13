
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alfastecAPI', Object.freeze({
  auth: Object.freeze({
    status: () => ipcRenderer.invoke('auth:status'),
    createAdmin: (username, password, securityQuestion, securityAnswer) =>
      ipcRenderer.invoke('auth:create-admin', username, password, securityQuestion, securityAnswer),
    login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
    changePassword: (userId, oldPassword, newPassword) =>
      ipcRenderer.invoke('auth:change-password', userId, oldPassword, newPassword),
    securityQuestion: (username) => ipcRenderer.invoke('auth:security-question', username),
    resetPassword: (username, answer, newPassword) =>
      ipcRenderer.invoke('auth:reset-password', username, answer, newPassword)
  }),
  license: Object.freeze({
    trialStatus: () => ipcRenderer.invoke('license:trial-status'),
    activate: (licenseKey, profil) => ipcRenderer.invoke('license:activate', licenseKey, profil),
    localStatus: () => ipcRenderer.invoke('license:local-status')
  }),
  branding: Object.freeze({
    get: () => ipcRenderer.invoke('branding:get'),
    save: (data) => ipcRenderer.invoke('branding:save', data)
  }),
  database: Object.freeze({
    integrity: () => ipcRenderer.invoke('db:integrity'),
    backup: () => ipcRenderer.invoke('db:backup'),
    stats: () => ipcRenderer.invoke('db:stats'),
    storageLoad: () => ipcRenderer.invoke('storage:load'),
    storageSet: (key, value) => ipcRenderer.invoke('storage:set', key, value),
    storageRemove: (key) => ipcRenderer.invoke('storage:remove', key),
    saveProject: (project) => ipcRenderer.invoke('project:save', project),
    updateProject: (id, patch) => ipcRenderer.invoke('project:update', id, patch),
    deleteProject: (id) => ipcRenderer.invoke('project:delete', id),
    projectsList: () => ipcRenderer.invoke('projects:list'),
    syncMasterData: (table, rows) => ipcRenderer.invoke('data:sync-master', table, rows)
  }),
  support: Object.freeze({
    whatsapp: (message) => ipcRenderer.invoke('app:open-whatsapp', message)
  }),
  network: Object.freeze({
    lanInfo: () => ipcRenderer.invoke('network:lan-info'),
    toggleSync: (enabled) => ipcRenderer.invoke('network:toggle-sync', enabled)
  })
}));
