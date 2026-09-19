import { Injectable } from '@angular/core';

declare global {
  interface Window {
    __BORBOTO_RUNTIME_CONFIG__?: {
      apiBaseUrl?: string;
      socketUrl?: string;
    };
    require?: (moduleName: string) => any;
  }
}

@Injectable({
  providedIn: 'root',
})
export class RuntimeConfigService {
  get isElectron(): boolean {
    return typeof window !== 'undefined' && typeof window.require === 'function';
  }

  get isBrowserClient(): boolean {
    return !this.isElectron;
  }

  get apiBaseUrl(): string {
    const configured = window.__BORBOTO_RUNTIME_CONFIG__?.apiBaseUrl?.trim();
    if (configured) {
      return configured;
    }

    if (this.isElectron) {
      return 'http://127.0.0.1:3000/api';
    }

    return `${window.location.origin}/api`;
  }

  get socketUrl(): string {
    const configured = window.__BORBOTO_RUNTIME_CONFIG__?.socketUrl?.trim();
    if (configured) {
      return configured;
    }

    if (this.isElectron) {
      return 'http://127.0.0.1:3000';
    }

    return window.location.origin;
  }
}
