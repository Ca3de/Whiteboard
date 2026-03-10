/**
 * PluginManager — Open/Closed principle
 *
 * Core board logic is closed for modification, open for extension.
 * New features (data sources, validators, event hooks) are added
 * as plugins without touching core code.
 */
class PluginManager {
  constructor() {
    this._hooks = {};
    this._plugins = [];
  }

  /**
   * Register a plugin. Each plugin is an object with:
   *   name: string
   *   init(context): called once on startup
   *   hooks: { hookName: handlerFn } — optional event hooks
   */
  register(plugin) {
    this._plugins.push(plugin);

    if (plugin.hooks) {
      for (const [hook, handler] of Object.entries(plugin.hooks)) {
        if (!this._hooks[hook]) this._hooks[hook] = [];
        this._hooks[hook].push(handler);
      }
    }
  }

  async initAll(context) {
    for (const plugin of this._plugins) {
      if (typeof plugin.init === 'function') {
        await plugin.init(context);
      }
    }
  }

  async trigger(hookName, data) {
    const handlers = this._hooks[hookName] || [];
    let result = data;
    for (const handler of handlers) {
      const out = await handler(result);
      if (out !== undefined) result = out;
    }
    return result;
  }
}

module.exports = PluginManager;
