import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, PastePerfectBridge } from '../shared.js';

const bridge: PastePerfectBridge = {
  getState: () => ipcRenderer.invoke('paste-perfect:get-state'),
  cancelTransform: () => ipcRenderer.invoke('paste-perfect:cancel-transform'),
  armPasteMenu: () => ipcRenderer.invoke('paste-perfect:arm-menu'),
  enableNativeIntegration: () => ipcRenderer.invoke('paste-perfect:enable-native'),
  signIn: () => ipcRenderer.invoke('paste-perfect:sign-in'),
  addAccount: () => ipcRenderer.invoke('paste-perfect:add-account'),
  resumeSignIn: (id) => ipcRenderer.invoke('paste-perfect:resume-sign-in', id),
  selectProfile: (id) => ipcRenderer.invoke('paste-perfect:select-profile', id),
  reconnectSharing: () => ipcRenderer.invoke('paste-perfect:reconnect-sharing'),
  refreshModels: () => ipcRenderer.invoke('paste-perfect:refresh-models'),
  cancelSignIn: () => ipcRenderer.invoke('paste-perfect:cancel-sign-in'),
  disconnect: () => ipcRenderer.invoke('paste-perfect:disconnect'),
  openUsage: () => ipcRenderer.invoke('paste-perfect:open-usage'),
  saveRecipe: (input) => ipcRenderer.invoke('paste-perfect:save-recipe', input),
  deleteRecipe: (id) => ipcRenderer.invoke('paste-perfect:delete-recipe', id),
  updateSettings: (settings) => ipcRenderer.invoke('paste-perfect:update-settings', settings),
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state);
    ipcRenderer.on('paste-perfect:state', listener);
    return () => ipcRenderer.removeListener('paste-perfect:state', listener);
  },
};

contextBridge.exposeInMainWorld('pastePerfect', bridge);
