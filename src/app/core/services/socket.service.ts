import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { RuntimeConfigService } from './runtime-config.service';

@Injectable({
  providedIn: 'root',
})
export class SocketService {
  private socket: Socket;
  private readonly runtimeConfig = inject(RuntimeConfigService);

  constructor() {
    this.socket = io(this.runtimeConfig.socketUrl);
  }

  onEvent<T>(eventName: string): Observable<T> {
    return new Observable((observer) => {
      this.socket.on(eventName, (data: T) => {
        observer.next(data);
      });
    });
  }
}
