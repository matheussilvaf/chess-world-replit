const COLYSEUS_WS_URL = import.meta.env.VITE_COLYSEUS_URL || '';

function wsToHttp(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://');
}

export function getColyseusWsUrl(): string {
  return COLYSEUS_WS_URL;
}

export function getColyseusHttpUrl(): string {
  return wsToHttp(COLYSEUS_WS_URL);
}

export function isColyseusConfigured(): boolean {
  return COLYSEUS_WS_URL.length > 0;
}
