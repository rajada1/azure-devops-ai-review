/**
 * Configuration Service
 * Handles all extension settings storage and retrieval
 */

const STORAGE_KEYS = {
  PROVIDERS: 'providers',           // Array of configured providers
  ACTIVE_PROVIDER: 'activeProvider', // Currently selected provider ID
  AZURE_TOKEN: 'azureDevOpsToken',  // Azure DevOps PAT
  SETTINGS: 'settings'              // General settings
};

const DEFAULT_SETTINGS = {
  language: 'English',
  autoReview: false,
  showNotifications: true
};

export class ConfigService {
  /**
   * Get all configured providers
   * @returns {Promise<Array>}
   */
  static async getProviders() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PROVIDERS);
    return result[STORAGE_KEYS.PROVIDERS] || [];
  }

  /**
   * Save a provider configuration
   * @param {Object} providerConfig - Provider configuration
   * @returns {Promise<void>}
   */
  static async saveProvider(providerConfig) {
    const providers = await this.getProviders();
    
    // Check if provider already exists
    const existingIndex = providers.findIndex(p => p.id === providerConfig.id);
    
    if (existingIndex >= 0) {
      providers[existingIndex] = providerConfig;
    } else {
      providers.push(providerConfig);
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.PROVIDERS]: providers });
  }

  /**
   * Remove a provider configuration
   * @param {string} providerId
   * @returns {Promise<void>}
   */
  static async removeProvider(providerId) {
    const providers = await this.getProviders();
    const filtered = providers.filter(p => p.id !== providerId);
    await chrome.storage.local.set({ [STORAGE_KEYS.PROVIDERS]: filtered });

    // If this was the active provider, clear it
    const activeProvider = await this.getActiveProvider();
    if (activeProvider === providerId) {
      await this.setActiveProvider(null);
    }
  }

  /**
   * Get the currently active provider ID
   * @returns {Promise<string|null>}
   */
  static async getActiveProvider() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_PROVIDER);
    return result[STORAGE_KEYS.ACTIVE_PROVIDER] || null;
  }

  /**
   * Set the active provider
   * @param {string|null} providerId
   * @returns {Promise<void>}
   */
  static async setActiveProvider(providerId) {
    await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_PROVIDER]: providerId });
  }

  /**
   * Get the active provider configuration
   * @returns {Promise<Object|null>}
   */
  static async getActiveProviderConfig() {
    const activeId = await this.getActiveProvider();
    if (!activeId) return null;

    const providers = await this.getProviders();
    return providers.find(p => p.id === activeId) || null;
  }

  /**
   * Get Azure DevOps PAT
   * @returns {Promise<string|null>}
   */
  static async getAzureToken() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.AZURE_TOKEN);
    return result[STORAGE_KEYS.AZURE_TOKEN] || null;
  }

  /**
   * Save Azure DevOps PAT
   * @param {string} token
   * @returns {Promise<void>}
   */
  static async saveAzureToken(token) {
    await chrome.storage.local.set({ [STORAGE_KEYS.AZURE_TOKEN]: token });
  }

  /**
   * Get general settings
   * @returns {Promise<Object>}
   */
  static async getSettings() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
  }

  /**
   * Update settings
   * @param {Object} updates - Partial settings to update
   * @returns {Promise<void>}
   */
  static async updateSettings(updates) {
    const current = await this.getSettings();
    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: { ...current, ...updates }
    });
  }

  /**
   * Export all configuration (for backup)
   * @returns {Promise<Object>}
   */
  static async exportConfig() {
    const [providers, activeProvider, settings] = await Promise.all([
      this.getProviders(),
      this.getActiveProvider(),
      this.getSettings()
    ]);

    return {
      providers,
      activeProvider,
      settings,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import configuration (from backup)
   * @param {Object} config
   * @returns {Promise<void>}
   */
  static async importConfig(config) {
    if (config.providers) {
      await chrome.storage.local.set({ [STORAGE_KEYS.PROVIDERS]: config.providers });
    }
    if (config.activeProvider) {
      await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_PROVIDER]: config.activeProvider });
    }
    if (config.settings) {
      await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: config.settings });
    }
  }

  /**
   * Clear all configuration
   * @returns {Promise<void>}
   */
  static async clearAll() {
    await chrome.storage.local.remove([
      STORAGE_KEYS.PROVIDERS,
      STORAGE_KEYS.ACTIVE_PROVIDER,
      STORAGE_KEYS.AZURE_TOKEN,
      STORAGE_KEYS.SETTINGS
    ]);
  }
}
