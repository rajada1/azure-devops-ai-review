// content/content.js
// Main content script for Azure DevOps PR pages
// Note: Content scripts don't support ES modules, so we inline needed functions

let reviewPanel = null;
let isReviewInProgress = false;
let patchContent = null;
let conversationHistory = [];
let currentPrInfo = null;
let lastReviewResult = null; // Keep review state

// Storage key for persistence
const STORAGE_KEY = 'ai-review-state';

// Save state to sessionStorage
function saveState() {
  if (!currentPrInfo) return;
  const key = `${STORAGE_KEY}-${currentPrInfo.pullRequestId}`;
  const state = {
    lastReviewResult,
    conversationHistory,
    patchContent,
    timestamp: Date.now()
  };
  try {
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch (e) {
    console.warn('[AI Review] Failed to save state:', e);
  }
}

// Load state from sessionStorage
function loadState() {
  if (!currentPrInfo) return false;
  const key = `${STORAGE_KEY}-${currentPrInfo.pullRequestId}`;
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) {
      const state = JSON.parse(saved);
      // Only use if less than 1 hour old
      if (Date.now() - state.timestamp < 3600000) {
        lastReviewResult = state.lastReviewResult;
        conversationHistory = state.conversationHistory || [];
        patchContent = state.patchContent;
        return true;
      }
    }
  } catch (e) {
    console.warn('[AI Review] Failed to load state:', e);
  }
  return false;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  console.log('[AI Review] Initializing on Azure DevOps PR page');
  
  // Wait a bit for SPA to load
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const prInfo = extractPRInfoFromUrl();
  if (prInfo) {
    console.log('[AI Review] PR detected:', prInfo);
    currentPrInfo = prInfo; // Set early for state loading
    createReviewPanel();
    
    // Try to restore previous review state
    if (loadState() && lastReviewResult) {
      console.log('[AI Review] Restored previous review state');
      updatePanelContent('review', lastReviewResult);
    }
  } else {
    console.log('[AI Review] Not on a PR page, waiting for navigation...');
  }
  
  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_REVIEW_PANEL') {
      togglePanel();
      sendResponse({ success: true });
    }
    return true;
  });

  // Watch for SPA navigation
  observeNavigation();
}

/**
 * Extract PR info from current URL
 */
function extractPRInfoFromUrl() {
  const url = window.location.href;
  const hostname = window.location.hostname;
  
  let match;
  
  if (hostname === 'dev.azure.com') {
    match = url.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/);
    if (match) {
      return {
        organization: match[1],
        project: match[2],
        repository: match[3],
        pullRequestId: match[4],
        hostname: 'dev.azure.com'
      };
    }
  } else if (hostname.includes('visualstudio.com')) {
    match = url.match(/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/);
    if (match) {
      return {
        organization: match[1],
        project: match[2],
        repository: match[3],
        pullRequestId: match[4],
        hostname: hostname
      };
    }
  }
  
  return null;
}

function observeNavigation() {
  let lastUrl = location.href;
  
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onNavigate();
    }
  }).observe(document.body, { subtree: true, childList: true });
}

function onNavigate() {
  const prInfo = extractPRInfoFromUrl();
  
  if (prInfo) {
    // Check if we're still on the same PR
    const samePR = currentPrInfo && 
                   currentPrInfo.pullRequestId === prInfo.pullRequestId &&
                   currentPrInfo.repository === prInfo.repository;
    
    if (!reviewPanel) {
      currentPrInfo = prInfo;
      createReviewPanel();
      // Try to restore state for this PR
      if (loadState() && lastReviewResult) {
        updatePanelContent('review', lastReviewResult);
      }
    } else {
      reviewPanel.classList.remove('hidden');
      
      // Only reset if we navigated to a DIFFERENT PR
      if (!samePR) {
        currentPrInfo = prInfo;
        // Try to load state for the new PR
        if (loadState() && lastReviewResult) {
          updatePanelContent('review', lastReviewResult);
        } else {
          resetReviewState();
        }
      }
      // If same PR, don't reset - keep the current review visible
    }
  } else {
    if (reviewPanel) {
      reviewPanel.classList.add('hidden');
    }
  }
}

