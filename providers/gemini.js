import { BaseProvider } from './base-provider.js';

/**
 * Google Gemini Provider
 */
export class GeminiProvider extends BaseProvider {
  static get id() {
    return 'gemini';
  }

  static get displayName() {
    return 'Google Gemini';
  }

  static get description() {
    return 'Gemini 2.0, 1.5 Pro, 1.5 Flash';
  }

  static get requiresApiKey() {
    return true;
  }

  static get supportsCustomUrl() {
    return false;
  }

  static get availableModels() {
    return [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Latest and fastest' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Most capable' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast and efficient' }
    ];
  }

  constructor(config = {}) {
    super({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      ...config
    });
  }

  async testConnection() {
    try {
      const response = await fetch(
        `${this.config.baseUrl}/models?key=${this.config.apiKey}`,
        { method: 'GET' }
      );

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
      const response = await fetch(
        `${this.config.baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: `${systemPrompt}\n\n${userMessage}` }]
              }
            ],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 4000
            }
          })
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      return this.parseReviewResponse(content);
    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: GeminiProvider.id,
        model: this.config.model
      };
    }
  }

  async chat(patchContent, conversationHistory, options = {}) {
    const { language = 'English' } = options;

    const systemPrompt = this.buildChatPrompt(patchContent, language);
    
    // Convert conversation history to Gemini format
    const contents = [
      {
        role: 'user',
        parts: [{ text: systemPrompt }]
      },
      {
        role: 'model',
        parts: [{ text: 'I understand. I\'ll help answer questions about this code review.' }]
      }
    ];

    for (const msg of conversationHistory) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      });
    }

    try {
      const response = await fetch(
        `${this.config.baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 2000
            }
          })
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return {
        response: data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated',
        provider: GeminiProvider.id,
        model: this.config.model
      };
    } catch (error) {
      throw new Error(`Gemini chat error: ${error.message}`);
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
