import { BaseProvider } from './base-provider.js';

/**
 * Anthropic Provider - Claude models
 */
export class AnthropicProvider extends BaseProvider {
  static get id() {
    return 'anthropic';
  }

  static get displayName() {
    return 'Anthropic';
  }

  static get description() {
    return 'Claude 3.5, Claude 3 Opus, Sonnet, Haiku';
  }

  static get requiresApiKey() {
    return true;
  }

  static get supportsCustomUrl() {
    return true;
  }

  static get availableModels() {
    return [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Latest balanced model' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Best balance of speed and capability' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Most powerful' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fast and efficient' }
    ];
  }

  constructor(config = {}) {
    super({
      baseUrl: 'https://api.anthropic.com',
      ...config
    });
  }

  async testConnection() {
    try {
      // Anthropic doesn't have a simple models endpoint, so we do a minimal completion
      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.config.model || 'claude-3-5-sonnet-20241022',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
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
      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 4000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }]
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || '';
      
      return this.parseReviewResponse(content);
    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: AnthropicProvider.id,
        model: this.config.model
      };
    }
  }

  async chat(patchContent, conversationHistory, options = {}) {
    const { language = 'English' } = options;

    const systemPrompt = this.buildChatPrompt(patchContent, language);

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 2000,
          system: systemPrompt,
          messages: conversationHistory
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return {
        response: data.content?.[0]?.text || 'No response generated',
        provider: AnthropicProvider.id,
        model: this.config.model
      };
    } catch (error) {
      throw new Error(`Anthropic chat error: ${error.message}`);
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