function resetReviewState() {
  isReviewInProgress = false;
  patchContent = null;
  conversationHistory = [];
  updatePanelContent('ready');
}

function createReviewPanel() {
  if (document.getElementById('ai-review-panel')) {
    reviewPanel = document.getElementById('ai-review-panel');
    return;
  }

  console.log('[AI Review] Creating review panel');

  reviewPanel = document.createElement('div');
  reviewPanel.id = 'ai-review-panel';
  reviewPanel.className = 'ai-review-panel minimized';
  
  reviewPanel.innerHTML = `
    <div class="ai-review-header">
      <div class="ai-review-title">
        <span class="ai-review-icon">🤖</span>
        <span>AI Code Review</span>
      </div>
      <div class="ai-review-actions">
        <button class="ai-review-btn-icon" id="ai-review-refresh" title="New Review">
          ↻
        </button>
        <button class="ai-review-btn-icon" id="ai-review-toggle" title="Expand">
          +
        </button>
      </div>
    </div>
    <div class="ai-review-body">
      <div class="ai-review-content" id="ai-review-content">
        <div class="ai-review-ready">
          <p>Click <strong>Start Review</strong> to analyze this pull request with AI.</p>
          <button class="ai-review-btn primary" id="ai-review-start">
            Start Review
          </button>
        </div>
      </div>
      <div class="ai-review-chat" id="ai-review-chat">
        <div class="ai-review-chat-messages" id="ai-review-messages"></div>
        <div class="ai-review-chat-input">
          <input type="text" id="ai-review-question" placeholder="Ask a follow-up question...">
          <button class="ai-review-btn" id="ai-review-ask">Ask</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(reviewPanel);

  // Event listeners
  document.getElementById('ai-review-toggle').addEventListener('click', togglePanel);
  document.getElementById('ai-review-refresh').addEventListener('click', startReview);
  document.getElementById('ai-review-start').addEventListener('click', startReview);
  document.getElementById('ai-review-ask').addEventListener('click', askQuestion);
  document.getElementById('ai-review-question').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') askQuestion();
  });

  // Click on header to toggle if minimized
  document.querySelector('.ai-review-header').addEventListener('click', (e) => {
    if (reviewPanel.classList.contains('minimized') && !e.target.closest('.ai-review-actions')) {
      togglePanel();
    }
  });

  console.log('[AI Review] Panel created successfully');
}

function togglePanel() {
  if (!reviewPanel) return;
  
  reviewPanel.classList.toggle('minimized');
  const toggleBtn = document.getElementById('ai-review-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = reviewPanel.classList.contains('minimized') ? '+' : '−';
  }
}

function updatePanelContent(state, data = null) {
  const content = document.getElementById('ai-review-content');
  const chat = document.getElementById('ai-review-chat');

  if (!content) return;

  switch (state) {
    case 'idle':
    case 'ready':
      // If we have a saved review, show it instead
      if (lastReviewResult && state === 'idle') {
        renderReview(lastReviewResult);
        if (chat) chat.style.display = 'flex';
        return;
      }
      content.innerHTML = `
        <div class="ai-review-ready">
          <p>Click <strong>Start Review</strong> to analyze this pull request with AI.</p>
          <button class="ai-review-btn primary" id="ai-review-start">
            Start Review
          </button>
        </div>
      `;
      if (chat) chat.style.display = 'none';
      document.getElementById('ai-review-start')?.addEventListener('click', startReview);
      break;

    case 'loading':
      content.innerHTML = `
        <div class="ai-review-loading">
          <div class="ai-review-spinner"></div>
          <p>Analyzing code changes...</p>
        </div>
      `;
      if (chat) chat.style.display = 'none';
      break;

    case 'no-provider':
      content.innerHTML = `
        <div class="ai-review-error">
          <p>⚠️ No AI provider configured</p>
          <p>Click the extension icon and go to <strong>Providers</strong> to add one.</p>
        </div>
      `;
      if (chat) chat.style.display = 'none';
      break;

    case 'no-token':
      content.innerHTML = `
        <div class="ai-review-error">
          <p>⚠️ Azure DevOps token required</p>
          <p>Go to extension <strong>Settings</strong> and add your Personal Access Token.</p>
        </div>
      `;
      if (chat) chat.style.display = 'none';
      break;

    case 'error':
      content.innerHTML = `
        <div class="ai-review-error">
          <p>❌ Error</p>
          <p>${escapeHtml(data?.error || 'Unknown error occurred')}</p>
          <button class="ai-review-btn" id="ai-review-retry">Retry</button>
        </div>
      `;
      if (chat) chat.style.display = 'none';
      document.getElementById('ai-review-retry')?.addEventListener('click', startReview);
      break;

    case 'review':
      renderReview(data);
      if (chat) chat.style.display = 'flex';
      break;
  }
}

function renderReview(result) {
  const content = document.getElementById('ai-review-content');
  if (!content) return;
  
  const review = result.review;

  let html = `<div class="ai-review-result">`;

  // Provider info
  html += `<div class="ai-review-provider">
    Reviewed by <strong>${escapeHtml(result.provider || 'AI')}</strong> (${escapeHtml(result.model || 'unknown')})
  </div>`;

  // Metrics
  if (review.metrics) {
    html += `<div class="ai-review-metrics">
      <div class="metric">
        <span class="metric-value">${review.metrics.overallScore || '-'}</span>
        <span class="metric-label">Overall</span>
      </div>
      <div class="metric">
        <span class="metric-value">${review.metrics.codeQuality || '-'}</span>
        <span class="metric-label">Quality</span>
      </div>
      <div class="metric">
        <span class="metric-value">${review.metrics.securityScore || '-'}</span>
        <span class="metric-label">Security</span>
      </div>
      <div class="metric">
        <span class="metric-value">${review.metrics.maintainability || '-'}</span>
        <span class="metric-label">Maintainability</span>
      </div>
    </div>`;
  }

  // Summary
  html += `<div class="ai-review-section">
    <h4>📝 Summary</h4>
    <p>${escapeHtml(review.summary || 'No summary available')}</p>
  </div>`;

  // Helper to create file link
  const createFileLink = (file, line) => {
    if (!file) return '';
    const lineStr = line ? `:${line}` : '';
    return `<span class="file-link" data-file="${escapeHtml(file)}" data-line="${line || ''}" title="Click to go to file">📄 ${escapeHtml(file)}${lineStr}</span>`;
  };

  // Helper for code snippets
  const renderCodeSnippet = (codeSnippet, suggestedCode) => {
    if (!codeSnippet && !suggestedCode) return '';
    
    let html = '';
    if (codeSnippet) {
      html += `<div class="code-snippet-container">
        <div class="code-snippet-label">Current code:</div>
        <pre class="code-snippet code-current">${escapeHtml(codeSnippet)}</pre>
      </div>`;
    }
    if (suggestedCode) {
      html += `<div class="code-snippet-container">
        <div class="code-snippet-label">Suggested fix:</div>
        <pre class="code-snippet code-suggested">${escapeHtml(suggestedCode)}</pre>
      </div>`;
    }
    return html;
  };

  // Issues
  if (review.issues?.length > 0) {
    html += `<div class="ai-review-section">
      <h4>⚠️ Issues (${review.issues.length})</h4>
      <ul class="ai-review-list">
        ${review.issues.map((issue, idx) => `
          <li class="severity-${issue.severity || 'medium'}" data-issue-idx="${idx}">
            <div class="issue-header">
              <span class="badge ${issue.severity || 'medium'}">${issue.severity || 'info'}</span>
              <span class="issue-text">${escapeHtml(issue.description || '')}</span>
            </div>
            ${createFileLink(issue.file, issue.line)}
            ${renderCodeSnippet(issue.codeSnippet, issue.suggestedCode)}
            ${issue.suggestion ? `<div class="recommendation">💡 ${escapeHtml(issue.suggestion)}</div>` : ''}
            <button class="ai-review-btn-small add-comment-btn" 
                    data-type="issue" 
                    data-file="${escapeHtml(issue.file || '')}" 
                    data-line="${issue.line || ''}"
                    data-text="${escapeHtml(issue.description || '')}">
              💬 Add Comment
            </button>
          </li>
        `).join('')}
      </ul>
    </div>`;
  }

  // Security
  if (review.security?.length > 0) {
    html += `<div class="ai-review-section">
      <h4>🔒 Security Concerns (${review.security.length})</h4>
      <ul class="ai-review-list">
        ${review.security.map((sec, idx) => `
          <li class="severity-${sec.severity || 'medium'}" data-security-idx="${idx}">
            <div class="issue-header">
              <span class="badge ${sec.severity || 'medium'}">${sec.severity || 'warning'}</span>
              <span class="issue-text">${escapeHtml(sec.description || '')}</span>
            </div>
            ${createFileLink(sec.file, sec.line)}
            ${renderCodeSnippet(sec.codeSnippet, sec.suggestedCode)}
            ${sec.recommendation ? `<div class="recommendation">💡 ${escapeHtml(sec.recommendation)}</div>` : ''}
            <button class="ai-review-btn-small add-comment-btn" 
                    data-type="security" 
                    data-file="${escapeHtml(sec.file || '')}" 
                    data-line="${sec.line || ''}"
                    data-text="${escapeHtml(sec.description + (sec.recommendation ? ' - ' + sec.recommendation : ''))}">
              💬 Add Comment
            </button>
          </li>
        `).join('')}
      </ul>
    </div>`;
  }

  // Suggestions
  if (review.suggestions?.length > 0) {
    html += `<div class="ai-review-section">
      <h4>💡 Suggestions (${review.suggestions.length})</h4>
      <ul class="ai-review-list">
        ${review.suggestions.map((sug, idx) => `
          <li data-suggestion-idx="${idx}">
            <div class="issue-header">
              <span class="badge suggestion">${sug.type || 'tip'}</span>
              <span class="issue-text">${escapeHtml(sug.description || '')}</span>
            </div>
            ${createFileLink(sug.file, sug.line)}
            ${renderCodeSnippet(sug.codeSnippet, sug.suggestedCode)}
            <button class="ai-review-btn-small add-comment-btn" 
                    data-type="suggestion" 
                    data-file="${escapeHtml(sug.file || '')}" 
                    data-line="${sug.line || ''}"
                    data-text="${escapeHtml(sug.description || '')}">
              💬 Add Comment
            </button>
          </li>
        `).join('')}
      </ul>
    </div>`;
  }

  // Positives
  if (review.positives?.length > 0) {
    html += `<div class="ai-review-section">
      <h4>✅ Positives</h4>
      <ul class="ai-review-list positives">
        ${review.positives.map(pos => `<li>${escapeHtml(pos)}</li>`).join('')}
      </ul>
    </div>`;
  }

  // Action buttons
  html += `<div class="ai-review-actions">
    <button class="ai-review-btn btn-secondary" id="view-diff-btn">🔍 View Raw Diff</button>
    <button class="ai-review-btn btn-secondary" id="clear-review-btn">🗑️ Clear Review</button>
  </div>`;

  html += `</div>`;
  content.innerHTML = html;

  // Add event listeners for comment buttons
  content.querySelectorAll('.add-comment-btn').forEach(btn => {
    btn.addEventListener('click', handleAddComment);
  });

  // Add event listeners for file links
  content.querySelectorAll('.file-link').forEach(link => {
    link.addEventListener('click', handleFileClick);
  });

  // Add event listener for clear button
  document.getElementById('clear-review-btn')?.addEventListener('click', clearReview);

  // Add event listener for view diff button
  document.getElementById('view-diff-btn')?.addEventListener('click', openDiffViewer);
}

function openDiffViewer() {
  // Open the diff viewer page in a new tab
  const viewerUrl = chrome.runtime.getURL('diff-viewer.html');
  window.open(viewerUrl, '_blank');
}

function handleFileClick(event) {
  const file = event.target.dataset.file;
  const line = event.target.dataset.line;
  
  if (!file || !currentPrInfo) return;

  // Build URL to the file in the PR
  let baseUrl;
  if (currentPrInfo.hostname && currentPrInfo.hostname.includes('visualstudio.com')) {
    baseUrl = `https://${currentPrInfo.hostname}`;
  } else {
    baseUrl = `https://dev.azure.com/${currentPrInfo.organization}`;
  }

  // Azure DevOps PR file URL format - navigate to Files tab with path
  // Format: /project/_git/repo/pullrequest/id?_a=files&path=/path/to/file
  let fileUrl = `${baseUrl}/${currentPrInfo.project}/_git/${currentPrInfo.repository}/pullrequest/${currentPrInfo.pullRequestId}?_a=files&path=${encodeURIComponent(file)}`;
  
  // Note: Azure DevOps doesn't support line anchors in PR file view, but this will at least navigate to the file

  // Open in new tab to preserve review state
  window.open(fileUrl, '_blank');
}

