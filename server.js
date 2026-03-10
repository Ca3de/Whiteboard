const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const PluginManager = require('./src/core/PluginManager');
const Board = require('./src/core/Board');
const CacheManager = require('./src/cache/CacheManager');
const LocalProvider = require('./src/providers/LocalProvider');
const LoggerPlugin = require('./src/plugins/LoggerPlugin');

// --- Bootstrap ---

const plugins = new PluginManager();
const provider = new CacheManager(new LocalProvider());

async function start() {
  const paths = await provider.fetchPaths();

  const board = new Board({
    paths,
    onEvent: (eventName, data) => {
      plugins.trigger(eventName, data);
    }
  });

  // Register plugins (add more here — no core changes needed)
  plugins.register(LoggerPlugin);
  await plugins.initAll({ board, provider });

  // --- HTTP ---

  const app = express();
  const server = http.createServer(app);
  app.use(express.static(path.join(__dirname, 'public')));

  // REST endpoint for provider info (useful for future extension handshake)
  app.get('/api/provider', (_req, res) => {
    res.json({ provider: provider.providerName });
  });

  // --- WebSocket ---

  const wss = new WebSocket.Server({ server });

  function broadcast(data, sender) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
      if (client !== sender && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'init', state: board.state }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {
        case 'tag:create': {
          const tag = board.createTag({
            id: msg.id, text: msg.text, pathId: msg.pathId, color: msg.color
          });
          if (tag) broadcast({ type: 'tag:created', tag }, ws);
          break;
        }
        case 'tag:move': {
          const tag = board.moveTag(msg.id, msg.pathId);
          if (tag) broadcast({ type: 'tag:moved', id: msg.id, pathId: msg.pathId }, ws);
          break;
        }
        case 'tag:delete': {
          if (board.deleteTag(msg.id)) {
            broadcast({ type: 'tag:deleted', id: msg.id }, ws);
          }
          break;
        }
      }
    });
  });

  // --- Listen ---

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Whiteboard running at http://localhost:${PORT}`);
    console.log(`Provider: ${provider.providerName}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
