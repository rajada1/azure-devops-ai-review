import { BaseProvider } from './base-provider.js';

/**
 * OpenAI Provider - GPT-4, GPT-4o, etc.
 */
export class OpenAIProvider extends BaseProvider {
  static get id() {
    return 'openai';
  }

  static get displayName() {
    return 'OpenAI';
  }

  static get description() {
    return 'GPT-4, GPT-4o, GPT-3.5 Turbo';
  }

  static get requiresApiKey() {
    return true;
  }

  static get supportsCustomUrl() {
    return true;
  }

  static get availableModels() {
    return [
      { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable, multimodal' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Latest GPT-4 Turbo' },
      { id: 'gpt-4', name: 'GPT-4', description: 'Original GPT-4' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and cost-effective' }
    ];
  }

  constructor(config = {}) {
    super({
      baseUrl: 'https://api.openai.com/v1',
      ...config
    });
  }

  async testConnection() {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`
        }
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
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
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
        provider: OpenAIProvider.id,
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
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
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
        provider: OpenAIProvider.id,
        model: this.config.model
      };
    } catch (error) {
      throw new Error(`OpenAI chat error: ${error.message}`);
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
