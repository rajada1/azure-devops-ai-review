// background.js - Service Worker
// Handles communication between content scripts and popup

import { ProviderFactory, GitHubCopilotProvider } from './providers/provider-factory.js';
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

    case 'GET_GITHUB_TOKEN':
      return {
        success: true,
        token: await ConfigService.getGitHubToken()
      };

    case 'SAVE_GITHUB_TOKEN':
      await ConfigService.saveGitHubToken(message.token);
      return { success: true };

    case 'UPDATE_SETTINGS':
      await ConfigService.updateSettings(message.settings);
      return { success: true };

    case 'TEST_PROVIDER':
      return await testProvider(message.providerId, message.config);

    case 'REVIEW_CODE':
      return await performReview(message.patchContent, message.options);

    case 'CHAT':
      return await handleChat(message.patchContent, message.conversationHistory, message.options);

    case 'FETCH_GITHUB_MODELS':
      return await fetchGitHubModels(message.token);

    case 'FETCH_PR_DIFF':
      return await fetchPRDiff(message.prInfo, message.token);

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

async function fetchGitHubModels(token) {
  try {
    const models = await GitHubCopilotProvider.fetchAvailableModels(token);
    return {
      success: true,
      models
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      models: []
    };
  }
}

async function fetchPRDiff(prInfo, token) {
  try {
    // Determine base URL
    let baseUrl;
    if (prInfo.hostname && prInfo.hostname.includes('visualstudio.com')) {
      baseUrl = `https://${prInfo.hostname}`;
    } else {
      baseUrl = `https://dev.azure.com/${prInfo.organization}`;
    }

    const apiBase = `${baseUrl}/${prInfo.project}/_apis`;
    const headers = {
      'Authorization': `Basic ${btoa(':' + token)}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Get PR details
    const prResponse = await fetch(
      `${apiBase}/git/repositories/${prInfo.repository}/pullRequests/${prInfo.pullRequestId}?api-version=7.1`,
      { headers }
    );

    if (!prResponse.ok) {
      if (prResponse.status === 401) {
        throw new Error('Azure DevOps token is invalid or expired');
      }
      if (prResponse.status === 403) {
        throw new Error('Access denied. Check your token permissions.');
      }
      throw new Error(`Azure DevOps API error: ${prResponse.status}`);
    }

    const prData = await prResponse.json();

    // Get iterations
    const iterResponse = await fetch(
      `${apiBase}/git/repositories/${prInfo.repository}/pullRequests/${prInfo.pullRequestId}/iterations?api-version=7.1`,
      { headers }
    );

    if (!iterResponse.ok) {
      throw new Error('Failed to fetch PR iterations');
    }

    const iterData = await iterResponse.json();
    const iterations = iterData.value || [];

    if (iterations.length === 0) {
      throw new Error('No iterations found for this pull request');
    }

    // Get latest iteration changes
    const latestIteration = iterations[iterations.length - 1];
    const changesResponse = await fetch(
      `${apiBase}/git/repositories/${prInfo.repository}/pullRequests/${prInfo.pullRequestId}/iterations/${latestIteration.id}/changes?api-version=7.1`,
      { headers }
    );

    if (!changesResponse.ok) {
      throw new Error('Failed to fetch PR changes');
    }

    const changesData = await changesResponse.json();
    const changeEntries = changesData.changeEntries || [];

    // Build a simple diff summary (file list with change types)
    let diffContent = `Pull Request: ${prData.title}\n`;
    diffContent += `Description: ${prData.description || 'No description'}\n\n`;
    diffContent += `Source: ${prData.sourceRefName?.replace('refs/heads/', '')}\n`;
    diffContent += `Target: ${prData.targetRefName?.replace('refs/heads/', '')}\n\n`;
    diffContent += `Changed Files (${changeEntries.length}):\n`;
    diffContent += '---\n\n';

    // Token budget: ~3000 tokens = ~12000 chars for content
    const MAX_TOTAL_CHARS = 10000;
    const MAX_FILE_CHARS = 1500;
    const MAX_FILES = 8;
    
    let totalChars = diffContent.length;
    
    // Prioritize code files
    const codeExtensions = ['.js', '.ts', '.py', '.cs', '.java', '.go', '.rs', '.cpp', '.c', '.jsx', '.tsx', '.vue', '.rb'];
    const sortedEntries = [...changeEntries].sort((a, b) => {
      const pathA = a.item?.path || '';
      const pathB = b.item?.path || '';
      const isCodeA = codeExtensions.some(ext => pathA.endsWith(ext));
      const isCodeB = codeExtensions.some(ext => pathB.endsWith(ext));
      if (isCodeA && !isCodeB) return -1;
      if (isCodeB && !isCodeA) return 1;
      return 0;
    });

    const filesToFetch = sortedEntries.slice(0, MAX_FILES);
    
    for (const entry of filesToFetch) {
      if (totalChars >= MAX_TOTAL_CHARS) {
        diffContent += `\n(Truncated - reached size limit)\n`;
        break;
      }

      const path = entry.item?.path || entry.originalPath;
      if (!path) continue;

      const changeType = getChangeTypeName(entry.changeType);
      const fileHeader = `\n## ${changeType}: ${path}\n`;
      
      diffContent += fileHeader;
      totalChars += fileHeader.length;

      try {
        if (changeType !== 'Delete') {
          const contentResponse = await fetch(
            `${apiBase}/git/repositories/${prInfo.repository}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${encodeURIComponent(prData.sourceRefName.replace('refs/heads/', ''))}&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`,
            { headers }
          );

          if (contentResponse.ok) {
            const contentData = await contentResponse.json();
            if (contentData.content) {
              const remainingBudget = Math.min(MAX_FILE_CHARS, MAX_TOTAL_CHARS - totalChars - 100);
              if (remainingBudget > 100) {
                const truncatedContent = contentData.content.substring(0, remainingBudget);
                const codeBlock = '```\n' + truncatedContent + (truncatedContent.length < contentData.content.length ? '\n...(truncated)' : '') + '\n```\n';
                diffContent += codeBlock;
                totalChars += codeBlock.length;
              }
            }
          }
        }
      } catch (e) {
        diffContent += `(Could not fetch content)\n`;
      }
    }

    if (changeEntries.length > MAX_FILES) {
      diffContent += `\n... and ${changeEntries.length - MAX_FILES} more files not shown\n`;
    }

    return {
      success: true,
      diff: diffContent,
      prTitle: prData.title,
      prDescription: prData.description
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

function getChangeTypeName(changeType) {
  const types = {
    1: 'Add',
    2: 'Edit', 
    4: 'Delete',
    8: 'Rename',
    16: 'SourceRename'
  };
  return types[changeType] || changeType || 'Change';
}

// Log extension startup
console.log('[Azure DevOps AI Review] Extension loaded');