function clearReview() {
  lastReviewResult = null;
  conversationHistory = [];
  patchContent = null;
  
  // Clear from sessionStorage
  if (currentPrInfo) {
    const key = `${STORAGE_KEY}-${currentPrInfo.pullRequestId}`;
    try {
      sessionStorage.removeItem(key);
    } catch (e) {}
  }
  
  updatePanelContent('ready');
}

async function startReview() {
  if (isReviewInProgress) return;
  isReviewInProgress = true;

  const prInfo = extractPRInfoFromUrl();
  if (!prInfo) {
    updatePanelContent('error', { error: 'Could not detect pull request information' });
    isReviewInProgress = false;
    return;
  }

  // Store for comment posting
  currentPrInfo = prInfo;

  // Expand panel if minimized
  if (reviewPanel && reviewPanel.classList.contains('minimized')) {
    togglePanel();
  }

  updatePanelContent('loading');

  try {
    // Get Azure token from background
    const tokenResult = await chrome.runtime.sendMessage({ type: 'GET_AZURE_TOKEN' });
    
    if (!tokenResult.token) {
      updatePanelContent('no-token');
      isReviewInProgress = false;
      return;
    }

    // Fetch PR diff via background script
    const diffResult = await chrome.runtime.sendMessage({
      type: 'FETCH_PR_DIFF',
      prInfo,
      token: tokenResult.token
    });

    if (!diffResult.success) {
      throw new Error(diffResult.error || 'Failed to fetch PR diff');
    }

    patchContent = diffResult.diff;
    
    if (!patchContent || patchContent.trim() === '') {
      throw new Error('No code changes found in this pull request');
    }

    // Build PR URL for history
    let prUrl = window.location.href;

    // Send to AI for review
    const result = await chrome.runtime.sendMessage({
      type: 'REVIEW_CODE',
      patchContent,
      options: {
        prId: prInfo.pullRequestId,
        prTitle: diffResult.prTitle || '',
        prDescription: diffResult.prDescription || '',
        prUrl: prUrl
      }
    });

    if (!result.success) {
      if (result.error?.includes('No AI provider')) {
        updatePanelContent('no-provider');
      } else {
        updatePanelContent('error', { error: result.error });
      }
    } else {
      lastReviewResult = result; // Save for state persistence
      updatePanelContent('review', result);
      conversationHistory = [];
      saveState(); // Persist to sessionStorage
    }
  } catch (error) {
    console.error('[AI Review] Error:', error);
    updatePanelContent('error', { error: error.message });
  } finally {
    isReviewInProgress = false;
  }
}

