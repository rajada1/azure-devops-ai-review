import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { GitHubCopilotProvider } from './github-copilot.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { AzureOpenAIProvider } from './azure-openai.js';

/**
 * Provider Factory
 * Creates and manages AI provider instances
 */
export class ProviderFactory {
  static providers = {
    [GitHubCopilotProvider.id]: GitHubCopilotProvider,
    [AzureOpenAIProvider.id]: AzureOpenAIProvider,
    [OpenAIProvider.id]: OpenAIProvider,
    [AnthropicProvider.id]: AnthropicProvider,
    [GeminiProvider.id]: GeminiProvider,
    [OpenAICompatibleProvider.id]: OpenAICompatibleProvider
  };

  /**
   * Get all available provider classes
   * @returns {Array<typeof BaseProvider>}
   */
  static getAvailableProviders() {
    return Object.values(this.providers);
  }

  /**
   * Get provider metadata for UI display
   * @returns {Array<Object>}
   */
  static getProviderList() {
    return Object.values(this.providers).map(Provider => ({
      id: Provider.id,
      displayName: Provider.displayName,
      description: Provider.description,
      requiresApiKey: Provider.requiresApiKey,
      supportsCustomUrl: Provider.supportsCustomUrl,
      availableModels: Provider.availableModels,
      configFields: Provider.configFields || null
    }));
  }

  /**
   * Get a specific provider class by ID
   * @param {string} providerId 
   * @returns {typeof BaseProvider | null}
   */
  static getProviderClass(providerId) {
    return this.providers[providerId] || null;
  }

  /**
   * Create a provider instance
   * @param {string} providerId - Provider ID
   * @param {Object} config - Provider configuration
   * @returns {BaseProvider}
   */
  static createProvider(providerId, config = {}) {
    const ProviderClass = this.providers[providerId];
    
    if (!ProviderClass) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    return new ProviderClass(config);
  }

  /**
   * Create provider from saved configuration
   * @param {Object} savedConfig - Saved provider config from storage
   * @returns {BaseProvider}
   */
  static createFromConfig(savedConfig) {
    if (!savedConfig || !savedConfig.id) {
      throw new Error('Invalid provider configuration');
    }

    return this.createProvider(savedConfig.id, savedConfig);
  }

  /**
   * Validate a provider configuration
   * @param {string} providerId 
   * @param {Object} config 
   * @returns {{valid: boolean, errors: string[]}}
   */
  static validateConfig(providerId, config) {
    try {
      const provider = this.createProvider(providerId, config);
      return provider.validate();
    } catch (error) {
      return {
        valid: false,
        errors: [error.message]
      };
    }
  }

  /**
   * Register a new provider class
   * @param {typeof BaseProvider} ProviderClass 
   */
  static registerProvider(ProviderClass) {
    if (!ProviderClass.id) {
      throw new Error('Provider must have a static id property');
    }
    this.providers[ProviderClass.id] = ProviderClass;
  }
}

// Export individual providers for direct imports
export { 
  OpenAIProvider, 
  AnthropicProvider, 
  GeminiProvider,
  GitHubCopilotProvider,
  OpenAICompatibleProvider 
};
