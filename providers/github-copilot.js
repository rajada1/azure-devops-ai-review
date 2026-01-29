import { BaseProvider } from './base-provider.js';

/**
 * GitHub Copilot Provider
 * Uses GitHub Models API for users with GitHub Copilot subscription
 */
export class GitHubCopilotProvider extends BaseProvider {
  static get id() {
    return 'github-copilot';
  }

  static get displayName() {
    return 'GitHub Copilot';
  }

  static get description() {
    return 'Use your GitHub Copilot subscription (requires GitHub token)';
  }

  static get requiresApiKey() {
    return true; // GitHub Personal Access Token
  }

  static get supportsCustomUrl() {
    return false;
  }

  static get availableModels() {
    // Default models - will be replaced by dynamic fetch
    return [
      { id: 'gpt-4o', name: 'GPT-4o', description: 'Loading models...' }
    ];
  }

  /**
   * Fetch available models from GitHub Models API
   * @param {string} token - GitHub Personal Access Token
   * @returns {Promise<Array<{id: string, name: string, description: string}>>}
   */
  static async fetchAvailableModels(token) {
    try {
      const response = await fetch('https://models.inference.ai.azure.com/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return GitHubCopilotProvider._parseModelsResponse(data);
    } catch (error) {
      console.error('Failed to fetch GitHub models:', error);
      // Return default models on error
      return [
        { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable, multimodal' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and efficient' },
        { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Anthropic via GitHub' },
        { id: 'o1-preview', name: 'o1 Preview', description: 'Advanced reasoning' },
        { id: 'o1-mini', name: 'o1 Mini', description: 'Fast reasoning' }
      ];
    }
  }

  /**
   * Parse models response from GitHub API
   * @private
   */
  static _parseModelsResponse(data) {
    // Handle array response
    const models = Array.isArray(data) ? data : (data.models || data.data || []);
    
    return models
      .filter(model => {
        // Filter for chat-completion models only
        return model.task === 'chat-completion';
      })
      .map(model => ({
        id: model.name || model.id,
        name: model.friendly_name || model.name || model.id,
        description: model.summary || model.description?.substring(0, 100) || ''
      }))
      .sort((a, b) => {
        // Prioritize popular models
        const priority = ['gpt-4o', 'gpt-4', 'claude', 'o1', 'llama'];
        const aPriority = priority.findIndex(p => a.id.toLowerCase().includes(p));
        const bPriority = priority.findIndex(p => b.id.toLowerCase().includes(p));
        if (aPriority !== -1 && bPriority === -1) return -1;
        if (bPriority !== -1 && aPriority === -1) return 1;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return a.name.localeCompare(b.name);
      });
  }

  constructor(config = {}) {
    super({
      baseUrl: 'https://api.githubcopilot.com',
      ...config
    });
  }

  /**
   * Get the appropriate endpoint based on model
   */
  _getEndpoint() {
    // GitHub Models API endpoint
    return 'https://models.inference.ai.azure.com';
  }

  async testConnection() {
    try {
      // Test with a minimal request
      const response = await fetch(`${this._getEndpoint()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        
        // Check for specific GitHub errors
        if (response.status === 401) {
          return {
            success: false,
            error: 'Invalid GitHub token. Make sure you have a valid Personal Access Token with Copilot access.'
          };
        }
        
        if (response.status === 403) {
          return {
            success: false,
            error: 'Access denied. Ensure your GitHub account has an active Copilot subscription.'
          };
        }
        
        return {
          success: false,
          error: error.error?.message || `HTTP ${response.status}`
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async reviewCode(patchContent, options = {}) {
    const { language = 'English', prTitle = '', prDescription = '' } = options;

    const systemPrompt = this.buildReviewPrompt(language);
    const userMessage = this._buildUserMessage(patchContent, prTitle, prDescription);

    try {
      const response = await fetch(`${this._getEndpoint()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.3,
          max_tokens: 4000
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      return this.parseReviewResponse(content);
    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: GitHubCopilotProvider.id,
        model: this.config.model
      };
    }
  }

  async chat(patchContent, conversationHistory, options = {}) {
    const { language = 'English' } = options;

    const systemPrompt = this.buildChatPrompt(patchContent, language);
    
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory
    ];

    try {
      const response = await fetch(`${this._getEndpoint()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.3,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return {
        response: data.choices?.[0]?.message?.content || 'No response generated',
        provider: GitHubCopilotProvider.id,
        model: this.config.model
      };
    } catch (error) {
      throw new Error(`GitHub Copilot chat error: ${error.message}`);
    }
  }

  _buildUserMessage(patchContent, prTitle, prDescription) {
    let message = '';
    
    if (prTitle) {
      message += `Pull Request: ${prTitle}\n`;
    }
    if (prDescription) {
      message += `Description: ${prDescription}\n\n`;
    }
    
    message += `Code Changes (Git Diff):\n\`\`\`diff\n${patchContent}\n\`\`\``;
    
    return message;
  }
}
