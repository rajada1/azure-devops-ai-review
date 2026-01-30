/**
 * API Free Provider
 * https://api.apifree.ai - Free API access to Claude and other models
 */

import { BaseProvider } from './base-provider.js';

export class ApiFreeProvider extends BaseProvider {
  static id = 'api-free';
  static displayName = 'API Free (Claude & Others)';
  static description = 'Free API access to Claude and other AI models';
  static requiresApiKey = true;
  static supportsCustomUrl = true;
  static availableModels = [
    'anthropic/claude-sonnet-4.5',
    'anthropic/claude-sonnet-4',
    'anthropic/claude-haiku-3.5',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'google/gemini-2.0-flash',
    'meta/llama-3.3-70b'
  ];
  static configFields = [
    {
      name: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'Enter your API Free key'
    },
    {
      name: 'baseUrl',
      label: 'API URL',
      type: 'text',
      required: false,
      default: 'https://api.apifree.ai/v1',
      placeholder: 'https://api.apifree.ai/v1'
    },
    {
      name: 'model',
      label: 'Model',
      type: 'select',
      required: true,
      default: 'anthropic/claude-sonnet-4.5',
      options: [
        { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5 (200K context)' },
        { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (200K context)' },
        { value: 'anthropic/claude-haiku-3.5', label: 'Claude Haiku 3.5 (200K context)' },
        { value: 'openai/gpt-4o', label: 'GPT-4o (128K context)' },
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (128K context)' },
        { value: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash (1M context)' },
        { value: 'meta/llama-3.3-70b', label: 'Llama 3.3 70B (128K context)' }
      ]
    },
    {
      name: 'contextSize',
      label: 'Model Context Size',
      type: 'select',
      required: false,
      default: '200000',
      options: [
        { value: '32000', label: '32K' },
        { value: '128000', label: '128K (GPT-4o, Llama)' },
        { value: '200000', label: '200K (Claude models)' },
        { value: '1000000', label: '1M (Gemini)' }
      ],
      description: 'Larger context = can analyze bigger PRs without truncation'
    },
    {
      name: 'maxTokens',
      label: 'Max Response Tokens',
      type: 'number',
      required: false,
      default: 8192,
      placeholder: '8192'
    }
  ];

  constructor(config = {}) {
    super(config);
    this.id = 'api-free';
    this.name = 'API Free';
    this.baseUrl = config.baseUrl || 'https://api.apifree.ai/v1';
    // Default to 200K for Claude models
    this.contextSize = parseInt(config.contextSize) || 200000;
  }

  /**
   * Get provider metadata
   */
  static getMetadata() {
    return {
      id: ApiFreeProvider.id,
      name: 'API Free',
      displayName: ApiFreeProvider.displayName,
      description: ApiFreeProvider.description,
      website: 'https://apifree.ai',
      requiresApiKey: ApiFreeProvider.requiresApiKey,
      configFields: ApiFreeProvider.configFields
    };
  }

  /**
   * Get the base URL (from config or default)
   */
  getBaseUrl() {
    return this.config.baseUrl || 'https://api.apifree.ai/v1';
  }

  /**
   * Validate the provider configuration
   */
  async validateConfig() {
    if (!this.config.apiKey) {
      return { valid: false, error: 'API key is required' };
    }
    return { valid: true };
  }

  /**
   * Build headers for API Free requests
   */
  buildHeaders() {
    return {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': 'https://www.apifree.ai',
      'Referer': 'https://www.apifree.ai/'
    };
  }

  /**
   * Test the connection
   */
  async testConnection() {
    const baseUrl = this.getBaseUrl();
    
    try {
      // Try a simple completion request to test the connection
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.config.model || 'anthropic/claude-sonnet-4.5',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10,
          temperature: 1,
          stream: false
        })
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `API error: ${error}` };
      }

      return { 
        success: true, 
        message: 'Connected to API Free successfully',
        model: this.config.model || 'anthropic/claude-sonnet-4.5'
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a code review request
   */
  async reviewCode(patchContent, options = {}) {
    const baseUrl = this.getBaseUrl();
    const model = this.config.model || 'anthropic/claude-sonnet-4.5';
    const maxTokens = parseInt(this.config.maxTokens) || 8192;

    // Calculate max diff size based on context size
    // Reserve ~20% for system prompt + response
    const contextTokens = this.contextSize;
    const reservedTokens = Math.max(8000, Math.floor(contextTokens * 0.2));
    const availableTokens = contextTokens - reservedTokens;
    const maxDiffChars = availableTokens * 4; // ~4 chars per token
    
    let truncatedPatch = patchContent;
    
    if (patchContent.length > maxDiffChars) {
      truncatedPatch = patchContent.substring(0, maxDiffChars) + '\n\n... (diff truncated - ' + (patchContent.length - maxDiffChars) + ' chars omitted)';
      console.log('[API Free] Diff truncated from', patchContent.length, 'to', maxDiffChars, 'chars (context:', contextTokens, 'tokens)');
    } else {
      console.log('[API Free] Diff fits in context, no truncation needed (', patchContent.length, 'chars, max:', maxDiffChars, ')');
    }

    const systemPrompt = this.buildReviewPrompt(options.language, options.rules);

    const messages = [
      { role: 'user', content: `${systemPrompt}\n\nPlease review the following code changes:\n\n${truncatedPatch}` }
    ];

    console.log('[API Free] Sending request, diff size:', truncatedPatch.length, 'chars');

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: model,
          messages: messages,
          max_tokens: maxTokens,
          temperature: 1,
          stream: false
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No response content from API Free');
      }

      // Parse the JSON response
      const review = this.parseReviewResponse(content);

      return {
        success: true,
        review: review,
        usage: data.usage,
        model: model,
        provider: 'API Free'
      };
    } catch (error) {
      console.error('[API Free] Review error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Chat with the AI about the code
   */
  async chat(patchContent, conversationHistory, options = {}) {
    const baseUrl = this.getBaseUrl();
    const model = this.config.model || 'anthropic/claude-sonnet-4.5';
    const maxTokens = this.config.maxTokens || 8192;

    const systemContext = `You are a helpful code review assistant. You have already reviewed the following code changes and are now answering follow-up questions.

CODE CHANGES:
${patchContent}

Answer questions about this code. Be concise but thorough. If asked about specific issues, reference the relevant code.`;

    // Prepend system context to first user message since API might not support system role
    const messages = conversationHistory.map((msg, idx) => {
      if (idx === 0 && msg.role === 'user') {
        return { ...msg, content: `${systemContext}\n\n${msg.content}` };
      }
      return msg;
    });

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: model,
          messages: messages,
          max_tokens: maxTokens,
          temperature: 1,
          stream: false
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      return {
        success: true,
        response: content,
        usage: data.usage,
        model: model
      };
    } catch (error) {
      console.error('[API Free] Chat error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}
