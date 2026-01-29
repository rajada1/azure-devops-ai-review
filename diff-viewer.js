let rawDiff = '';
let prData = null;

// Get diff data from storage
async function loadDiff() {
  try {
    const result = await chrome.storage.local.get(['lastDiff', 'lastPrInfo']);
    
    if (!result.lastDiff) {
      showEmpty();
      return;
    }

    rawDiff = result.lastDiff;
    prData = result.lastPrInfo || {};

    renderPrInfo();
    renderDiff(rawDiff);
  } catch (error) {
    console.error('Failed to load diff:', error);
    showError(error.message);
  }
}

function renderPrInfo() {
  const titleEl = document.getElementById('pr-title');
  const metaEl = document.getElementById('pr-meta');

  titleEl.textContent = prData.title || 'Pull Request Diff';

  let metaHtml = '';
  if (prData.sourceBranch && prData.targetBranch) {
    metaHtml += `<span>🔀 ${prData.sourceBranch} → ${prData.targetBranch}</span>`;
  }
  if (prData.filesChanged) {
    metaHtml += `<span>📁 ${prData.filesChanged} files</span>`;
  }
  metaEl.innerHTML = metaHtml;
}

function renderDiff(diffContent) {
  const container = document.getElementById('diff-container');
  
  // Parse the diff content into files
  const files = parseDiff(diffContent);

  if (files.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>No changes found</h2>
        <p>The diff is empty or could not be parsed.</p>
      </div>
    `;
    return;
  }

  let html = '';
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const file of files) {
    totalAdditions += file.additions;
    totalDeletions += file.deletions;

    html += `
      <div class="file-section">
        <div class="file-header">
          <span>${file.path}</span>
          <span class="change-type ${file.changeType.toLowerCase()}">${file.changeType}</span>
        </div>
        <div class="diff-content">
          <table class="diff-table">
            ${file.lines.map(line => `
              <tr class="line-${line.type}">
                <td class="line-num">${line.lineNum || ''}</td>
                <td class="line-content">${escapeHtml(line.content)}</td>
              </tr>
            `).join('')}
          </table>
        </div>
      </div>
    `;
  }

  // Add stats to pr-meta
  const metaEl = document.getElementById('pr-meta');
  metaEl.innerHTML += `
    <div class="stats">
      <span class="stat additions">+${totalAdditions}</span>
      <span class="stat deletions">-${totalDeletions}</span>
      <span class="stat files">${files.length} files</span>
    </div>
  `;

  container.innerHTML = html;
}

function parseDiff(diffContent) {
  const files = [];
  const sections = diffContent.split(/\n## /);

  for (const section of sections) {
    if (!section.trim()) continue;

    // Parse file header
    const headerMatch = section.match(/^(Add|Edit|Delete|Rename|Change):\s*(.+)/);
    if (!headerMatch) continue;

    const changeType = headerMatch[1];
    const filePath = headerMatch[2].trim();

    // Parse lines
    const lines = [];
    let additions = 0;
    let deletions = 0;

    // Find code block content
    const codeMatch = section.match(/```(?:diff)?\n([\s\S]*?)```/);
    if (codeMatch) {
      const codeLines = codeMatch[1].split('\n');
      
      for (const line of codeLines) {
        // Parse line with number format: "L 42 + content" or "L 42 - content"
        const lineMatch = line.match(/^L\s*(\d+)\s*([+-]?)\s*(.*)$/);
        
        if (lineMatch) {
          const lineNum = lineMatch[1];
          const symbol = lineMatch[2];
          const content = lineMatch[3];
          
          if (symbol === '+') {
            lines.push({ type: 'add', lineNum, content });
            additions++;
          } else if (symbol === '-') {
            lines.push({ type: 'del', lineNum, content });
            deletions++;
          } else {
            lines.push({ type: 'context', lineNum, content });
          }
        } else if (line.startsWith('+')) {
          lines.push({ type: 'add', lineNum: '', content: line.substring(1).trim() });
          additions++;
        } else if (line.startsWith('-')) {
          lines.push({ type: 'del', lineNum: '', content: line.substring(1).trim() });
          deletions++;
        } else if (line.trim()) {
          lines.push({ type: 'context', lineNum: '', content: line });
        }
      }
    }

    if (lines.length > 0 || changeType === 'Delete') {
      files.push({
        path: filePath,
        changeType,
        lines,
        additions,
        deletions
      });
    }
  }

  return files;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showEmpty() {
  document.getElementById('pr-title').textContent = 'No Diff Available';
  document.getElementById('diff-container').innerHTML = `
    <div class="empty-state">
      <h2>No diff data found</h2>
      <p>Open a Pull Request in Azure DevOps and start a review to see the diff here.</p>
    </div>
  `;
}

function showError(message) {
  document.getElementById('diff-container').innerHTML = `
    <div class="empty-state">
      <h2>Error loading diff</h2>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

// Search functionality
document.getElementById('search-input').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const rows = document.querySelectorAll('.diff-table tr');
  let count = 0;

  rows.forEach(row => {
    const content = row.textContent.toLowerCase();
    if (query && content.includes(query)) {
      row.style.background = 'rgba(255, 213, 0, 0.2)';
      count++;
    } else {
      row.style.background = '';
    }
  });

  document.getElementById('search-count').textContent = query ? `${count} matches` : '';
});

// Copy raw diff
document.getElementById('btn-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(rawDiff).then(() => {
    const btn = document.getElementById('btn-copy');
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = '📋 Copy Raw', 2000);
  });
});

// Refresh
document.getElementById('btn-refresh').addEventListener('click', loadDiff);

// Load on start
loadDiff();
