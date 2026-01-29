/**
 * Base AI Provider - Abstract class for all AI providers
 * All providers must extend this class and implement the required methods
 */
export class BaseProvider {
  /**
   * @param {Object} config - Provider configuration
   * @param {string} config.apiKey - API key (if required)
   * @param {string} config.baseUrl - Base URL for API calls
   * @param {string} config.model - Model to use
   */
  constructor(config = {}) {
    if (new.target === BaseProvider) {
      throw new Error('BaseProvider is abstract and cannot be instantiated directly');
    }
    
    this.config = {
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl || '',
      model: config.model || this.getDefaultModel(),
      ...config
    };
  }

  /**
   * Get provider name (unique identifier)
   * @returns {string}
   */
  static get id() {
    throw new Error('Provider must implement static id getter');
  }

  /**
   * Get display name for UI
   * @returns {string}
   */
  static get displayName() {
    throw new Error('Provider must implement static displayName getter');
  }

  /**
   * Get provider description
   * @returns {string}
   */
  static get description() {
    return '';
  }

  /**
   * Check if this provider requires an API key
   * @returns {boolean}
   */
  static get requiresApiKey() {
    return true;
  }

  /**
   * Check if this provider supports custom base URL
   * @returns {boolean}
   */
  static get supportsCustomUrl() {
    return false;
  }

  /**
   * Get available models for this provider
   * @returns {Array<{id: string, name: string, description?: string}>}
   */
  static get availableModels() {
    return [];
  }

  /**
   * Get the default model for this provider
   * @returns {string}
   */
  getDefaultModel() {
    const models = this.constructor.availableModels;
    return models.length > 0 ? models[0].id : '';
  }

