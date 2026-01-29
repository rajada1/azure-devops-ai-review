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
    return 'Use your GitHub Copilot subscription (requires GitHub token with models scope)';
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
      { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'Loading models...' }
    ];
  }

  /**
   * Get standard headers for GitHub Models API
   * @private
   */
  static _getHeaders(token) {
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  /**
   * Fetch available models from GitHub Models API
   * @param {string} token - GitHub Personal Access Token
   * @returns {Promise<Array<{id: string, name: string, description: string}>>}
   */
  static async fetchAvailableModels(token) {
    try {
      const response = await fetch('https://models.github.ai/catalog/models', {
        method: 'GET',
        headers: GitHubCopilotProvider._getHeaders(token)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('GitHub Models API error:', response.status, errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return GitHubCopilotProvider._parseModelsResponse(data);
    } catch (error) {
      console.error('Failed to fetch GitHub models:', error);
      // Return default models on error
      return [
        { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'Most capable, multimodal' },
        { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and efficient' },
        { id: 'openai/gpt-4.1', name: 'GPT-4.1', description: 'Latest GPT-4.1' },
        { id: 'openai/o1', name: 'o1', description: 'Advanced reasoning' },
        { id: 'openai/o3-mini', name: 'o3 Mini', description: 'Fast reasoning' },
        { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', description: 'Reasoning model' },
        { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', description: 'Meta Llama' }
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
    
    // Filter out embedding models - only keep text generation models
    const textModels = models.filter(model => {
      const outputModalities = model.supported_output_modalities || [];
      return outputModalities.includes('text') && !outputModalities.includes('embeddings');
    });

    return textModels
      .map(model => ({
        id: model.id,
        name: model.name || model.id,
        description: model.summary || ''
      }))
      .sort((a, b) => {
        // Prioritize popular models
        const priority = ['gpt-4o', 'gpt-4.1', 'gpt-5', 'o1', 'o3', 'o4', 'claude', 'deepseek', 'llama'];
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
      baseUrl: 'https://models.github.ai',
      ...config
    });
  }

  /**
   * Get standard headers for API calls
   */
  _getHeaders() {
    return {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  async testConnection() {
    try {
      // Test with a minimal request
      const response = await fetch('https://models.github.ai/inference/chat/completions', {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify({
          model: this.config.model || 'openai/gpt-4o-mini',
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
            error: 'Invalid GitHub token. Make sure you have a valid Personal Access Token with "models" scope.'
          };
        }
        
        if (response.status === 403) {
          return {
            success: false,
            error: 'Access denied. Ensure your token has the "models" scope enabled.'
          };
        }
        
        return {
          success: false,
          error: error.error?.message || error.message || `HTTP ${response.status}`
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
    const { language = 'English', prTitle = '', prDescription = '', rules = {} } = options;

    const systemPrompt = this.buildReviewPrompt(language, rules);
    const userMessage = this._buildUserMessage(patchContent, prTitle, prDescription);

    try {
      const response = await fetch('https://models.github.ai/inference/chat/completions', {
        method: 'POST',
        headers: this._getHeaders(),
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
        throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
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
      const response = await fetch('https://models.github.ai/inference/chat/completions', {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.3,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
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
