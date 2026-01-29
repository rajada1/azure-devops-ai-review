// background.js - Service Worker
// Handles communication between content scripts and popup

import { ProviderFactory } from './providers/provider-factory.js';
import { ConfigService } from './services/config.js';

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // If on Azure DevOps PR page, toggle the review panel
  if (tab.url?.includes('dev.azure.com') || tab.url?.includes('visualstudio.com')) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_REVIEW_PANEL' });
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(error => {
    sendResponse({ success: false, error: error.message });
  });
  return true; // Async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_PROVIDERS':
      return {
        success: true,
        providers: ProviderFactory.getProviderList()
      };

    case 'GET_CONFIG':
      return {
        success: true,
        providers: await ConfigService.getProviders(),
        activeProvider: await ConfigService.getActiveProvider(),
        settings: await ConfigService.getSettings()
      };

    case 'SAVE_PROVIDER':
      await ConfigService.saveProvider(message.provider);
      return { success: true };

    case 'REMOVE_PROVIDER':
      await ConfigService.removeProvider(message.providerId);
      return { success: true };

    case 'SET_ACTIVE_PROVIDER':
      await ConfigService.setActiveProvider(message.providerId);
      return { success: true };

    case 'SAVE_AZURE_TOKEN':
      await ConfigService.saveAzureToken(message.token);
      return { success: true };

    case 'GET_AZURE_TOKEN':
      return {
        success: true,
        token: await ConfigService.getAzureToken()
      };

    case 'UPDATE_SETTINGS':
      await ConfigService.updateSettings(message.settings);
      return { success: true };

    case 'TEST_PROVIDER':
      return await testProvider(message.providerId, message.config);

    case 'REVIEW_CODE':
      return await performReview(message.patchContent, message.options);

    case 'CHAT':
      return await handleChat(message.patchContent, message.conversationHistory, message.options);

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function testProvider(providerId, config) {
  try {
    const provider = ProviderFactory.createProvider(providerId, config);
    const result = await provider.testConnection();
    return {
      success: result.success,
      error: result.error,
      models: result.models
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function performReview(patchContent, options = {}) {
  const providerConfig = await ConfigService.getActiveProviderConfig();
  
  if (!providerConfig) {
    return {
      success: false,
      error: 'No AI provider configured. Please configure a provider in the extension settings.'
    };
  }

  try {
    const provider = ProviderFactory.createFromConfig(providerConfig);
    const settings = await ConfigService.getSettings();
    
    const reviewOptions = {
      language: settings.language || 'English',
      ...options
    };

    return await provider.reviewCode(patchContent, reviewOptions);
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function handleChat(patchContent, conversationHistory, options = {}) {
  const providerConfig = await ConfigService.getActiveProviderConfig();
  
  if (!providerConfig) {
    return {
      success: false,
      error: 'No AI provider configured'
    };
  }

  try {
    const provider = ProviderFactory.createFromConfig(providerConfig);
    const settings = await ConfigService.getSettings();
    
    const chatOptions = {
      language: settings.language || 'English',
      ...options
    };

    const result = await provider.chat(patchContent, conversationHistory, chatOptions);
    return {
      success: true,
      ...result
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Log extension startup
console.log('[Azure DevOps AI Review] Extension loaded');