  /**
   * Validate provider configuration
   * @returns {{valid: boolean, errors: string[]}}
   */
  validate() {
    const errors = [];

    if (this.constructor.requiresApiKey && !this.config.apiKey) {
      errors.push('API key is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Test connection to the provider
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async testConnection() {
    throw new Error('Provider must implement testConnection()');
  }

  /**
   * Perform code review on a patch/diff
   * @param {string} patchContent - Git diff/patch content
   * @param {Object} options - Review options
   * @param {string} options.language - Response language (default: 'English')
   * @param {string} options.prTitle - Pull request title
   * @param {string} options.prDescription - Pull request description
   * @returns {Promise<ReviewResult>}
   */
  async reviewCode(patchContent, options = {}) {
    throw new Error('Provider must implement reviewCode()');
  }

  /**
   * Get conversational response about the code
   * @param {string} patchContent - Git diff/patch content
   * @param {Array<{role: string, content: string}>} conversationHistory - Previous messages
   * @param {Object} options - Options
   * @returns {Promise<{response: string}>}
   */
  async chat(patchContent, conversationHistory, options = {}) {
    throw new Error('Provider must implement chat()');
  }

  /**
   * Build the system prompt for code review
   * @param {string} language - Response language
   * @param {Object} rules - Review rules
   * @returns {string}
   */
  buildReviewPrompt(language = 'English', rules = {}) {
    // Build focus areas based on rules
    const focusAreas = [];
    if (rules.security !== false) focusAreas.push('Security vulnerabilities');
    if (rules.performance !== false) focusAreas.push('Performance issues');
    if (rules.cleanCode !== false) focusAreas.push('Clean code and best practices');
    if (rules.bugs !== false) focusAreas.push('Potential bugs and logic errors');
    if (rules.tests !== false) focusAreas.push('Test coverage suggestions');
    if (rules.docs !== false) focusAreas.push('Documentation improvements');

    const focusSection = focusAreas.length > 0 
      ? `\n\nFocus your review on:\n${focusAreas.map(a => `- ${a}`).join('\n')}`
      : '';

    // Severity filter
    let severityNote = '';
    if (rules.severity === 'high') {
      severityNote = '\n\nOnly report HIGH severity issues. Ignore medium and low severity items.';
    } else if (rules.severity === 'medium') {
      severityNote = '\n\nReport MEDIUM and HIGH severity issues. Ignore low severity items.';
    }

    // Custom instructions
    const customInstructions = rules.customInstructions 
      ? `\n\nAdditional project-specific guidelines:\n${rules.customInstructions}`
      : '';

    // Scope instruction
    const scopeInstruction = `

CRITICAL INSTRUCTIONS:

1. LINE NUMBERS: The diff format shows "L<number>" at the start of each line (e.g., "L 42 + code").
   - ALWAYS use these EXACT line numbers in your response
   - The line number comes BEFORE the +/- symbol
   - Example: "L 42 + new code" means line 42 in the new file

2. REVIEW SCOPE:
   - Only review code that is ACTUALLY CHANGED (lines with + or -)
   - Do NOT report issues in unchanged code (context lines without +/-)
   - If a file shows partial content, assume the rest exists (dispose methods, etc.)
   - Lines with "+" are additions (new code) - focus on these
   - Lines with "-" are deletions (removed code)`;

    return `You are an expert code reviewer. Analyze the provided git diff/patch and provide a comprehensive code review in ${language}.${scopeInstruction}${focusSection}${severityNote}${customInstructions}

Please analyze the git diff/patch and provide your review in this EXACT JSON format:

{
  "summary": "Brief overview of the changes (2-3 sentences)",
  "issues": [
    {
      "severity": "high|medium|low",
      "type": "bug|security|performance|style|logic",
      "description": "Description of the issue",
      "file": "filename",
      "line": 42,
      "codeSnippet": "The exact code snippet from the diff that has the issue (copy the relevant lines)",
      "suggestion": "How to fix it",
      "suggestedCode": "The corrected code snippet (optional, include when applicable)"
    }
  ],
  "security": [
    {
      "severity": "high|medium|low",
      "description": "Security concern description",
      "file": "filename",
      "line": 42,
      "codeSnippet": "The exact code snippet with the security issue",
      "recommendation": "How to fix it",
      "suggestedCode": "The corrected code (optional)"
    }
  ],
  "suggestions": [
    {
      "type": "performance|style|best-practice|maintainability|readability",
      "description": "Suggestion description",
      "file": "filename",
      "line": 42,
      "codeSnippet": "The current code that could be improved",
      "suggestedCode": "The improved code (optional)"
    }
  ],
  "positives": [
    "List of positive aspects of the code changes"
  ],
  "metrics": {
    "overallScore": 85,
    "codeQuality": 80,
    "securityScore": 90,
    "maintainability": 85
  }
}

IMPORTANT RULES:
1. LINE NUMBERS: The "line" field MUST be the actual line number from the diff (shown as "L<number>"). Use a NUMBER, not a string. Extract it from "L 42 + code" → line: 42
2. CODE SNIPPETS: Always include "codeSnippet" with the exact code from the diff
3. Include "suggestedCode" when you can provide a concrete fix

Scoring Guidelines:
- All metric scores should be 0-100
- overallScore: Holistic assessment considering all factors
- codeQuality: Clarity, structure, error handling
- securityScore: 100 = no issues found; deduct points per severity
- maintainability: Readability, modularity, documentation

Important: Respond ONLY with valid JSON. Do not include any explanatory text before or after the JSON.`;
  }

  /**
   * Build the chat system prompt
   * @param {string} patchContent - The patch being discussed
   * @param {string} language - Response language
   * @returns {string}
   */
  buildChatPrompt(patchContent, language = 'English') {
    const truncatedPatch = patchContent.length > 30000 
      ? patchContent.substring(0, 30000) + '\n... (truncated)' 
      : patchContent;

    return `You are an expert code reviewer. The following code patch is being discussed:

CODE PATCH (Git Diff Format):
\`\`\`diff
${truncatedPatch}
\`\`\`

Your role is to answer questions about this code review in a helpful, concise manner.
${language !== 'English' ? `IMPORTANT: Respond entirely in ${language}.` : ''}`;
  }

  /**
   * Parse the review response from the AI
   * @param {string} responseText - Raw response from AI
   * @returns {ReviewResult}
   */
  parseReviewResponse(responseText) {
    try {
      // Try to extract JSON from the response
      // Handle cases where JSON might be wrapped in markdown code blocks
      let jsonText = responseText;
      
      // Remove markdown code blocks if present
      const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1];
      }
      
      // Find the JSON object
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          review: {
            summary: parsed.summary || 'Review completed',
            issues: parsed.issues || [],
            security: parsed.security || [],
            suggestions: parsed.suggestions || [],
            positives: parsed.positives || [],
            metrics: parsed.metrics || {
              overallScore: 75,
              codeQuality: 75,
              securityScore: 85,
              maintainability: 75
            }
          },
          provider: this.constructor.id,
          model: this.config.model
        };
      }
      throw new Error('No JSON found in response');
    } catch (error) {
      console.error('[AI Review] Failed to parse JSON response:', error.message);
      console.log('[AI Review] Raw response (first 1000 chars):', responseText.substring(0, 1000));
      
      // Fallback for non-JSON responses - show the full response
      return {
        success: true,
        review: {
          summary: responseText.length > 2000 
            ? responseText.substring(0, 2000) + '... (truncated, click "View AI Response" to see full)'
            : responseText,
          issues: [],
          security: [],
          suggestions: [],
          positives: [],
          metrics: {
            overallScore: '-',
            codeQuality: '-',
            securityScore: '-',
            maintainability: '-'
          },
          note: 'AI responded in plain text instead of JSON format. The response is shown in the summary above.'
        },
        provider: this.constructor.id,
        model: this.config.model,
        rawResponse: responseText
      };
    }
  }
}

/**
 * @typedef {Object} ReviewResult
 * @property {boolean} success
 * @property {Object} review
 * @property {string} review.summary
 * @property {Array} review.issues
 * @property {Array} review.security
 * @property {Array} review.suggestions
 * @property {Array} review.positives
 * @property {Object} review.metrics
 * @property {string} provider
 * @property {string} model
 * @property {string} [rawResponse]
 * @property {string} [error]
 */
