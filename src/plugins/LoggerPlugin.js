/**
 * LoggerPlugin — example plugin
 *
 * Demonstrates how to hook into board events without
 * modifying core code (Open/Closed principle).
 */
module.exports = {
  name: 'logger',

  init() {
    console.log('[Logger] Plugin initialized');
  },

  hooks: {
    'stroke:added': () => {
      console.log('[Logger] Stroke added');
    },
    'note:added': ({ note }) => {
      console.log(`[Logger] Note created at (${note.x}, ${note.y})`);
    },
    'note:deleted': ({ id }) => {
      console.log(`[Logger] Note ${id} deleted`);
    },
    'cleared': () => {
      console.log('[Logger] Board cleared');
    }
  }
};
