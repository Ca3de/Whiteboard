const DataProvider = require('./DataProvider');

/**
 * LocalProvider — default strategy
 *
 * Tags are managed manually via the UI. Paths are hardcoded defaults.
 * This is the starting point; swap to NetworkProvider when on work network.
 */
class LocalProvider extends DataProvider {
  get name() {
    return 'local';
  }

  async fetchTags() {
    return [];
  }

  async fetchPaths() {
    return [
      { id: 'backlog', name: 'Backlog' },
      { id: 'in-progress', name: 'In Progress' },
      { id: 'review', name: 'Review' },
      { id: 'done', name: 'Done' }
    ];
  }

  async fetchEligiblePaths(_associateId) {
    // No restrictions in local mode — all paths eligible
    return this.fetchPaths();
  }
}

module.exports = LocalProvider;
