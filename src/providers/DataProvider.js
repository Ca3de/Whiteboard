/**
 * DataProvider — Strategy pattern
 *
 * Abstract interface for fetching tags and trained paths.
 * Swap implementations without changing consumers:
 *   - LocalProvider:   default, manual tag management
 *   - NetworkProvider: future, pulls from work network via extension
 *
 * Each provider implements:
 *   name: string
 *   async fetchTags(): Tag[]
 *   async fetchPaths(): Path[]
 *   async fetchEligiblePaths(associateId): Path[]
 */
class DataProvider {
  get name() {
    throw new Error('DataProvider.name must be implemented');
  }

  async fetchTags() {
    throw new Error('DataProvider.fetchTags() must be implemented');
  }

  async fetchPaths() {
    throw new Error('DataProvider.fetchPaths() must be implemented');
  }

  async fetchEligiblePaths(_associateId) {
    throw new Error('DataProvider.fetchEligiblePaths() must be implemented');
  }
}

module.exports = DataProvider;