async function askQuestion() {
  const input = document.getElementById('ai-review-question');
  if (!input) return;
  
  const question = input.value.trim();
  
  if (!question || !patchContent) return;

  input.value = '';
  input.disabled = true;

  const messages = document.getElementById('ai-review-messages');
  if (!messages) return;
  
  // Add user message
  messages.innerHTML += `
    <div class="chat-message user">
      <span class="role">You:</span>
      ${escapeHtml(question)}
    </div>
  `;

  // Add loading indicator
  const loadingId = `loading-${Date.now()}`;
  messages.innerHTML += `
    <div class="chat-message assistant loading" id="${loadingId}">
      <span class="role">AI:</span>
      <span class="typing">Thinking...</span>
    </div>
  `;
  messages.scrollTop = messages.scrollHeight;

  // Update conversation history
  conversationHistory.push({ role: 'user', content: question });

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'CHAT',
      patchContent,
      conversationHistory,
      options: {}
    });

    // Remove loading indicator
    document.getElementById(loadingId)?.remove();

    if (result.success) {
      conversationHistory.push({ role: 'assistant', content: result.response });
      messages.innerHTML += `
        <div class="chat-message assistant">
          <span class="role">AI:</span>
          <div class="response">${formatResponse(result.response)}</div>
        </div>
      `;
    } else {
      messages.innerHTML += `
        <div class="chat-message error">
          Error: ${escapeHtml(result.error)}
        </div>
      `;
    }
  } catch (error) {
    document.getElementById(loadingId)?.remove();
    messages.innerHTML += `
      <div class="chat-message error">
        Error: ${escapeHtml(error.message)}
      </div>
    `;
  } finally {
    input.disabled = false;
    input.focus();
    messages.scrollTop = messages.scrollHeight;
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatResponse(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

async function handleAddComment(event) {
  const btn = event.target;
  const file = btn.dataset.file || null;
  const line = btn.dataset.line ? parseInt(btn.dataset.line) : null;
  const text = btn.dataset.text || '';
  const type = btn.dataset.type || 'suggestion';

  if (!currentPrInfo) {
    showNotification('Error: PR info not available', 'error');
    return;
  }

  // Show modal to edit/confirm comment
  const modal = document.createElement('div');
  modal.className = 'ai-review-modal';
  modal.innerHTML = `
    <div class="ai-review-modal-content">
      <h4>Add Comment to PR</h4>
      ${file ? `<p class="file-info">📄 ${escapeHtml(file)}${line ? `:${line}` : ''}</p>` : '<p class="file-info">📄 General comment (no specific file)</p>'}
      <textarea id="comment-text" rows="5" placeholder="Enter your comment...">${escapeHtml(text)}</textarea>
      <div class="modal-actions">
        <button class="ai-review-btn" id="btn-post-comment">Post Comment</button>
        <button class="ai-review-btn btn-secondary" id="btn-cancel-comment">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('btn-cancel-comment').addEventListener('click', () => {
    modal.remove();
  });

  document.getElementById('btn-post-comment').addEventListener('click', async () => {
    const commentText = document.getElementById('comment-text').value.trim();
    if (!commentText) {
      showNotification('Please enter a comment', 'error');
      return;
    }

    const postBtn = document.getElementById('btn-post-comment');
    postBtn.disabled = true;
    postBtn.textContent = 'Posting...';

    try {
      const tokenResult = await chrome.runtime.sendMessage({ type: 'GET_AZURE_TOKEN' });
      if (!tokenResult.token) {
        showNotification('Azure DevOps token not configured', 'error');
        return;
      }

      const result = await chrome.runtime.sendMessage({
        type: 'POST_PR_COMMENT',
        prInfo: currentPrInfo,
        token: tokenResult.token,
        comment: file && !line ? `📍 **${file}**\n\n${commentText}` : commentText,
        filePath: file || null,
        line: line || null
      });

      if (result.success) {
        showNotification('Comment posted successfully!', 'success');
        modal.remove();
        // Mark button as done
        btn.textContent = '✓ Posted';
        btn.disabled = true;
        btn.classList.add('posted');
      } else {
        showNotification(`Failed to post: ${result.error}`, 'error');
      }
    } catch (error) {
      showNotification(`Error: ${error.message}`, 'error');
    } finally {
      postBtn.disabled = false;
      postBtn.textContent = 'Post Comment';
    }
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `ai-review-notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 4000);
}

console.log('[AI Review] Content script loaded');
