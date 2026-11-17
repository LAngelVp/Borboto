// src/app/core/services/update.service.ts
import { Injectable, NgZone, computed, inject, signal } from '@angular/core';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unavailable';

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  progress: UpdateProgress | null;
  message: string | null;
  detail: string | null;
  errorCode: string | null;
  statusCode: number | null;
}

export interface UpdateIpcResult {
  ok?: boolean;
  reason?: string;
  message?: string;
  detail?: string | null;
  code?: string | null;
  statusCode?: number | null;
  version?: string | null;
  isUpdateAvailable?: boolean;
  state?: Partial<UpdateState>;
}

const INITIAL_STATE: UpdateState = {
  status: 'idle',
  currentVersion: '—',
  availableVersion: null,
  releaseNotes: null,
  releaseDate: null,
  progress: null,
  message: null,
  detail: null,
  errorCode: null,
  statusCode: null,
};

/**
 * Puente seguro entre la UI de Angular y el actualizador de Electron.
 * Todos los canales usados aquí están permitidos expresamente por preload.js.
 */
@Injectable({
  providedIn: 'root',
})
export class UpdateService {
  private readonly zone = inject(NgZone);

  readonly state = signal<UpdateState>({ ...INITIAL_STATE });
  readonly isElectron = signal<boolean>(false);
  readonly busy = signal<boolean>(false);

  readonly canCheck = computed(
    () =>
      this.isElectron() &&
      !this.busy() &&
      this.state().status !== 'checking' &&
      this.state().status !== 'downloading' &&
      this.state().status !== 'unavailable',
  );
  readonly canDownload = computed(
    () => this.state().status === 'available',
  );
  readonly canInstall = computed(
    () => this.isElectron() && this.state().status === 'downloaded',
  );

  private initialized = false;
  private listenersRegistered = false;
  private ipc: any = null;

  constructor() {
    this.initialize();
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    const hasBridge = typeof window !== 'undefined' && Boolean(window.borbotoElectron);
    const hasRequire = typeof window !== 'undefined' && typeof window.require === 'function';
    this.log('info', 'Inicializando servicio de actualizaciones', {
      hasBridge,
      hasRequire,
    });

    if (!this.ensureIpc()) {
      this.log(
        'warn',
        'Puente IPC no disponible: la actualización automática solo funciona en la app de escritorio.',
      );
      this.state.set({
        ...INITIAL_STATE,
        status: 'unavailable',
        message: 'La actualización automática solo está disponible en la aplicación de escritorio.',
        detail: `window.borbotoElectron=${hasBridge} | window.require=${hasRequire}`,
      });
    }
  }

  async checkForUpdates(): Promise<UpdateIpcResult> {
    this.log('info', 'Solicitud manual de búsqueda de actualizaciones');
    if (!this.ensureIpc()) {
      return { ok: false, message: 'La actualización no está disponible en este entorno.' };
    }

    this.busy.set(true);
    this.zone.run(() =>
      this.state.update((current) => ({
        ...current,
        status: 'checking',
        message: null,
        detail: null,
      })),
    );

    try {
      const result = (await this.ipc.invoke('check-for-updates')) as UpdateIpcResult | null;
      this.log('info', 'Respuesta de check-for-updates', {
        ok: result?.ok,
        status: result?.state?.status,
        version: result?.version,
        detail: result?.detail,
      });
      this.mergeResult(result);
      return result ?? { ok: true };
    } catch (error) {
      this.log('error', 'Excepción IPC al buscar actualizaciones', this.describeError(error));
      const result: UpdateIpcResult = {
        ok: false,
        message: 'No se pudo buscar actualizaciones. Revisa la conexión a internet.',
        detail: this.describeError(error).message,
      };
      this.markError(result.message ?? null, error);
      return result;
    } finally {
      this.busy.set(false);
    }
  }

  async downloadUpdate(): Promise<UpdateIpcResult> {
    this.log('info', 'Solicitud manual de descarga de actualización');
    if (!this.ensureIpc()) {
      return { ok: false, message: 'La actualización no está disponible en este entorno.' };
    }

    this.busy.set(true);
    this.zone.run(() =>
      this.state.update((current) => ({
        ...current,
        status: 'downloading',
        message: null,
        detail: null,
        progress: null,
      })),
    );

    try {
      const result = (await this.ipc.invoke('download-update')) as UpdateIpcResult | null;
      this.log('info', 'Respuesta de download-update', {
        ok: result?.ok,
        status: result?.state?.status,
        detail: result?.detail,
      });
      this.mergeResult(result);
      return result ?? { ok: true };
    } catch (error) {
      this.log('error', 'Excepción IPC al descargar la actualización', this.describeError(error));
      const result: UpdateIpcResult = {
        ok: false,
        message: 'No se pudo descargar la actualización. Revisa la conexión a internet.',
        detail: this.describeError(error).message,
      };
      this.markError(result.message ?? null, error);
      return result;
    } finally {
      this.busy.set(false);
    }
  }

