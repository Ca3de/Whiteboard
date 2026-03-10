const DataProvider = require('./DataProvider');

/**
 * NetworkProvider — future strategy (stub)
 *
 * Will pull tags and trained paths from the work network
 * via a browser extension or internal API. This stub shows
 * the contract; fill in when on the work network.
 *
 * Expected flow:
 *   1. Extension injects auth token or session cookie
 *   2. This provider calls internal API endpoints
 *   3. Results are passed through the CacheManager
 */
class NetworkProvider extends DataProvider {
  constructor({ baseUrl, authToken } = {}) {
    super();
    this._baseUrl = baseUrl || '';
    this._authToken = authToken || '';
  }

  get name() {
    return 'network';
  }

  async fetchTags() {
    // TODO: GET {baseUrl}/api/tags with auth header
    throw new Error('NetworkProvider not yet connected — requires work network');
  }

  async fetchPaths() {
    // TODO: GET {baseUrl}/api/paths
    throw new Error('NetworkProvider not yet connected — requires work network');
  }

  async fetchEligiblePaths(_associateId) {
    // TODO: GET {baseUrl}/api/associates/{id}/eligible-paths
    throw new Error('NetworkProvider not yet connected — requires work network');
  }
}

module.exports = NetworkProvider;
