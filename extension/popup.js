const WHITEBOARD_URL = 'https://YOUR-PROJECT.glitch.me'; // TODO: match background.js

const statusEl = document.getElementById('status');

async function ping() {
  statusEl.textContent = 'Pinging...';
  statusEl.className = '';
  try {
    const res = await fetch(`${WHITEBOARD_URL}/api/ping`);
    const data = await res.json();
    statusEl.textContent = `Awake — ${new Date(data.timestamp).toLocaleTimeString()}`;
    statusEl.className = 'ok';
  } catch {
    statusEl.textContent = 'Unreachable';
    statusEl.className = 'err';
  }
}

document.getElementById('ping-btn').addEventListener('click', ping);
ping();