  async quitAndInstall(): Promise<UpdateIpcResult> {
    this.log('info', 'Solicitud de reinicio e instalación de la actualización');
    if (!this.ensureIpc()) {
      return { ok: false, message: 'La actualización no está disponible en este entorno.' };
    }

    try {
      const result = (await this.ipc.invoke('quit-and-install')) as UpdateIpcResult | null;
      this.log('info', 'Respuesta de quit-and-install', {
        ok: result?.ok,
        message: result?.message,
      });
      this.mergeResult(result);
      return result ?? { ok: true };
    } catch (error) {
      this.log('error', 'Excepción IPC al iniciar el instalador', this.describeError(error));
      const result: UpdateIpcResult = {
        ok: false,
        message: 'No se pudo iniciar el instalador de la actualización.',
        detail: this.describeError(error).message,
      };
      this.markError(result.message ?? null, error);
      return result;
    }
  }

  private ensureIpc(): boolean {
    if (this.ipc) {
      return true;
    }

    const ipc = this.getIpc();
    if (!ipc) {
      return false;
    }

    this.ipc = ipc;
    this.isElectron.set(true);
    this.log('info', 'Puente IPC del actualizador conectado');
    this.registerEvents();
    void this.syncInitialState();
    return true;
  }

  private getIpc(): any | null {
    if (typeof window === 'undefined') {
      return null;
    }

    if (window.borbotoElectron) {
      return window.borbotoElectron;
    }

    if (!window.require) {
      return null;
    }

    try {
      const { ipcRenderer } = window.require('electron');
      return ipcRenderer ?? null;
    } catch (error) {
      this.log('warn', 'No se pudo cargar ipcRenderer desde window.require', this.describeError(error));
      return null;
    }
  }

  private registerEvents(): void {
    if (!this.ipc || this.listenersRegistered) {
      return;
    }
    this.listenersRegistered = true;

    const apply = (channel: string, payload: any, fallbackStatus: UpdateStatus) => {
      this.log('info', `Evento IPC recibido: ${channel}`, payload?.state ?? payload);
      this.zone.run(() => {
        const incoming = payload?.state;
        if (incoming && typeof incoming === 'object') {
          this.state.set({ ...this.state(), ...incoming });
          return;
        }
        this.state.update((current) => ({ ...current, status: fallbackStatus }));
      });
    };

    this.ipc.on('update-available', (_event: unknown, payload: any) =>
      apply('update-available', payload, 'available'),
    );
    this.ipc.on('update-not-available', (_event: unknown, payload: any) =>
      apply('update-not-available', payload, 'not-available'),
    );
    this.ipc.on('download-progress', (_event: unknown, payload: any) =>
      apply('download-progress', payload, 'downloading'),
    );
    this.ipc.on('update-downloaded', (_event: unknown, payload: any) =>
      apply('update-downloaded', payload, 'downloaded'),
    );
    this.ipc.on('update-error', (_event: unknown, payload: any) =>
      apply('update-error', payload, 'error'),
    );
  }

  private async syncInitialState(): Promise<void> {
    this.log('info', 'Sincronizando versión y estado inicial del actualizador');

    try {
      const [version, remoteState] = await Promise.all([
        this.ipc.invoke('get-app-version'),
        this.ipc.invoke('get-update-state'),
      ]);

      this.log('info', 'Estado inicial recibido', { version, remoteState });

      this.zone.run(() => {
        const base = remoteState && typeof remoteState === 'object' ? remoteState : {};
        this.state.set({
          ...this.state(),
          ...base,
          currentVersion:
            typeof version === 'string' && version.trim()
              ? version
              : base.currentVersion || this.state().currentVersion,
        });
      });
    } catch (error) {
      const description = this.describeError(error);
      this.log('error', 'No se pudo sincronizar el estado inicial del actualizador', description);
      this.zone.run(() =>
        this.state.update((current) => ({
          ...current,
          message:
            current.message ?? 'No se pudo consultar el estado inicial del actualizador.',
          detail: current.detail ?? description.message,
        })),
      );
    }
  }

  private mergeResult(result: UpdateIpcResult | null): void {
    this.zone.run(() => {
      if (result?.state && typeof result.state === 'object') {
        this.state.set({ ...this.state(), ...result.state });
      }

      if (result?.ok === false) {
        this.state.update((current) => {
          if (current.status === 'downloaded') {
            return current;
          }

          const nextStatus: UpdateStatus =
            result.reason === 'not-packaged' ? 'unavailable' : 'error';

          return {
            ...current,
            status: nextStatus,
            message: result.message ?? current.message,
            detail: result.detail ?? current.detail,
            errorCode: result.code ?? current.errorCode,
            statusCode: result.statusCode ?? current.statusCode,
          };
        });
      }
    });
  }

  private markError(message: string | null, error?: unknown): void {
    const detail = error ? this.describeError(error).message : null;
    this.zone.run(() =>
      this.state.update((current) => ({
        ...current,
        status: 'error',
        message,
        detail: detail ?? current.detail,
      })),
    );
  }

  private describeError(error: unknown): { name: string; message: string; stack?: string } {
    if (error instanceof Error) {
      return { name: error.name, message: error.message, stack: error.stack };
    }

    return { name: 'Error', message: String(error) };
  }

  private log(level: 'info' | 'warn' | 'error', message: string, ...extra: unknown[]): void {
    const text = `[UPDATER] ${message}`;
    if (level === 'error') {
      console.error(text, ...extra);
      return;
    }
    if (level === 'warn') {
      console.warn(text, ...extra);
      return;
    }
    console.log(text, ...extra);
  }
}
