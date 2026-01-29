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
      const diffRules = await ConfigService.getRules();
      return await fetchPRDiff(message.prInfo, message.token, diffRules);

    case 'POST_PR_COMMENT':
      return await postPRComment(message.prInfo, message.token, message.comment, message.filePath, message.line);

    case 'GET_RULES':
      return {
        success: true,
        rules: await ConfigService.getRules()
      };

    case 'SAVE_RULES':
      await ConfigService.saveRules(message.rules);
      return { success: true };

    case 'GET_HISTORY':
      return {
        success: true,
        history: await ConfigService.getHistory()
      };

    case 'GET_HISTORY_ITEM':
      return {
        success: true,
        item: await ConfigService.getHistoryItem(message.id)
      };

    case 'CLEAR_HISTORY':
      await ConfigService.clearHistory();
      return { success: true };

    case 'SAVE_HISTORY_ITEM':
      await ConfigService.saveHistoryItem(message.item);
      return { success: true };

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
    const rules = await ConfigService.getRules();
    
    const reviewOptions = {
      language: settings.language || 'English',
      rules: rules,
      ...options
    };

    const result = await provider.reviewCode(patchContent, reviewOptions);

    // Save to history if successful
    if (result.success && options.prTitle) {
      try {
        await ConfigService.saveHistoryItem({
          prId: options.prId || null,
          prTitle: options.prTitle,
          prUrl: options.prUrl || null,
          review: result.review,
          provider: providerConfig.id,
          model: providerConfig.model
        });
      } catch (e) {
        console.error('Failed to save to history:', e);
      }
    }

    return result;
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

