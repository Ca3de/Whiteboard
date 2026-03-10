/**
 * Whiteboard Extension — Background Service Worker
 *
 * Responsibilities:
 *   1. Keep-alive: ping Glitch every 5 min to prevent sleep
 *   2. Future: fetch tag permissions from work network APIs
 *      and forward to the whiteboard server
 */

const WHITEBOARD_URL = 'https://YOUR-PROJECT.glitch.me'; // TODO: set your Glitch URL
const PING_INTERVAL_MINUTES = 5;

// --- Keep-alive alarm ---

chrome.alarms.create('keep-alive', { periodInMinutes: PING_INTERVAL_MINUTES });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'keep-alive') {
    try {
      const res = await fetch(`${WHITEBOARD_URL}/api/ping`);
      const data = await res.json();
      console.log(`[Whiteboard] Ping OK — ${new Date(data.timestamp).toLocaleTimeString()}`);
    } catch (err) {
      console.warn('[Whiteboard] Ping failed:', err.message);
    }
  }
});

// --- Future: work network data sync ---
// When ready, add another alarm or listener here that:
//   1. Fetches eligible paths / tag permissions from internal APIs
//   2. POSTs them to WHITEBOARD_URL/api/sync
// The NetworkProvider on the server side will handle the rest.
