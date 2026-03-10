/**
 * CacheManager — Decorator pattern over DataProvider
 *
 * Wraps any DataProvider and caches results for the current day.
 * Cache auto-expires at midnight. No persistent storage needed.
 */
class CacheManager {
  constructor(provider) {
    this._provider = provider;
    this._store = new Map();
  }

  get providerName() {
    return this._provider.name;
  }

  _todayKey() {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  }

  _cacheKey(method, args) {
    return `${this._todayKey()}:${method}:${JSON.stringify(args)}`;
  }

  _get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    // Expired if from a different day
    if (!key.startsWith(this._todayKey())) {
      this._store.delete(key);
      return null;
    }
    return entry.data;
  }

  _set(key, data) {
    // Clear stale entries from previous days
    const today = this._todayKey();
    for (const k of this._store.keys()) {
      if (!k.startsWith(today)) this._store.delete(k);
    }
    this._store.set(key, { data, cachedAt: Date.now() });
  }

  async fetchTags() {
    const key = this._cacheKey('fetchTags', []);
    const cached = this._get(key);
    if (cached) return cached;

    const data = await this._provider.fetchTags();
    this._set(key, data);
    return data;
  }

  async fetchPaths() {
    const key = this._cacheKey('fetchPaths', []);
    const cached = this._get(key);
    if (cached) return cached;

    const data = await this._provider.fetchPaths();
    this._set(key, data);
    return data;
  }

  async fetchEligiblePaths(associateId) {
    const key = this._cacheKey('fetchEligiblePaths', [associateId]);
    const cached = this._get(key);
    if (cached) return cached;

    const data = await this._provider.fetchEligiblePaths(associateId);
    this._set(key, data);
    return data;
  }

  invalidate() {
    this._store.clear();
  }
}

module.exports = CacheManager;
