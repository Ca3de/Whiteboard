const WHITEBOARD_URL = 'https://whiteboard.fly.dev'; // TODO: match background.js

const statusEl = document.getElementById('status');

async function checkStatus() {
  statusEl.textContent = 'Checking...';
  statusEl.className = '';
  try {
    const res = await fetch(`${WHITEBOARD_URL}/api/ping`);
    const data = await res.json();
    statusEl.textContent = `Connected — ${new Date(data.timestamp).toLocaleTimeString()}`;
    statusEl.className = 'ok';
  } catch {
    statusEl.textContent = 'Unreachable';
    statusEl.className = 'err';
  }
}

document.getElementById('ping-btn').addEventListener('click', checkStatus);
checkStatus();
