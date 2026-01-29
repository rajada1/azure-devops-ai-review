import { BaseProvider } from './base-provider.js';

/**
 * Azure OpenAI Provider
 * Supports Azure-deployed OpenAI models including Model Router
 */
export class AzureOpenAIProvider extends BaseProvider {
  static get id() {
    return 'azure-openai';
  }

  static get displayName() {
    return 'Azure OpenAI';
  }

  static get description() {
    return 'Azure-deployed OpenAI models (GPT-4, Model Router, etc.)';
  }

  static get requiresApiKey() {
    return true;
  }

  static get supportsCustomUrl() {
    return true;
  }

  static get availableModels() {
    return [
      { id: 'model-router', name: 'Model Router', description: 'Azure AI automatic model selection' },
      { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable model' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and efficient' },
      { id: 'gpt-4', name: 'GPT-4', description: 'Advanced reasoning' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Fast GPT-4' },
      { id: 'gpt-35-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and cost-effective' }
    ];
  }

  static get configFields() {
    return [
      {
        name: 'baseUrl',
        label: 'Azure Endpoint',
        type: 'text',
        required: true,
        placeholder: 'https://your-resource.openai.azure.com/openai/v1/'
      },
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'Your Azure OpenAI API key'
      },
      {
        name: 'model',
        label: 'Deployment Name',
        type: 'text',
        required: true,
        placeholder: 'model-router or your deployment name'
      }
    ];
  }

  constructor(config = {}) {
    super(config);
    
    // Ensure baseUrl ends with /
    if (this.config.baseUrl && !this.config.baseUrl.endsWith('/')) {
      this.config.baseUrl += '/';
    }
  }

  validate() {
    const errors = [];

    if (!this.config.apiKey) {
      errors.push('API key is required');
    }

    if (!this.config.baseUrl) {
      errors.push('Azure endpoint URL is required');
    }

    if (!this.config.model) {
      errors.push('Deployment name is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  _getHeaders() {
    return {
      'api-key': this.config.apiKey,
      'Content-Type': 'application/json'
    };
  }

  _getEndpoint() {
    // Azure OpenAI endpoint format
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    return `${baseUrl}/chat/completions`;
  }

  async testConnection() {
    try {
      const response = await fetch(this._getEndpoint(), {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        
        if (response.status === 401) {
          return {
            success: false,
            error: 'Invalid API key. Check your Azure OpenAI API key.'
          };
        }
        
        if (response.status === 404) {
          return {
            success: false,
            error: 'Deployment not found. Check your endpoint URL and deployment name.'
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

    console.log('[AI Review] Sending request to Azure OpenAI, diff size:', patchContent.length, 'chars');

    try {
      const response = await fetch(this._getEndpoint(), {
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
        console.error('[AI Review] Azure OpenAI error response:', error);
        throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log('[AI Review] Azure OpenAI response:', {
        hasChoices: !!data.choices,
        choicesLength: data.choices?.length,
        finishReason: data.choices?.[0]?.finish_reason,
        contentLength: data.choices?.[0]?.message?.content?.length,
        usage: data.usage
      });
      
      const content = data.choices?.[0]?.message?.content || '';
      
      if (!content) {
        console.error('[AI Review] Empty content from Azure OpenAI. Full response:', JSON.stringify(data).substring(0, 500));
      }
      
      return this.parseReviewResponse(content);
    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: AzureOpenAIProvider.id,
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
      const response = await fetch(this._getEndpoint(), {
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
        provider: AzureOpenAIProvider.id,
        model: this.config.model
      };
    } catch (error) {
      throw new Error(`Azure OpenAI chat error: ${error.message}`);
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
