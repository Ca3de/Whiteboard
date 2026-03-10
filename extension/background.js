/**
 * Whiteboard Extension — Background Service Worker
 *
 * Responsibilities:
 *   - Fetch tag permissions from work network APIs
 *     and forward them to the whiteboard server
 */

const WHITEBOARD_URL = 'https://whiteboard.fly.dev'; // TODO: set your Fly.io URL

// --- Work network data sync ---
// When ready, add an alarm or listener here that:
//   1. Fetches eligible paths / tag permissions from internal APIs
//   2. POSTs them to WHITEBOARD_URL/api/sync
// The NetworkProvider on the server side will handle the rest.
