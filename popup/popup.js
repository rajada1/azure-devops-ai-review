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

    // Load language setting
    if (settings.language) {
      document.getElementById('review-language').value = settings.language;
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
}

function updateUI() {
  updateStatusTab();
  updateProvidersTab();
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
            ${!isActive ? `<button class="btn btn-small" onclick="setActiveProvider('${provider.id}')">Use</button>` : '<span class="badge">Active</span>'}
            <button class="btn-icon btn-danger" onclick="removeProvider('${provider.id}')" title="Remove">🗑️</button>
          </div>
        </div>
      `;
    }).join('');
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

  const provider = availableProviders.find(p => p.id === providerId);
  if (!provider) return;

  // Build form
  let html = '';

  // Provider-specific instructions
  const instructions = getProviderInstructions(providerId);
  if (instructions) {
    html += `<div class="provider-instructions">${instructions}</div>`;
  }

  // API Key field
  if (provider.requiresApiKey) {
    const keyLabel = providerId === 'github-copilot' ? 'GitHub Token' : 'API Key';
    const keyPlaceholder = providerId === 'github-copilot' 
      ? 'ghp_xxxxxxxxxxxx' 
      : 'Enter API key';
    
    html += `
      <div class="form-field">
        <label for="provider-apikey">${keyLabel}</label>
        <input type="password" id="provider-apikey" placeholder="${keyPlaceholder}" required>
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
  return {
    id: providerId,
    apiKey: document.getElementById('provider-apikey')?.value || '',
    baseUrl: document.getElementById('provider-url')?.value || '',
    model: document.getElementById('provider-model')?.value || ''
  };
}

// Global functions for inline onclick handlers
window.setActiveProvider = async function(providerId) {
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
};

window.removeProvider = async function(providerId) {
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
};

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
    'github-copilot': `
      <p><strong>Requires GitHub Copilot subscription</strong></p>
      <p>Create a Personal Access Token at 
        <a href="https://github.com/settings/tokens" target="_blank">github.com/settings/tokens</a>
      </p>
      <p>Required scope: <code>copilot</code></p>
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
