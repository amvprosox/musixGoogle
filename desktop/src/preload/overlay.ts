import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { OverlayApi } from '../shared/channels';
import type { OverlayRenderPayload, OverlaySize } from '../shared/types';

const api: OverlayApi = {
  onRender(listener: (payload: OverlayRenderPayload) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: OverlayRenderPayload): void => {
      listener(payload);
    };
    ipcRenderer.on('overlay:render', wrapped);
    return () => {
      ipcRenderer.removeListener('overlay:render', wrapped);
    };
  },
  reportSize(size: OverlaySize): void {
    ipcRenderer.send('overlay:size', size);
  },
  dismissToast(id: string): void {
    ipcRenderer.send('overlay:toast-dismiss', id);
  },
  selectMenuItem(id: string): void {
    ipcRenderer.send('overlay:menu-select', id);
  },
  closeMenu(): void {
    ipcRenderer.send('overlay:menu-close', null);
  },
};

contextBridge.exposeInMainWorld('musixOverlay', api);
