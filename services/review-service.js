/**
 * Review Service
 * Orchestrates code reviews using the configured AI provider
 */

import { ProviderFactory } from '../providers/provider-factory.js';
import { ConfigService } from './config.js';

export class ReviewService {
  constructor() {
    this.currentProvider = null;
    this.patchContent = null;
    this.conversationHistory = [];
  }

  /**
   * Initialize the review service with the active provider
   * @returns {Promise<boolean>} True if a provider is configured
   */
  async initialize() {
    const providerConfig = await ConfigService.getActiveProviderConfig();
    
    if (!providerConfig) {
      this.currentProvider = null;
      return false;
    }

    try {
      this.currentProvider = ProviderFactory.createFromConfig(providerConfig);
      return true;
    } catch (error) {
      console.error('Failed to initialize provider:', error);
      this.currentProvider = null;
      return false;
    }
  }

  /**
   * Check if a provider is configured and ready
   * @returns {boolean}
   */
  isReady() {
    return this.currentProvider !== null;
  }

  /**
   * Get current provider info
   * @returns {Object|null}
   */
  getProviderInfo() {
    if (!this.currentProvider) return null;
    
    return {
      id: this.currentProvider.constructor.id,
      name: this.currentProvider.constructor.displayName,
      model: this.currentProvider.config.model
    };
  }

  /**
   * Test connection to the current provider
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async testConnection() {
    if (!this.currentProvider) {
      return { success: false, error: 'No provider configured' };
    }
    
    return this.currentProvider.testConnection();
  }

  /**
   * Perform code review
   * @param {string} patchContent - Git diff content
   * @param {Object} options - Review options
   * @returns {Promise<ReviewResult>}
   */
  async reviewCode(patchContent, options = {}) {
    if (!this.currentProvider) {
      return {
        success: false,
        error: 'No AI provider configured. Please configure a provider in the extension settings.'
      };
    }

    // Validate provider configuration
    const validation = this.currentProvider.validate();
    if (!validation.valid) {
      return {
        success: false,
        error: `Provider configuration error: ${validation.errors.join(', ')}`
      };
    }

    // Store patch content for follow-up questions
    this.patchContent = patchContent;
    this.conversationHistory = [];

    // Get settings for language preference
    const settings = await ConfigService.getSettings();
    const reviewOptions = {
      language: settings.language || 'English',
      ...options
    };

    try {
      const result = await this.currentProvider.reviewCode(patchContent, reviewOptions);
      
      // Store initial review in conversation history
      if (result.success) {
        this.conversationHistory.push({
          role: 'assistant',
          content: `Review completed. Summary: ${result.review?.summary || 'No summary'}`
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: this.currentProvider.constructor.id
      };
    }
  }

  /**
   * Ask a follow-up question about the code
   * @param {string} question - User's question
   * @returns {Promise<{response: string}>}
   */
  async askQuestion(question) {
    if (!this.currentProvider) {
      throw new Error('No AI provider configured');
    }

    if (!this.patchContent) {
      throw new Error('No code review in progress. Please run a review first.');
    }

    // Add user question to history
    this.conversationHistory.push({
      role: 'user',
      content: question
    });

    const settings = await ConfigService.getSettings();

    try {
      const result = await this.currentProvider.chat(
        this.patchContent,
        this.conversationHistory,
        { language: settings.language || 'English' }
      );

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: result.response
      });

      return result;
    } catch (error) {
      // Remove failed question from history
      this.conversationHistory.pop();
      throw error;
    }
  }

  /**
   * Clear current review session
   */
  clearSession() {
    this.patchContent = null;
    this.conversationHistory = [];
  }

  /**
   * Switch to a different provider
   * @param {string} providerId
   * @returns {Promise<boolean>}
   */
  async switchProvider(providerId) {
    await ConfigService.setActiveProvider(providerId);
    this.clearSession();
    return this.initialize();
  }
}

// Singleton instance for content script use
let reviewServiceInstance = null;

export function getReviewService() {
  if (!reviewServiceInstance) {
    reviewServiceInstance = new ReviewService();
  }
  return reviewServiceInstance;
}
