/**
 * Copilot Authentication Service
 * Handles GitHub Copilot OAuth Device Flow and API token management
 */

// GitHub OAuth App Client ID (same as VS Code Copilot extension uses)
const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

// API endpoints
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

// Storage keys
const STORAGE_OAUTH_TOKEN = 'copilot_oauth_token';
const STORAGE_API_TOKEN = 'copilot_api_token';
const STORAGE_API_ENDPOINT = 'copilot_api_endpoint';
const STORAGE_TOKEN_EXPIRES = 'copilot_token_expires';

export class CopilotAuthService {
  
  /**
   * Start the GitHub Device Flow OAuth process
   * @returns {Promise<{userCode: string, verificationUri: string, deviceCode: string, expiresIn: number, interval: number}>}
   */
  static async startDeviceFlow() {
    const response = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'AzureDevOpsAIReview/1.0.0',
        'Editor-Version': 'AzureDevOpsAIReview/1.0.0',
        'Editor-Plugin-Version': 'copilot/1.0.0'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        scope: 'read:user'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to start device flow: ${error}`);
    }

    const data = await response.json();
    
    return {
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      deviceCode: data.device_code,
      expiresIn: data.expires_in,
      interval: data.interval || 5
    };
  }

  /**
   * Poll for OAuth token after user authorizes
   * @param {string} deviceCode - Device code from startDeviceFlow
   * @param {number} interval - Polling interval in seconds
   * @param {number} maxAttempts - Maximum polling attempts
   * @returns {Promise<string>} OAuth access token
   */
  static async pollForOAuthToken(deviceCode, interval = 5, maxAttempts = 60) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, interval * 1000));

      try {
        const response = await fetch(GITHUB_OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'AzureDevOpsAIReview/1.0.0',
            'Editor-Version': 'AzureDevOpsAIReview/1.0.0',
            'Editor-Plugin-Version': 'copilot/1.0.0'
          },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        });

        const data = await response.json();

        if (data.access_token) {
          // Save OAuth token
          await chrome.storage.local.set({
            [STORAGE_OAUTH_TOKEN]: data.access_token
          });
          return data.access_token;
        }

        if (data.error === 'authorization_pending') {
          // User hasn't authorized yet, continue polling
          continue;
        }

        if (data.error === 'slow_down') {
          // Increase interval
          interval = (data.interval || interval) + 5;
          continue;
        }

        if (data.error === 'expired_token') {
          throw new Error('Authorization expired. Please try again.');
        }

        if (data.error === 'access_denied') {
          throw new Error('Authorization denied by user.');
        }

        if (data.error) {
          throw new Error(data.error_description || data.error);
        }
      } catch (error) {
        if (error.message.includes('Authorization')) {
          throw error;
        }
        // Network error, continue polling
        console.warn('Polling error:', error);
      }
    }

    throw new Error('Authorization timeout. Please try again.');
  }

  /**
   * Get API token from Copilot service
   * @param {string} oauthToken - GitHub OAuth access token
   * @returns {Promise<{token: string, endpoint: string, expiresAt: number}>}
   */
  static async getApiToken(oauthToken) {
    const response = await fetch(COPILOT_TOKEN_URL, {
      method: 'GET',
      headers: {
        'Authorization': `token ${oauthToken}`,
        'Accept': 'application/json',
        'User-Agent': 'AzureDevOpsAIReview/1.0.0',
        'Editor-Version': 'AzureDevOpsAIReview/1.0.0',
        'Editor-Plugin-Version': 'copilot/1.0.0'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      
      if (response.status === 401) {
        // OAuth token invalid, clear it
        await chrome.storage.local.remove([STORAGE_OAUTH_TOKEN]);
        throw new Error('GitHub session expired. Please sign in again.');
      }
      
      if (response.status === 403) {
        throw new Error('No active Copilot subscription found. Please ensure you have GitHub Copilot enabled.');
      }
      
      throw new Error(`Failed to get Copilot token: ${error}`);
    }

    const data = await response.json();

    const result = {
      token: data.token,
      endpoint: data.endpoints?.api || 'https://api.githubcopilot.com',
      expiresAt: data.expires_at * 1000 // Convert to milliseconds
    };

    // Cache the API token
    await chrome.storage.local.set({
      [STORAGE_API_TOKEN]: result.token,
      [STORAGE_API_ENDPOINT]: result.endpoint,
      [STORAGE_TOKEN_EXPIRES]: result.expiresAt
    });

    return result;
  }

  /**
   * Get valid API credentials (refreshing if needed)
   * @returns {Promise<{token: string, endpoint: string} | null>}
   */
  static async getValidCredentials() {
    const stored = await chrome.storage.local.get([
      STORAGE_OAUTH_TOKEN,
      STORAGE_API_TOKEN,
      STORAGE_API_ENDPOINT,
      STORAGE_TOKEN_EXPIRES
    ]);

    if (!stored[STORAGE_OAUTH_TOKEN]) {
      return null;
    }

    // Check if API token is still valid (with 5 minute buffer)
    const now = Date.now();
    const expiresAt = stored[STORAGE_TOKEN_EXPIRES] || 0;
    const bufferMs = 5 * 60 * 1000; // 5 minutes

    if (stored[STORAGE_API_TOKEN] && expiresAt > (now + bufferMs)) {
      return {
        token: stored[STORAGE_API_TOKEN],
        endpoint: stored[STORAGE_API_ENDPOINT]
      };
    }

    // Refresh API token
    try {
      const result = await this.getApiToken(stored[STORAGE_OAUTH_TOKEN]);
      return {
        token: result.token,
        endpoint: result.endpoint
      };
    } catch (error) {
      console.error('Failed to refresh Copilot token:', error);
      return null;
    }
  }

  /**
   * Check if user is authenticated
   * @returns {Promise<boolean>}
   */
  static async isAuthenticated() {
    const stored = await chrome.storage.local.get([STORAGE_OAUTH_TOKEN]);
    return !!stored[STORAGE_OAUTH_TOKEN];
  }

  /**
   * Get authentication status with details
   * @returns {Promise<{authenticated: boolean, hasSubscription: boolean, error?: string}>}
   */
  static async getAuthStatus() {
    try {
      const credentials = await this.getValidCredentials();
      
      if (!credentials) {
        const hasOAuth = await this.isAuthenticated();
        return {
          authenticated: hasOAuth,
          hasSubscription: false,
          error: hasOAuth ? 'Failed to verify Copilot subscription' : undefined
        };
      }

      return {
        authenticated: true,
        hasSubscription: true
      };
    } catch (error) {
      return {
        authenticated: false,
        hasSubscription: false,
        error: error.message
      };
    }
  }

  /**
   * Sign out - clear all stored tokens
   */
  static async signOut() {
    await chrome.storage.local.remove([
      STORAGE_OAUTH_TOKEN,
      STORAGE_API_TOKEN,
      STORAGE_API_ENDPOINT,
      STORAGE_TOKEN_EXPIRES
    ]);
  }

  /**
   * Get headers for Copilot API requests
   * @returns {Promise<Object>}
   */
  static async getApiHeaders() {
    const credentials = await this.getValidCredentials();
    
    if (!credentials) {
      throw new Error('Not authenticated with GitHub Copilot');
    }

    return {
      'Authorization': `Bearer ${credentials.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Copilot-Integration-Id': 'vscode-chat',
      'Editor-Version': 'AzureDevOpsAIReview/1.0.0',
      'X-GitHub-Api-Version': '2025-05-01'
    };
  }

