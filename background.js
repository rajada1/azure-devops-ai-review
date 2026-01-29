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

    case 'POST_PR_COMMENT':
      return await postPRComment(message.prInfo, message.token, message.comment, message.filePath, message.line);

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
    const repoId = prData.repository?.id;
    
    const sourceBranch = prData.sourceRefName?.replace('refs/heads/', '');
    const targetBranch = prData.targetRefName?.replace('refs/heads/', '');

    console.log('[AI Review] PR branches:', { sourceBranch, targetBranch });

    // Method 1: Get diff between branches directly
    const diffResponse = await fetch(
      `${apiBase}/git/repositories/${prInfo.repository}/diffs/commits?baseVersion=${encodeURIComponent(targetBranch)}&baseVersionType=branch&targetVersion=${encodeURIComponent(sourceBranch)}&targetVersionType=branch&api-version=7.1`,
      { headers }
    );

    let changeEntries = [];

    if (diffResponse.ok) {
      const diffData = await diffResponse.json();
      changeEntries = diffData.changes || [];
      console.log('[AI Review] Diff API returned', changeEntries.length, 'changes');
    }

    // Method 2: Fallback to iterations if diff API fails
    if (changeEntries.length === 0) {
      console.log('[AI Review] Trying iterations API...');
      
      const iterResponse = await fetch(
        `${apiBase}/git/repositories/${prInfo.repository}/pullRequests/${prInfo.pullRequestId}/iterations?api-version=7.1`,
        { headers }
      );

      if (iterResponse.ok) {
        const iterData = await iterResponse.json();
        const iterations = iterData.value || [];

        if (iterations.length > 0) {
          const latestIteration = iterations[iterations.length - 1];
          
          // Don't use $compareTo if there's only 1 iteration
          const changesUrl = iterations.length === 1
            ? `${apiBase}/git/repositories/${prInfo.repository}/pullRequests/${prInfo.pullRequestId}/iterations/${latestIteration.id}/changes?api-version=7.1`
            : `${apiBase}/git/repositories/${prInfo.repository}/pullRequests/${prInfo.pullRequestId}/iterations/${latestIteration.id}/changes?$compareTo=0&api-version=7.1`;

          const changesResponse = await fetch(changesUrl, { headers });

          if (changesResponse.ok) {
            const changesData = await changesResponse.json();
            changeEntries = changesData.changeEntries || [];
            console.log('[AI Review] Iterations API returned', changeEntries.length, 'changes');
          }
        }
      }
    }

    // Method 3: Get commits and their changes
    if (changeEntries.length === 0) {
      console.log('[AI Review] Trying commits API...');
      
      const commitsResponse = await fetch(
        `${apiBase}/git/repositories/${prInfo.repository}/pullRequests/${prInfo.pullRequestId}/commits?api-version=7.1`,
        { headers }
      );

      if (commitsResponse.ok) {
        const commitsData = await commitsResponse.json();
        const commits = commitsData.value || [];

        // Get changes from first commit (usually has all PR changes)
        for (const commit of commits.slice(0, 3)) {
          const commitChangesResponse = await fetch(
            `${apiBase}/git/repositories/${prInfo.repository}/commits/${commit.commitId}/changes?api-version=7.1`,
            { headers }
          );

          if (commitChangesResponse.ok) {
            const commitChangesData = await commitChangesResponse.json();
            const commitChanges = commitChangesData.changes || [];
            
            // Merge unique files
            for (const change of commitChanges) {
              const path = change.item?.path;
              if (path && !changeEntries.find(e => (e.item?.path || e.path) === path)) {
                changeEntries.push(change);
              }
            }
          }
        }
        console.log('[AI Review] Commits API returned', changeEntries.length, 'unique changes');
      }
    }

    // Build diff content
    let diffContent = `# Pull Request: ${prData.title}\n`;
    if (prData.description) {
      diffContent += `Description: ${prData.description}\n`;
    }
    diffContent += `\nBranch: ${sourceBranch} → ${targetBranch}\n`;
    diffContent += `Files changed: ${changeEntries.length}\n\n---\n`;

    if (changeEntries.length === 0) {
      diffContent += '\n⚠️ No file changes detected. This might be a permissions issue or the PR has no code changes.\n';
      
      return {
        success: true,
        diff: diffContent,
        prTitle: prData.title,
        prDescription: prData.description,
        prId: prInfo.pullRequestId,
        repoId: repoId,
        iterations: []
      };
    }

    // Token budget
    const MAX_TOTAL_CHARS = 12000;
    const MAX_FILE_CHARS = 2500;
    const MAX_FILES = 10;
    
    let totalChars = diffContent.length;

    // Prioritize code files
    const codeExtensions = ['.js', '.ts', '.py', '.cs', '.java', '.go', '.rs', '.cpp', '.c', '.jsx', '.tsx', '.vue', '.rb', '.php', '.swift', '.kt'];
    const sortedEntries = [...changeEntries].sort((a, b) => {
      const pathA = a.item?.path || a.path || '';
      const pathB = b.item?.path || b.path || '';
      const isCodeA = codeExtensions.some(ext => pathA.endsWith(ext));
      const isCodeB = codeExtensions.some(ext => pathB.endsWith(ext));
      if (isCodeA && !isCodeB) return -1;
      if (isCodeB && !isCodeA) return 1;
      return 0;
    });

    const filesToProcess = sortedEntries.slice(0, MAX_FILES);

    for (const entry of filesToProcess) {
      if (totalChars >= MAX_TOTAL_CHARS) {
        diffContent += `\n(Content truncated - size limit reached)\n`;
        break;
      }

      const path = entry.item?.path || entry.path;
      if (!path) continue;

      const changeType = getChangeTypeName(entry.changeType);
      
      try {
        let fileSection = `\n## ${changeType}: ${path}\n`;

        if (changeType === 'Delete') {
          fileSection += '(File deleted)\n';
        } else {
          // Fetch file content from source branch
          const contentResponse = await fetch(
            `${apiBase}/git/repositories/${prInfo.repository}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${encodeURIComponent(sourceBranch)}&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`,
            { headers }
          );

          if (contentResponse.ok) {
            const contentData = await contentResponse.json();
            if (contentData.content) {
              const content = contentData.content;
              
              if (changeType === 'Add') {
                // New file - show as additions
                const truncated = content.substring(0, MAX_FILE_CHARS);
                fileSection += '```diff\n' + truncated.split('\n').map(l => '+ ' + l).join('\n');
                if (truncated.length < content.length) {
                  fileSection += '\n... (file truncated)';
                }
                fileSection += '\n```\n';
              } else {
                // Edit - try to get target for comparison
                const targetResponse = await fetch(
                  `${apiBase}/git/repositories/${prInfo.repository}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${encodeURIComponent(targetBranch)}&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`,
                  { headers }
                );

                if (targetResponse.ok) {
                  const targetData = await targetResponse.json();
                  const targetContent = targetData.content || '';
                  
                  // Simple diff
                  const sourceLines = content.split('\n');
                  const targetLines = targetContent.split('\n');
                  
                  let diffLines = [];
                  const maxLen = Math.max(sourceLines.length, targetLines.length);
                  
                  for (let i = 0; i < Math.min(maxLen, 150); i++) {
                    const src = sourceLines[i];
                    const tgt = targetLines[i];
                    
                    if (src !== tgt) {
                      if (tgt !== undefined) diffLines.push(`- ${tgt}`);
                      if (src !== undefined) diffLines.push(`+ ${src}`);
                    }
                  }

                  if (diffLines.length > 0) {
                    const diffText = diffLines.slice(0, 80).join('\n').substring(0, MAX_FILE_CHARS);
                    fileSection += '```diff\n' + diffText;
                    if (diffLines.length > 80) {
                      fileSection += '\n... (more changes)';
                    }
                    fileSection += '\n```\n';
                  } else {
                    // Files seem identical, show snippet of new content
                    const preview = content.substring(0, 500);
                    fileSection += '```\n' + preview + '\n... (preview)\n```\n';
                  }
                } else {
                  // Can't get target, just show new content
                  const preview = content.substring(0, MAX_FILE_CHARS);
                  fileSection += '```\n' + preview;
                  if (preview.length < content.length) {
                    fileSection += '\n... (truncated)';
                  }
                  fileSection += '\n```\n';
                }
              }
            } else {
              fileSection += '(Binary or empty file)\n';
            }
          } else {
            fileSection += '(Could not fetch content)\n';
          }
        }

        if (totalChars + fileSection.length > MAX_TOTAL_CHARS) {
          fileSection = fileSection.substring(0, MAX_TOTAL_CHARS - totalChars - 50) + '\n...(truncated)\n```\n';
        }

        diffContent += fileSection;
        totalChars += fileSection.length;

      } catch (e) {
        console.error('[AI Review] Error processing file:', path, e);
        diffContent += `\n## ${changeType}: ${path}\n(Error fetching content)\n`;
      }
    }

    if (changeEntries.length > MAX_FILES) {
      diffContent += `\n---\n... and ${changeEntries.length - MAX_FILES} more files not shown\n`;
    }

    return {
      success: true,
      diff: diffContent,
      prTitle: prData.title,
      prDescription: prData.description,
      prId: prInfo.pullRequestId,
      repoId: repoId,
      iterations: []
    };
  } catch (error) {
    console.error('[AI Review] fetchPRDiff error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function postPRComment(prInfo, token, comment, filePath = null, line = null) {
  try {
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

    // Create a thread with the comment
    const threadPayload = {
      comments: [
        {
          parentCommentId: 0,
          content: comment,
          commentType: 1 // Text comment
        }
      ],
      status: 1 // Active
    };

    // If file path and line are provided, add thread context for inline comment
    if (filePath && line) {
      threadPayload.threadContext = {
        filePath: filePath,
        rightFileStart: { line: line, offset: 1 },
        rightFileEnd: { line: line, offset: 1 }
      };
    }

    const response = await fetch(
      `${apiBase}/git/repositories/${prInfo.repository}/pullRequests/${prInfo.pullRequestId}/threads?api-version=7.1`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(threadPayload)
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      success: true,
      threadId: data.id
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