async function fetchPRDiff(prInfo, token, rules = {}) {
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

    const scope = rules.scope || 'changes-only';
    const contextLines = scope === 'changes-context' ? 5 : 0;

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

    let changeEntries = [];

    // Method 1: Use iterations API (most accurate for PR-specific changes)
    console.log('[AI Review] Trying iterations API...');
    
    const iterResponse = await fetch(
      `${apiBase}/git/repositories/${prInfo.repository}/pullRequests/${prInfo.pullRequestId}/iterations?api-version=7.1`,
      { headers }
    );

    if (iterResponse.ok) {
      const iterData = await iterResponse.json();
      const iterations = iterData.value || [];
      console.log('[AI Review] Found', iterations.length, 'iterations');

      if (iterations.length > 0) {
        const latestIteration = iterations[iterations.length - 1];
        
        // Get changes for the latest iteration (comparing to base)
        const changesResponse = await fetch(
          `${apiBase}/git/repositories/${prInfo.repository}/pullRequests/${prInfo.pullRequestId}/iterations/${latestIteration.id}/changes?api-version=7.1`,
          { headers }
        );

        if (changesResponse.ok) {
          const changesData = await changesResponse.json();
          changeEntries = changesData.changeEntries || [];
          console.log('[AI Review] Iterations API returned', changeEntries.length, 'changes');
        } else {
          console.log('[AI Review] Iterations changes failed:', changesResponse.status);
        }
      }
    }

    // Method 2: Get commits and their changes (fallback)
    if (changeEntries.length === 0) {
      console.log('[AI Review] Trying commits API...');
      
      const commitsResponse = await fetch(
        `${apiBase}/git/repositories/${prInfo.repository}/pullRequests/${prInfo.pullRequestId}/commits?api-version=7.1`,
        { headers }
      );

      if (commitsResponse.ok) {
        const commitsData = await commitsResponse.json();
        const commits = commitsData.value || [];
        console.log('[AI Review] Found', commits.length, 'commits in PR');

        // Get changes from each commit in the PR
        for (const commit of commits) {
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

    // Method 3: Last resort - diff between branches (may include unrelated changes)
    if (changeEntries.length === 0) {
      console.log('[AI Review] Trying branch diff API (last resort)...');
      
      const diffResponse = await fetch(
        `${apiBase}/git/repositories/${prInfo.repository}/diffs/commits?baseVersion=${encodeURIComponent(targetBranch)}&baseVersionType=branch&targetVersion=${encodeURIComponent(sourceBranch)}&targetVersionType=branch&api-version=7.1`,
        { headers }
      );

      if (diffResponse.ok) {
        const diffData = await diffResponse.json();
        changeEntries = diffData.changes || [];
        console.log('[AI Review] Branch diff API returned', changeEntries.length, 'changes (may include unrelated)');
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
          // Try fetching with repository name first, then with ID
          let contentResponse = await fetch(
            `${apiBase}/git/repositories/${prInfo.repository}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${encodeURIComponent(sourceBranch)}&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`,
            { headers }
          );

          // If failed and we have repoId, try with ID
          if (!contentResponse.ok && repoId) {
            console.log('[AI Review] Retrying with repoId for:', path);
            contentResponse = await fetch(
              `${apiBase}/git/repositories/${repoId}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${encodeURIComponent(sourceBranch)}&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1`,
              { headers }
            );
          }

          // Try fetching as raw text if JSON fails
          if (!contentResponse.ok) {
            console.log('[AI Review] Trying raw text fetch for:', path, 'status:', contentResponse.status);
            contentResponse = await fetch(
              `${apiBase}/git/repositories/${prInfo.repository}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${encodeURIComponent(sourceBranch)}&versionDescriptor.versionType=branch&api-version=7.1`,
              { 
                headers: {
                  ...headers,
                  'Accept': 'text/plain'
                }
              }
            );
            
            if (contentResponse.ok) {
              const textContent = await contentResponse.text();
              if (textContent) {
                const truncated = textContent.substring(0, MAX_FILE_CHARS);
                fileSection += '```\n' + truncated;
                if (truncated.length < textContent.length) {
                  fileSection += '\n... (truncated)';
                }
                fileSection += '\n```\n';
                
                if (totalChars + fileSection.length <= MAX_TOTAL_CHARS) {
                  diffContent += fileSection;
                  totalChars += fileSection.length;
                }
                continue;
              }
            }
          }

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
                  
                  // Generate unified diff with context based on scope setting
                  const diffResult = generateUnifiedDiff(targetContent, content, path, scope, contextLines);
                  
                  if (diffResult.length > 0) {
                    const diffText = diffResult.substring(0, MAX_FILE_CHARS);
                    fileSection += '```diff\n' + diffText;
                    if (diffResult.length > MAX_FILE_CHARS) {
                      fileSection += '\n... (diff truncated)';
                    }
                    fileSection += '\n```\n';
                  } else {
                    // No actual changes detected
                    fileSection += '(No text changes detected)\n';
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
            console.log('[AI Review] Failed to fetch content for:', path, 'status:', contentResponse.status);
            fileSection += `(Could not fetch content - ${contentResponse.status})\n`;
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

/**
 * Generate a unified diff between two file contents
 * Shows only the changed lines with context
 * 
 * @param {string} oldContent - Original file content (target branch)
 * @param {string} newContent - New file content (source branch)  
 * @param {string} filePath - File path for display
 * @param {string} scope - 'changes-only', 'changes-context', or 'full-file'
 * @param {number} contextLines - Number of context lines (default 3)
 * @returns {string} - Formatted diff
 */
function generateUnifiedDiff(oldContent, newContent, filePath, scope = 'changes-only', contextLines = 3) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  // For full-file scope, show the entire new file
  if (scope === 'full-file') {
    return newLines.slice(0, 200).map((line, i) => `${String(i + 1).padStart(4)} | ${line}`).join('\n');
  }
  
  // Find which lines changed
  const changedRanges = [];
  let inChange = false;
  let changeStart = -1;
  
  // Use simple line-by-line comparison with offset tolerance
  const maxLen = Math.max(oldLines.length, newLines.length);
  const changes = new Map(); // line number -> { type: 'add'|'remove'|'modify', oldLine?, newLine? }
  
  // Find matching and differing sections
  let oldIdx = 0;
  let newIdx = 0;
  
  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];
    
    if (oldLine === newLine) {
      // Lines match, move both forward
      oldIdx++;
      newIdx++;
    } else if (oldLine === undefined) {
      // Added line at end
      changes.set(newIdx, { type: 'add', newLine, newIdx });
      newIdx++;
    } else if (newLine === undefined) {
      // Removed line at end
      changes.set(oldIdx + 10000, { type: 'remove', oldLine, oldIdx }); // offset to avoid collision
      oldIdx++;
    } else {
      // Lines differ - check if it's a modification or insert/delete
      // Look ahead to find if old line exists later in new content
      const oldInNew = newLines.indexOf(oldLine, newIdx);
      const newInOld = oldLines.indexOf(newLine, oldIdx);
      
      if (oldInNew !== -1 && (newInOld === -1 || oldInNew - newIdx < newInOld - oldIdx)) {
        // Old line found later in new - lines were added
        while (newIdx < oldInNew) {
          changes.set(newIdx, { type: 'add', newLine: newLines[newIdx], newIdx });
          newIdx++;
        }
      } else if (newInOld !== -1) {
        // New line found later in old - lines were removed
        while (oldIdx < newInOld) {
          changes.set(oldIdx + 10000, { type: 'remove', oldLine: oldLines[oldIdx], oldIdx });
          oldIdx++;
        }
      } else {
        // Line was modified
        changes.set(oldIdx + 10000, { type: 'remove', oldLine, oldIdx });
        changes.set(newIdx, { type: 'add', newLine, newIdx });
        oldIdx++;
        newIdx++;
      }
    }
  }
  
  if (changes.size === 0) {
    return '';
  }
  
  // Build output with context
  const result = [];
  const changedNewLines = new Set();
  const changedOldLines = new Set();
  
  changes.forEach((change, key) => {
    if (change.type === 'add') {
      changedNewLines.add(change.newIdx);
    } else {
      changedOldLines.add(change.oldIdx);
    }
  });
  
  // Generate output showing changes with context
  let lastOutputLine = -10;
  
  for (let i = 0; i < newLines.length; i++) {
    const isChanged = changedNewLines.has(i);
    const needsContext = scope === 'changes-context';
    
    // Check if within context range of a change
    let inContextRange = false;
    if (needsContext) {
      for (let j = Math.max(0, i - contextLines); j <= Math.min(newLines.length - 1, i + contextLines); j++) {
        if (changedNewLines.has(j)) {
          inContextRange = true;
          break;
        }
      }
    }
    
    if (isChanged) {
      // Show removed lines first (from old content around this position)
      changedOldLines.forEach(oldIdx => {
        if (Math.abs(oldIdx - i) <= 2) {
          result.push(`- ${oldLines[oldIdx]}`);
          changedOldLines.delete(oldIdx);
        }
      });
      
      result.push(`+ ${newLines[i]}`);
      lastOutputLine = i;
    } else if (inContextRange) {
      // Add separator if there's a gap
      if (i > lastOutputLine + 1 && result.length > 0) {
        result.push('  ...');
      }
      result.push(`  ${newLines[i]}`);
      lastOutputLine = i;
    } else if (scope === 'changes-only' && isChanged) {
      result.push(`+ ${newLines[i]}`);
      lastOutputLine = i;
    }
  }
  
  // Add any remaining removed lines
  changedOldLines.forEach(oldIdx => {
    result.push(`- ${oldLines[oldIdx]}`);
  });
  
  return result.slice(0, 150).join('\n'); // Limit output
}

// Log extension startup
console.log('[Azure DevOps AI Review] Extension loaded');