  /**
   * Get the API endpoint URL
   * @returns {Promise<string>}
   */
  static async getApiEndpoint() {
    const credentials = await this.getValidCredentials();
    
    if (!credentials) {
      throw new Error('Not authenticated with GitHub Copilot');
    }

    return credentials.endpoint;
  }

  /**
   * Fetch available models from Copilot
   * @returns {Promise<Array<{id: string, name: string, description: string, isDefault: boolean}>>}
   */
  static async fetchModels() {
    const credentials = await this.getValidCredentials();
    
    if (!credentials) {
      throw new Error('Not authenticated with GitHub Copilot');
    }

    const response = await fetch(`${credentials.endpoint}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Copilot-Integration-Id': 'vscode-chat',
        'Editor-Version': 'AzureDevOpsAIReview/1.0.0',
        'X-GitHub-Api-Version': '2025-05-01'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch models: ${error}`);
    }

    const data = await response.json();
    const models = data.data || data.models || data || [];

    // Filter to chat models and format
    return models
      .filter(m => m.capabilities?.type === 'chat' && m.model_picker_enabled !== false)
      .filter(m => !m.policy || m.policy.state === 'enabled')
      .map(m => ({
        id: m.id,
        name: m.name || m.id,
        description: m.capabilities?.family || '',
        isDefault: m.is_chat_default || false,
        isPremium: m.billing?.is_premium || false,
        supportsVision: m.capabilities?.supports?.vision || false,
        supportsTools: m.capabilities?.supports?.tool_calls || false,
        maxTokens: m.capabilities?.limits?.max_output_tokens || 4096
      }))
      .sort((a, b) => {
        // Put default first, then sort by name
        if (a.isDefault && !b.isDefault) return -1;
        if (b.isDefault && !a.isDefault) return 1;
        return a.name.localeCompare(b.name);
      });
  }
}
