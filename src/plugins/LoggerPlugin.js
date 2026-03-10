/**
 * LoggerPlugin — example plugin
 *
 * Demonstrates how to hook into board events without
 * modifying core code (Open/Closed principle).
 * Add new plugins the same way — no core changes needed.
 */
module.exports = {
  name: 'logger',

  init() {
    console.log('[Logger] Plugin initialized');
  },

  hooks: {
    'tag:created': ({ tag }) => {
      console.log(`[Logger] Tag created: "${tag.text}" in ${tag.pathId}`);
    },
    'tag:moved': ({ id, pathId }) => {
      console.log(`[Logger] Tag ${id} moved to ${pathId}`);
    },
    'tag:deleted': ({ id }) => {
      console.log(`[Logger] Tag ${id} deleted`);
    }
  }
};
