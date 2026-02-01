import { BaseProvider } from './base-provider.js';
import { CopilotAuthService } from '../services/copilot-auth.js';

/**
 * GitHub Copilot Provider
 * Uses GitHub Copilot Chat API (same as VS Code/Zed)
 * Requires active GitHub Copilot subscription
 */
export class GitHubCopilotProvider extends BaseProvider {
  static get id() {
    return 'github-copilot';
  }

  static get displayName() {
    return 'GitHub Copilot';
  }

  static get description() {
    return 'Use your GitHub Copilot subscription (GPT-4o, Claude, Gemini and more)';
  }

  static get requiresApiKey() {
    return false; // Uses OAuth flow instead
  }

  static get supportsCustomUrl() {
    return false;
  }

  static get availableModels() {
    // Default models - will be replaced by dynamic fetch after auth
    return [
      { id: 'gpt-4o', name: 'GPT-4o', description: 'Default model' }
    ];
  }

  /**
   * Fetch available models from Copilot API
   * @returns {Promise<Array<{id: string, name: string, description: string}>>}
   */
  static async fetchAvailableModels() {
    try {
      return await CopilotAuthService.fetchModels();
    } catch (error) {
      console.error('Failed to fetch Copilot models:', error);
      // Return default models on error
      return [
        { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable, multimodal', isDefault: true },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and efficient' },
        { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', description: 'Anthropic' },
        { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Anthropic' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Google' },
        { id: 'o3-mini', name: 'o3 Mini', description: 'Fast reasoning' }
      ];
    }
  }

  constructor(config = {}) {
    super(config);
  }

  /**
   * Test connection to Copilot API
   */
  async testConnection() {
    try {
      const status = await CopilotAuthService.getAuthStatus();
      
      if (!status.authenticated) {
        return {
          success: false,
          error: 'Not signed in. Click "Sign in with GitHub" to authenticate.'
        };
      }

      if (!status.hasSubscription) {
        return {
          success: false,
          error: status.error || 'No active Copilot subscription found.'
        };
      }

      // Try a minimal request to verify
      const credentials = await CopilotAuthService.getValidCredentials();
      
      const response = await fetch(`${credentials.endpoint}/chat/completions`, {
        method: 'POST',
        headers: await CopilotAuthService.getApiHeaders(),
        body: JSON.stringify({
          model: this.config.model || 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        })
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `API error: ${error}`
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
      const credentials = await CopilotAuthService.getValidCredentials();
      
      if (!credentials) {
        return {
          success: false,
          error: 'Not authenticated. Please sign in with GitHub Copilot.',
          provider: GitHubCopilotProvider.id,
          model: this.config.model
        };
      }

      const model = this.config.model || 'gpt-4o';
      
      // Build request body
      const requestBody = {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 16000
      };

      // Add JSON response format for models that support it
      // GPT-4o and most OpenAI models support this
      if (model.includes('gpt-4') || model.includes('gpt-3') || model.includes('o1') || model.includes('o3')) {
        requestBody.response_format = { type: 'json_object' };
      }

      const response = await fetch(`${credentials.endpoint}/chat/completions`, {
        method: 'POST',
        headers: await CopilotAuthService.getApiHeaders(),
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData = {};
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }
        throw new Error(errorData.error?.message || errorData.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      // Debug log
      console.log('[AI Review] Copilot response:', {
        model: this.config.model,
        contentLength: content.length,
        contentPreview: content.substring(0, 200)
      });
      
      if (!content) {
        console.error('[AI Review] Empty response from Copilot API:', data);
        return {
          success: false,
          error: 'Empty response from API. The model may not have returned any content.',
          provider: GitHubCopilotProvider.id,
          model: this.config.model
        };
      }
      
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
      const credentials = await CopilotAuthService.getValidCredentials();
      
      if (!credentials) {
        throw new Error('Not authenticated. Please sign in with GitHub Copilot.');
      }

      const response = await fetch(`${credentials.endpoint}/chat/completions`, {
        method: 'POST',
        headers: await CopilotAuthService.getApiHeaders(),
        body: JSON.stringify({
          model: this.config.model || 'gpt-4o',
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
