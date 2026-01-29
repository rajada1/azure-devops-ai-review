import { BaseProvider } from './base-provider.js';

/**
 * OpenAI-Compatible Provider
 * For any API that follows OpenAI's chat completions format
 * (e.g., LocalAI, vLLM, LM Studio, Azure OpenAI, etc.)
 */
export class OpenAICompatibleProvider extends BaseProvider {
  static get id() {
    return 'openai-compatible';
  }

  static get displayName() {
    return 'OpenAI-Compatible API';
  }

  static get description() {
    return 'Any OpenAI-compatible endpoint (LocalAI, vLLM, LM Studio, Azure OpenAI, etc.)';
  }

  static get requiresApiKey() {
    return false; // Optional - some local servers don't need it
  }

  static get supportsCustomUrl() {
    return true;
  }

  static get availableModels() {
    return [
      { id: 'custom', name: 'Custom Model', description: 'Enter model name manually' }
    ];
  }

  constructor(config = {}) {
    super({
      baseUrl: 'http://localhost:8080/v1',
      model: 'gpt-3.5-turbo',
      ...config
    });
  }

  async testConnection() {
    try {
      // Try models endpoint first
      let response = await fetch(`${this.config.baseUrl}/models`, {
        method: 'GET',
        headers: this._buildHeaders(),
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        return { success: true };
      }

      // Some servers don't have /models, try a minimal completion
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this._buildHeaders()
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
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
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this._buildHeaders()
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
        provider: OpenAICompatibleProvider.id,
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
          ...this._buildHeaders()
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
        provider: OpenAICompatibleProvider.id,
        model: this.config.model
      };
    } catch (error) {
      throw new Error(`API chat error: ${error.message}`);
    }
  }

  _buildHeaders() {
    const headers = {};
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
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
