declare module '@colyseus/tools' {
  import type { Server } from '@colyseus/core';
  import type { Application } from 'express';

  export interface ConfigOptions {
    initializeGameServer?: (gameServer: Server) => void;
    initializeExpress?: (app: Application) => void;
  }

  export function listen(config: ConfigOptions, port?: number): void;
}

declare module '@colyseus/monitor' {
  import type { RequestHandler } from 'express';
  export function monitor(): RequestHandler;
}
