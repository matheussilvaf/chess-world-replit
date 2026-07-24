const RAW_URL = (import.meta.env.VITE_COLYSEUS_URL || '').trim();

// Dev override: when VITE_COLYSEUS_LOCAL=1 (set as a development env var),
// the client talks to the LOCAL api-server through the Replit dev proxy at
// /api on the same origin as the page. Deriving from location.host keeps it
// working even when the *.replit.dev domain changes between boots.
// Without the flag (e.g. production build), VITE_COLYSEUS_URL is used as-is.
const USE_LOCAL = import.meta.env.VITE_COLYSEUS_LOCAL === '1';

// Accept both https:// and wss:// — normalise to wss:// for the WS client
function toWsUrl(url: string): string {
  return url
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://');
}

function localWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api`;
}

const COLYSEUS_WS_URL = USE_LOCAL ? localWsUrl() : toWsUrl(RAW_URL);

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
