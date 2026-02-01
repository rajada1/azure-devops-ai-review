// popup.js - Extension popup UI logic

let availableProviders = [];
let configuredProviders = [];
let activeProviderId = null;
let settings = {};

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupTabs();
  setupEventListeners();
  updateUI();
});

async function loadData() {
  try {
    // Get available providers
    const providersResult = await chrome.runtime.sendMessage({ type: 'GET_PROVIDERS' });
    availableProviders = providersResult.providers || [];

    // Get current configuration
    const configResult = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    configuredProviders = configResult.providers || [];
    activeProviderId = configResult.activeProvider;
    settings = configResult.settings || {};

    // Load Azure token
    const tokenResult = await chrome.runtime.sendMessage({ type: 'GET_AZURE_TOKEN' });
    if (tokenResult.token) {
      document.getElementById('azure-token').value = '••••••••••••••••';
    }

    // Check Copilot auth status
    await updateCopilotAuthUI();

    // Load language setting
    if (settings.language) {
      document.getElementById('review-language').value = settings.language;
    }

    // Load diff limits
    const limitsResult = await chrome.runtime.sendMessage({ type: 'GET_DIFF_LIMITS' });
    if (limitsResult.maxFiles) {
      document.getElementById('max-files').value = limitsResult.maxFiles;
    }

    // Load max tokens setting
    if (settings.maxTokens) {
      document.getElementById('max-tokens').value = settings.maxTokens;
    }
  } catch (error) {
    console.error('Failed to load data:', error);
    showToast('Failed to load settings', 'error');
  }
}

function setupTabs() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const tabs = document.querySelectorAll('.tab-content');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;

      navBtns.forEach(b => b.classList.remove('active'));
      tabs.forEach(t => t.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });
}

function setupEventListeners() {
  // Test connection button
  document.getElementById('btn-test-connection').addEventListener('click', testConnection);

  // Provider select
  document.getElementById('provider-select').addEventListener('change', onProviderSelect);

  // Save Azure token
  document.getElementById('btn-save-token').addEventListener('click', saveAzureToken);

  // Language change
  document.getElementById('review-language').addEventListener('change', (e) => {
    updateSettings({ language: e.target.value });
  });

  // Save diff limits
  document.getElementById('btn-save-limits').addEventListener('click', saveDiffLimits);

  // Save max tokens
  document.getElementById('btn-save-tokens').addEventListener('click', saveMaxTokens);

  // Rules tab
  document.getElementById('btn-save-rules').addEventListener('click', saveRules);

  // History tab
  document.getElementById('btn-clear-history').addEventListener('click', clearHistory);
}

async function saveDiffLimits() {
  const maxFiles = parseInt(document.getElementById('max-files').value);
  
  try {
    await chrome.runtime.sendMessage({
      type: 'SET_DIFF_LIMITS',
      maxFiles
    });
    showToast('Diff limits saved!', 'success');
  } catch (error) {
    console.error('Failed to save limits:', error);
    showToast('Failed to save limits', 'error');
  }
}

async function saveMaxTokens() {
  const maxTokens = parseInt(document.getElementById('max-tokens').value);
  
  try {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { maxTokens }
    });
    showToast('Max tokens saved!', 'success');
  } catch (error) {
    console.error('Failed to save max tokens:', error);
    showToast('Failed to save max tokens', 'error');
  }
}

function updateUI() {
  updateStatusTab();
  updateProvidersTab();
  loadRules();
  loadHistory();
}

function updateStatusTab() {
  const indicator = document.getElementById('status-indicator');
  const dot = indicator.querySelector('.status-dot');
  const text = indicator.querySelector('.status-text');
  const description = document.getElementById('status-description');
  const providerInfo = document.getElementById('provider-info');

  const activeProvider = configuredProviders.find(p => p.id === activeProviderId);

  if (activeProvider) {
    dot.className = 'status-dot ready';
    text.textContent = 'Ready';
    description.textContent = 'AI provider configured and ready to review code.';

    const providerMeta = availableProviders.find(p => p.id === activeProvider.id);
    providerInfo.innerHTML = `
      <div class="name">${providerMeta?.displayName || activeProvider.id}</div>
      <div class="model">Model: ${activeProvider.model}</div>
    `;
  } else {
    dot.className = 'status-dot warning';
    text.textContent = 'Not Configured';
    description.textContent = 'Please configure an AI provider to start reviewing code.';
    providerInfo.innerHTML = '<p>No provider configured</p>';
  }
}

