// In Vite dev the server runs separately on port 8787.
// In a production build the same Node process serves the client, API and WebSockets.
const DEV_SERVER = `http://${location.hostname}:8787`;

export const isDevServer = import.meta.env.DEV;

/** Origin for socket.io. */
export function socketUrl(): string {
  return isDevServer ? DEV_SERVER : location.origin;
}

/** URL for an API path such as "/api/rooms". Relative in production. */
export function apiUrl(path: string): string {
  return isDevServer ? `${DEV_SERVER}${path}` : path;
}
