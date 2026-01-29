// content/content.js
// Main content script for Azure DevOps PR pages

import { AzureDevOpsAPI, extractPRInfoFromUrl, AzureDevOpsAuthError } from '../services/azure-devops-api.js';

let reviewPanel = null;
let isReviewInProgress = false;
let patchContent = null;
let conversationHistory = [];
let azureApi = null;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  console.log('[AI Review] Initializing on Azure DevOps PR page');
  
  // Wait for page to fully load (Azure DevOps is a SPA)
  await waitForPRPage();
  
  // Create the review panel
  createReviewPanel();
  
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

function waitForPRPage() {
  return new Promise((resolve) => {
    const check = () => {
      const prInfo = extractPRInfoFromUrl();
      if (prInfo) {
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

function observeNavigation() {
  // Watch for URL changes (SPA navigation)
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
    // On a PR page
    if (!reviewPanel) {
      createReviewPanel();
    }
    resetReviewState();
  } else {
    // Not on a PR page
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
        <button class="ai-review-btn-icon" id="ai-review-toggle" title="Minimize">
          −
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
    if (reviewPanel.classList.contains('minimized') && e.target.closest('.ai-review-actions') === null) {
      togglePanel();
    }
  });
}

function togglePanel() {
  reviewPanel.classList.toggle('minimized');
  const toggleBtn = document.getElementById('ai-review-toggle');
  toggleBtn.textContent = reviewPanel.classList.contains('minimized') ? '+' : '−';
}

function updatePanelContent(state, data = null) {
  const content = document.getElementById('ai-review-content');
  const chat = document.getElementById('ai-review-chat');

  switch (state) {
    case 'ready':
      content.innerHTML = `
        <div class="ai-review-ready">
          <p>Click <strong>Start Review</strong> to analyze this pull request with AI.</p>
          <button class="ai-review-btn primary" id="ai-review-start">
            Start Review
          </button>
        </div>
      `;
      chat.style.display = 'none';
      document.getElementById('ai-review-start').addEventListener('click', startReview);
      break;

    case 'loading':
      content.innerHTML = `
        <div class="ai-review-loading">
          <div class="ai-review-spinner"></div>
          <p>Analyzing code changes...</p>
        </div>
      `;
      chat.style.display = 'none';
      break;

    case 'no-provider':
      content.innerHTML = `
        <div class="ai-review-error">
          <p>⚠️ No AI provider configured</p>
          <p>Click the extension icon and go to Settings to configure an AI provider.</p>
        </div>
      `;
      chat.style.display = 'none';
      break;

    case 'no-token':
      content.innerHTML = `
        <div class="ai-review-error">
          <p>⚠️ Azure DevOps token required</p>
          <p>To access private repositories, please configure your Personal Access Token in the extension settings.</p>
        </div>
      `;
      chat.style.display = 'none';
      break;

    case 'error':
      content.innerHTML = `
        <div class="ai-review-error">
          <p>❌ Error</p>
          <p>${escapeHtml(data?.error || 'Unknown error occurred')}</p>
          <button class="ai-review-btn" id="ai-review-retry">Retry</button>
        </div>
      `;
      chat.style.display = 'none';
      document.getElementById('ai-review-retry')?.addEventListener('click', startReview);
      break;

    case 'review':
      renderReview(data);
      chat.style.display = 'flex';
      break;
  }
}

function renderReview(result) {
  const content = document.getElementById('ai-review-content');
  const review = result.review;

  let html = `<div class="ai-review-result">`;

  // Provider info
  html += `<div class="ai-review-provider">
    Reviewed by <strong>${result.provider}</strong> (${result.model})
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
    <p>${escapeHtml(review.summary)}</p>
  </div>`;

  // Issues
  if (review.issues?.length > 0) {
    html += `<div class="ai-review-section">
      <h4>⚠️ Issues (${review.issues.length})</h4>
      <ul class="ai-review-list">
        ${review.issues.map(issue => `
          <li class="severity-${issue.severity}">
            <span class="badge ${issue.severity}">${issue.severity}</span>
            <span>${escapeHtml(issue.description)}</span>
            ${issue.file ? `<span class="file">${escapeHtml(issue.file)}${issue.line ? `:${issue.line}` : ''}</span>` : ''}
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
        ${review.security.map(sec => `
          <li class="severity-${sec.severity}">
            <span class="badge ${sec.severity}">${sec.severity}</span>
            <span>${escapeHtml(sec.description)}</span>
            ${sec.recommendation ? `<div class="recommendation">💡 ${escapeHtml(sec.recommendation)}</div>` : ''}
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
        ${review.suggestions.map(sug => `
          <li>
            <span class="badge suggestion">${sug.type || 'tip'}</span>
            <span>${escapeHtml(sug.description)}</span>
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

  html += `</div>`;
  content.innerHTML = html;
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

  // Expand panel if minimized
  if (reviewPanel.classList.contains('minimized')) {
    togglePanel();
  }

  updatePanelContent('loading');

  try {
    // Get Azure token
    const tokenResult = await chrome.runtime.sendMessage({ type: 'GET_AZURE_TOKEN' });
    
    if (!tokenResult.token) {
      updatePanelContent('no-token');
      isReviewInProgress = false;
      return;
    }

    // Initialize Azure API
    azureApi = new AzureDevOpsAPI();
    azureApi.init({
      token: tokenResult.token,
      organization: prInfo.organization,
      project: prInfo.project,
      repository: prInfo.repository,
      hostname: prInfo.hostname
    });

    // Get PR diff
    patchContent = await azureApi.getPullRequestDiff(prInfo.pullRequestId);
    
    if (!patchContent || patchContent.trim() === '') {
      throw new Error('No code changes found in this pull request');
    }

    // Get PR details for context
    const prDetails = await azureApi.getPullRequest(prInfo.pullRequestId);

    // Send to AI for review
    const result = await chrome.runtime.sendMessage({
      type: 'REVIEW_CODE',
      patchContent,
      options: {
        prTitle: prDetails.title,
        prDescription: prDetails.description
      }
    });

    if (!result.success) {
      if (result.error?.includes('No AI provider')) {
        updatePanelContent('no-provider');
      } else {
        updatePanelContent('error', { error: result.error });
      }
    } else {
      updatePanelContent('review', result);
      conversationHistory = [];
    }
  } catch (error) {
    if (error instanceof AzureDevOpsAuthError) {
      updatePanelContent('error', { error: `Azure DevOps: ${error.message}` });
    } else {
      updatePanelContent('error', { error: error.message });
    }
  } finally {
    isReviewInProgress = false;
  }
}

async function askQuestion() {
  const input = document.getElementById('ai-review-question');
  const question = input.value.trim();
  
  if (!question || !patchContent) return;

  input.value = '';
  input.disabled = true;

  const messages = document.getElementById('ai-review-messages');
  
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
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatResponse(text) {
  // Basic markdown-like formatting
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

console.log('[AI Review] Content script loaded');