function updateProvidersTab() {
  const list = document.getElementById('provider-list');
  const select = document.getElementById('provider-select');

  // Render configured providers
  if (configuredProviders.length === 0) {
    list.innerHTML = '<p class="help-text">No providers configured yet.</p>';
  } else {
    list.innerHTML = configuredProviders.map(provider => {
      const meta = availableProviders.find(p => p.id === provider.id);
      const isActive = provider.id === activeProviderId;

      return `
        <div class="provider-item ${isActive ? 'active' : ''}" data-id="${provider.id}">
          <div class="provider-item-info">
            <div class="provider-item-name">${meta?.displayName || provider.id}</div>
            <div class="provider-item-model">${provider.model}</div>
          </div>
          <div class="provider-item-actions">
            ${!isActive ? `<button class="btn btn-small btn-use-provider" data-provider-id="${provider.id}">Use</button>` : '<span class="badge">Active</span>'}
            <button class="btn-icon btn-danger btn-remove-provider" data-provider-id="${provider.id}" title="Remove">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    // Add event listeners for Use buttons
    list.querySelectorAll('.btn-use-provider').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const providerId = btn.dataset.providerId;
        setActiveProvider(providerId);
      });
    });

    // Add event listeners for Remove buttons
    list.querySelectorAll('.btn-remove-provider').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const providerId = btn.dataset.providerId;
        removeProvider(providerId);
      });
    });
  }

  // Populate provider select
  select.innerHTML = '<option value="">Select a provider...</option>';
  availableProviders.forEach(provider => {
    select.innerHTML += `<option value="${provider.id}">${provider.displayName} - ${provider.description}</option>`;
  });
}

function onProviderSelect(e) {
  const providerId = e.target.value;
  const form = document.getElementById('provider-form');

  if (!providerId) {
    form.classList.add('hidden');
    return;
  }

  // GitHub Copilot uses OAuth, not the form
  if (providerId === 'github-copilot') {
    form.innerHTML = `
      <div class="provider-instructions">
        <p><strong>GitHub Copilot</strong></p>
        <p>Use the "Sign in with GitHub" button in the Settings tab to authenticate.</p>
        <p>After signing in, Copilot will be automatically added as a provider.</p>
      </div>
      <button class="btn" id="btn-goto-settings">Go to Settings</button>
    `;
    form.classList.remove('hidden');
    document.getElementById('btn-goto-settings').addEventListener('click', () => {
      document.querySelector('[data-tab="settings"]').click();
    });
    return;
  }

  const provider = availableProviders.find(p => p.id === providerId);
  if (!provider) return;

  // Build form
  let html = '';

  // Provider-specific instructions
  const instructions = getProviderInstructions(providerId);
  if (instructions) {
    html += `<div class="provider-instructions">${instructions}</div>`;
  }

  // Check if provider has custom config fields
  if (provider.configFields && provider.configFields.length > 0) {
    // Use custom fields from provider
    provider.configFields.forEach(field => {
      html += `<div class="form-field">`;
      html += `<label for="provider-${field.name}">${field.label}</label>`;
      
      if (field.type === 'select' && field.options) {
        // Render select dropdown
        html += `<select id="provider-${field.name}">`;
        field.options.forEach(opt => {
          const selected = opt.value === field.default ? 'selected' : '';
          html += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
        });
        html += `</select>`;
      } else {
        // Render text/password input
        const inputType = field.type === 'password' ? 'password' : 'text';
        const required = field.required ? 'required' : '';
        html += `<input type="${inputType}" id="provider-${field.name}" placeholder="${field.placeholder || ''}" ${required}>`;
      }
      
      if (field.description) {
        html += `<p class="help-text">${field.description}</p>`;
      }
      
      html += `</div>`;
    });
  } else {
    // Default form fields
    
    // API Key field
    if (provider.requiresApiKey) {
      html += `
        <div class="form-field">
          <label for="provider-apikey">API Key</label>
          <input type="password" id="provider-apikey" placeholder="Enter API key" required>
        </div>
      `;
    }

    // Base URL field
    if (provider.supportsCustomUrl) {
      html += `
        <div class="form-field">
          <label for="provider-url">Base URL ${provider.requiresApiKey ? '(optional)' : ''}</label>
          <input type="text" id="provider-url" placeholder="Custom API endpoint">
        </div>
      `;
    }

    // Model select
    if (provider.availableModels.length > 0) {
      html += `
        <div class="form-field">
        <label for="provider-model">Model</label>
        <select id="provider-model">
          ${provider.availableModels.map(m => `
            <option value="${m.id}">${m.name}${m.description ? ` - ${m.description}` : ''}</option>
          `).join('')}
        </select>
      </div>
    `;
    }
  }

  html += `
    <div class="form-field">
      <button class="btn" id="btn-add-provider">Add Provider</button>
      <button class="btn btn-secondary" id="btn-test-provider">Test</button>
    </div>
  `;

  form.innerHTML = html;
  form.classList.remove('hidden');

  // Event listeners
  document.getElementById('btn-add-provider').addEventListener('click', () => addProvider(providerId));
  document.getElementById('btn-test-provider').addEventListener('click', () => testNewProvider(providerId));
}

async function addProvider(providerId) {
  const config = getProviderFormData(providerId);
  
  try {
    await chrome.runtime.sendMessage({
      type: 'SAVE_PROVIDER',
      provider: config
    });

    // Set as active if it's the first provider
    if (configuredProviders.length === 0) {
      await chrome.runtime.sendMessage({
        type: 'SET_ACTIVE_PROVIDER',
        providerId: config.id
      });
    }

    await loadData();
    updateUI();

    document.getElementById('provider-select').value = '';
    document.getElementById('provider-form').classList.add('hidden');

    showToast('Provider added successfully', 'success');
  } catch (error) {
    showToast('Failed to add provider', 'error');
  }
}

async function testNewProvider(providerId) {
  const config = getProviderFormData(providerId);
  
  const btn = document.getElementById('btn-test-provider');
  btn.disabled = true;
  btn.textContent = 'Testing...';

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'TEST_PROVIDER',
      providerId,
      config
    });

    if (result.success) {
      showToast('Connection successful!', 'success');
    } else {
      showToast(`Connection failed: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast('Test failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test';
  }
}

function getProviderFormData(providerId) {
  const provider = availableProviders.find(p => p.id === providerId);
  
  // Check if provider has custom config fields
  if (provider?.configFields && provider.configFields.length > 0) {
    const config = { id: providerId };
    provider.configFields.forEach(field => {
      const input = document.getElementById(`provider-${field.name}`);
      if (input) {
        config[field.name] = input.value || '';
      }
    });
    return config;
  }
  
  // Default form data
  return {
    id: providerId,
    apiKey: document.getElementById('provider-apikey')?.value || '',
    baseUrl: document.getElementById('provider-url')?.value || '',
    model: document.getElementById('provider-model')?.value || ''
  };
}

// Provider action functions
async function setActiveProvider(providerId) {
  try {
    await chrome.runtime.sendMessage({
      type: 'SET_ACTIVE_PROVIDER',
      providerId
    });
    activeProviderId = providerId;
    updateUI();
    showToast('Provider activated', 'success');
  } catch (error) {
    showToast('Failed to set provider', 'error');
  }
}

async function removeProvider(providerId) {
  if (!confirm('Remove this provider?')) return;

  try {
    await chrome.runtime.sendMessage({
      type: 'REMOVE_PROVIDER',
      providerId
    });
    await loadData();
    updateUI();
    showToast('Provider removed', 'success');
  } catch (error) {
    showToast('Failed to remove provider', 'error');
  }
}

async function testConnection() {
  if (!activeProviderId) {
    showToast('No provider configured', 'error');
    return;
  }

  const btn = document.getElementById('btn-test-connection');
  btn.disabled = true;
  btn.textContent = 'Testing...';

  try {
    const activeProvider = configuredProviders.find(p => p.id === activeProviderId);
    const result = await chrome.runtime.sendMessage({
      type: 'TEST_PROVIDER',
      providerId: activeProviderId,
      config: activeProvider
    });

    if (result.success) {
      showToast('Connection successful!', 'success');
    } else {
      showToast(`Connection failed: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast('Test failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Connection';
  }
}

async function saveAzureToken() {
  const input = document.getElementById('azure-token');
  const token = input.value;

  if (!token || token === '••••••••••••••••') {
    showToast('Please enter a token', 'error');
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'SAVE_AZURE_TOKEN',
      token
    });
    input.value = '••••••••••••••••';
    showToast('Token saved', 'success');
  } catch (error) {
    showToast('Failed to save token', 'error');
  }
}

// ========== COPILOT AUTHENTICATION ==========

async function updateCopilotAuthUI() {
  const section = document.getElementById('copilot-auth-section');
  
  try {
    // First check if there's a pending auth
    const pendingResult = await chrome.runtime.sendMessage({ type: 'COPILOT_GET_PENDING_AUTH' });
    
    if (pendingResult.pending) {
      // Show the pending auth UI with the code
      section.innerHTML = `
        <div class="copilot-auth-code">
          <p>1. Go to <a href="${pendingResult.verificationUri}" target="_blank">${pendingResult.verificationUri}</a></p>
          <p>2. Enter this code:</p>
          <div class="user-code" id="copilot-user-code">${pendingResult.userCode}</div>
          <button class="btn btn-small" id="btn-copy-code">📋 Copy Code</button>
          <p class="help-text">Waiting for authorization...</p>
          <div class="spinner"></div>
        </div>
        <button class="btn btn-small btn-secondary" id="btn-cancel-auth">Cancel</button>
      `;

      document.getElementById('btn-copy-code').addEventListener('click', () => {
        navigator.clipboard.writeText(pendingResult.userCode);
        showToast('Code copied!', 'success');
      });

      document.getElementById('btn-cancel-auth').addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'COPILOT_CANCEL_AUTH' });
        updateCopilotAuthUI();
      });
      
      return;
    }
    
    // Check if already authenticated
    const status = await chrome.runtime.sendMessage({ type: 'COPILOT_GET_STATUS' });
    
    if (status.authenticated && status.hasSubscription) {
      // Fetch available models
      let modelsHtml = '';
      try {
        const modelsResult = await chrome.runtime.sendMessage({ type: 'COPILOT_FETCH_MODELS' });
        if (modelsResult.success && modelsResult.models?.length > 0) {
          // Get current model from provider config
          const copilotProvider = configuredProviders.find(p => p.id === 'github-copilot');
          const currentModel = copilotProvider?.model || 'gpt-4o';
          
          modelsHtml = `
            <div class="form-field" style="margin-top: 12px;">
              <label for="copilot-model">Model</label>
              <select id="copilot-model">
                ${modelsResult.models.map(m => `
                  <option value="${m.id}" ${m.id === currentModel ? 'selected' : ''}>
                    ${m.name}${m.isDefault ? ' (default)' : ''}
                  </option>
                `).join('')}
              </select>
            </div>
          `;
        }
      } catch (e) {
        console.warn('Failed to fetch Copilot models:', e);
      }
      
      section.innerHTML = `
        <div class="copilot-status authenticated">
          <span class="status-icon">✅</span>
          <span class="status-text">Connected to GitHub Copilot</span>
        </div>
        ${modelsHtml}
        <button class="btn btn-small btn-danger" id="btn-copilot-signout" style="margin-top: 12px;">Sign Out</button>
      `;
      document.getElementById('btn-copilot-signout').addEventListener('click', signOutCopilot);
      
      // Model change handler
      const modelSelect = document.getElementById('copilot-model');
      if (modelSelect) {
        modelSelect.addEventListener('change', async (e) => {
          await saveCopilotModel(e.target.value);
        });
      }
    } else if (status.authenticated && !status.hasSubscription) {
      section.innerHTML = `
        <div class="copilot-status warning">
          <span class="status-icon">⚠️</span>
          <span class="status-text">No active Copilot subscription</span>
        </div>
        <p class="help-text">Your GitHub account doesn't have an active Copilot subscription.</p>
        <button class="btn btn-small" id="btn-copilot-retry">Retry</button>
        <button class="btn btn-small btn-secondary" id="btn-copilot-signout">Sign Out</button>
      `;
      document.getElementById('btn-copilot-retry').addEventListener('click', updateCopilotAuthUI);
      document.getElementById('btn-copilot-signout').addEventListener('click', signOutCopilot);
    } else {
      section.innerHTML = `
        <div class="copilot-status">
          <span class="status-icon">🔑</span>
          <span class="status-text">Not signed in</span>
        </div>
        <button class="btn" id="btn-copilot-signin">
          <span>🐙</span> Sign in with GitHub
        </button>
        <p class="help-text">
          Requires an active <a href="https://github.com/features/copilot" target="_blank">GitHub Copilot</a> subscription.
        </p>
      `;
      document.getElementById('btn-copilot-signin').addEventListener('click', startCopilotSignIn);
    }
  } catch (error) {
    console.error('Failed to get Copilot status:', error);
    section.innerHTML = `
      <div class="copilot-status error">
        <span class="status-icon">❌</span>
        <span class="status-text">Error checking status</span>
      </div>
      <button class="btn btn-small" id="btn-copilot-retry">Retry</button>
    `;
    document.getElementById('btn-copilot-retry').addEventListener('click', updateCopilotAuthUI);
  }
}

async function startCopilotSignIn() {
  const section = document.getElementById('copilot-auth-section');
  
  section.innerHTML = `
    <div class="copilot-status loading">
      <span class="status-icon">⏳</span>
      <span class="status-text">Starting authentication...</span>
    </div>
  `;

  try {
    const result = await chrome.runtime.sendMessage({ type: 'COPILOT_START_AUTH' });
    
    if (!result.success) {
      throw new Error(result.error);
    }

    // Show the code to user (background is now polling)
    section.innerHTML = `
      <div class="copilot-auth-code">
        <p>1. Go to <a href="${result.verificationUri}" target="_blank">${result.verificationUri}</a></p>
        <p>2. Enter this code:</p>
        <div class="user-code" id="copilot-user-code">${result.userCode}</div>
        <button class="btn btn-small" id="btn-copy-code">📋 Copy Code</button>
        <p class="help-text">Waiting for authorization...</p>
        <div class="spinner"></div>
      </div>
      <button class="btn btn-small btn-secondary" id="btn-cancel-auth">Cancel</button>
    `;

    document.getElementById('btn-copy-code').addEventListener('click', () => {
      navigator.clipboard.writeText(result.userCode);
      showToast('Code copied!', 'success');
    });

    document.getElementById('btn-cancel-auth').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'COPILOT_CANCEL_AUTH' });
      updateCopilotAuthUI();
    });

    // Open the verification URL
    chrome.tabs.create({ url: result.verificationUri });

  } catch (error) {
    console.error('Failed to start Copilot auth:', error);
    section.innerHTML = `
      <div class="copilot-status error">
        <span class="status-icon">❌</span>
        <span class="status-text">Authentication failed</span>
      </div>
      <p class="help-text">${error.message}</p>
      <button class="btn btn-small" id="btn-copilot-retry">Try Again</button>
    `;
    document.getElementById('btn-copilot-retry').addEventListener('click', startCopilotSignIn);
  }
}

// Listen for auth completion from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'COPILOT_AUTH_COMPLETE') {
    if (message.success) {
      showToast('Successfully signed in to GitHub Copilot!', 'success');
      updateCopilotAuthUI();
      autoAddCopilotProvider();
    } else {
      showToast(`Authentication failed: ${message.error}`, 'error');
      updateCopilotAuthUI();
    }
  }
});

async function autoAddCopilotProvider() {
  // Check if Copilot provider already exists
  const existingCopilot = configuredProviders.find(p => p.id === 'github-copilot');
  if (existingCopilot) {
    // Just set it as active
    await chrome.runtime.sendMessage({
      type: 'SET_ACTIVE_PROVIDER',
      providerId: 'github-copilot'
    });
    await loadData();
    updateUI();
    return;
  }

  // Fetch available models
  try {
    const modelsResult = await chrome.runtime.sendMessage({ type: 'COPILOT_FETCH_MODELS' });
    const defaultModel = modelsResult.models?.find(m => m.isDefault)?.id || 'gpt-4o';

    // Add Copilot provider with default model
    await chrome.runtime.sendMessage({
      type: 'SAVE_PROVIDER',
      provider: {
        id: 'github-copilot',
        model: defaultModel
      }
    });

    // Set as active
    await chrome.runtime.sendMessage({
      type: 'SET_ACTIVE_PROVIDER',
      providerId: 'github-copilot'
    });

    await loadData();
    updateUI();
    showToast('GitHub Copilot configured as your AI provider', 'success');
  } catch (error) {
    console.error('Failed to auto-add Copilot provider:', error);
  }
}

async function signOutCopilot() {
  try {
    await chrome.runtime.sendMessage({ type: 'COPILOT_SIGN_OUT' });
    
    // Remove Copilot provider if it exists
    const existingCopilot = configuredProviders.find(p => p.id === 'github-copilot');
    if (existingCopilot) {
      await chrome.runtime.sendMessage({
        type: 'REMOVE_PROVIDER',
        providerId: 'github-copilot'
      });
    }
    
    await loadData();
    updateUI();
    await updateCopilotAuthUI();
    showToast('Signed out of GitHub Copilot', 'success');
  } catch (error) {
    console.error('Failed to sign out:', error);
    showToast('Failed to sign out', 'error');
  }
}

async function saveCopilotModel(model) {
  try {
    // Update or create the Copilot provider with new model
    await chrome.runtime.sendMessage({
      type: 'SAVE_PROVIDER',
      provider: {
        id: 'github-copilot',
        model: model
      }
    });
    
    // Make sure it's the active provider
    await chrome.runtime.sendMessage({
      type: 'SET_ACTIVE_PROVIDER',
      providerId: 'github-copilot'
    });
    
    await loadData();
    updateUI();
    showToast(`Model changed to ${model}`, 'success');
  } catch (error) {
    console.error('Failed to save Copilot model:', error);
    showToast('Failed to save model', 'error');
  }
}

async function updateSettings(updates) {
  try {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: updates
    });
    settings = { ...settings, ...updates };
    showToast('Settings saved', 'success');
  } catch (error) {
    showToast('Failed to save settings', 'error');
  }
}

function showToast(message, type = 'info') {
  // Remove existing toasts
  document.querySelectorAll('.toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function getProviderInstructions(providerId) {
  const instructions = {
    'azure-openai': `
      <p><strong>Azure OpenAI Service</strong></p>
      <p>Supports Model Router and custom deployments.</p>
      <p>Endpoint format: <code>https://YOUR-RESOURCE.openai.azure.com/openai/v1/</code></p>
      <p>Get your API key from 
        <a href="https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI" target="_blank">Azure Portal</a>
      </p>
    `,
    'openai': `
      <p>Get your API key at 
        <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a>
      </p>
    `,
    'anthropic': `
      <p>Get your API key at 
        <a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com</a>
      </p>
    `,
    'gemini': `
      <p>Get your API key at 
        <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio</a>
      </p>
    `,
    'openai-compatible': `
      <p>Use any API compatible with OpenAI's format (Azure OpenAI, Together AI, etc.)</p>
    `
  };

  return instructions[providerId] || null;
}

// ========== RULES ==========

async function loadRules() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_RULES' });
    const rules = result.rules || {};

    // Scope
    if (rules.scope) {
      document.getElementById('rule-scope').value = rules.scope;
    }

    // Focus checkboxes
    document.getElementById('rule-security').checked = rules.security !== false;
    document.getElementById('rule-performance').checked = rules.performance !== false;
    document.getElementById('rule-clean-code').checked = rules.cleanCode !== false;
    document.getElementById('rule-bugs').checked = rules.bugs !== false;
    document.getElementById('rule-tests').checked = rules.tests !== false;
    document.getElementById('rule-docs').checked = rules.docs !== false;

    // Severity
    if (rules.severity) {
      document.getElementById('rule-severity').value = rules.severity;
    }

    // Ignore patterns
    if (rules.ignorePatterns) {
      document.getElementById('rule-ignore').value = rules.ignorePatterns.join('\n');
    }

    // Custom instructions
    if (rules.customInstructions) {
      document.getElementById('rule-custom').value = rules.customInstructions;
    }
  } catch (error) {
    console.error('Failed to load rules:', error);
  }
}

async function saveRules() {
  const rules = {
    scope: document.getElementById('rule-scope').value,
    security: document.getElementById('rule-security').checked,
    performance: document.getElementById('rule-performance').checked,
    cleanCode: document.getElementById('rule-clean-code').checked,
    bugs: document.getElementById('rule-bugs').checked,
    tests: document.getElementById('rule-tests').checked,
    docs: document.getElementById('rule-docs').checked,
    severity: document.getElementById('rule-severity').value,
    ignorePatterns: document.getElementById('rule-ignore').value
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0),
    customInstructions: document.getElementById('rule-custom').value.trim()
  };

  try {
    await chrome.runtime.sendMessage({ type: 'SAVE_RULES', rules });
    showToast('Rules saved successfully!', 'success');
  } catch (error) {
    console.error('Failed to save rules:', error);
    showToast('Failed to save rules', 'error');
  }
}

// ========== HISTORY ==========

async function loadHistory() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
    const history = result.history || [];

    const list = document.getElementById('history-list');

    if (history.length === 0) {
      list.innerHTML = '<p class="empty-state">No reviews yet. Start reviewing PRs to build your history.</p>';
      return;
    }

    list.innerHTML = history.map(item => {
      const date = new Date(item.timestamp);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      const score = item.review?.metrics?.overallScore || '-';
      const scoreClass = score >= 8 ? 'good' : score >= 5 ? 'medium' : score < 5 ? 'bad' : '';
      
      const issueCount = item.review?.issues?.length || 0;
      const securityCount = item.review?.security?.length || 0;

      return `
        <div class="history-item" data-id="${item.id}">
          <div class="history-item-header">
            <span class="history-item-title" title="${escapeHtml(item.prTitle || 'Untitled PR')}">${escapeHtml(item.prTitle || 'Untitled PR')}</span>
            <span class="history-item-date">${dateStr}</span>
          </div>
          <div class="history-item-meta">
            <span class="history-item-score ${scoreClass}">Score: ${score}/10</span>
            <span>⚠️ ${issueCount} issues</span>
            <span>🔒 ${securityCount} security</span>
          </div>
        </div>
      `;
    }).join('');

    // Click to view details
    list.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => viewHistoryItem(item.dataset.id));
    });
  } catch (error) {
    console.error('Failed to load history:', error);
  }
}

async function viewHistoryItem(id) {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_HISTORY_ITEM', id });
    if (result.item) {
      // For now, show summary in alert - could be a modal later
      const item = result.item;
      const summary = item.review?.summary || 'No summary available';
      alert(`PR: ${item.prTitle}\n\nSummary:\n${summary}`);
    }
  } catch (error) {
    console.error('Failed to get history item:', error);
  }
}

async function clearHistory() {
  if (!confirm('Are you sure you want to clear all review history?')) {
    return;
  }

  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    loadHistory();
    showToast('History cleared', 'success');
  } catch (error) {
    console.error('Failed to clear history:', error);
    showToast('Failed to clear history', 'error');
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
