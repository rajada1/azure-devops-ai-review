/**
 * Azure DevOps API Service
 * Handles communication with Azure DevOps REST API to fetch PR data and diffs
 */

export class AzureDevOpsAuthError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.name = 'AzureDevOpsAuthError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class AzureDevOpsAPI {
  constructor() {
    this.baseUrl = null;
    this.token = null;
    this.organization = null;
    this.project = null;
    this.repository = null;
    this.repositoryId = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the API service
   * @param {Object} params
   * @param {string} params.token - Azure DevOps Personal Access Token
   * @param {string} params.organization - Organization name
   * @param {string} params.project - Project name
   * @param {string} params.repository - Repository name
   * @param {string} [params.hostname] - Hostname for visualstudio.com domains
   */
  init({ token, organization, project, repository, hostname = null }) {
    if (!token) {
      throw new Error('Azure DevOps token is required');
    }

    this.token = token;
    this.organization = organization;
    this.project = project;
    this.repository = repository;

    // Determine base URL
    if (hostname && hostname.includes('visualstudio.com')) {
      this.baseUrl = `https://${hostname}`;
    } else {
      this.baseUrl = `https://dev.azure.com/${organization}`;
    }

    this.repositoryId = repository;
    this.isInitialized = true;
  }

  /**
   * Make authenticated request to Azure DevOps API
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>}
   */
  async makeRequest(endpoint, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Azure DevOps API not initialized');
    }

    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}/${this.project}/_apis/${endpoint}${separator}api-version=7.1`;

    const defaultOptions = {
      headers: {
        'Authorization': `Basic ${btoa(':' + this.token)}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    const requestOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers
      }
    };

    const response = await fetch(url, requestOptions);

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError = null;
      try {
        parsedError = JSON.parse(errorText);
      } catch {
        // Ignore parse errors
      }

      if (response.status === 401) {
        throw new AzureDevOpsAuthError(
          'Azure DevOps PAT is invalid, expired, or not set',
          401,
          { rawMessage: parsedError?.message || errorText }
        );
      }

      if (response.status === 403) {
        throw new AzureDevOpsAuthError(
          'Access denied. Ensure your PAT has the required permissions.',
          403,
          { rawMessage: parsedError?.message || errorText }
        );
      }

      throw new Error(`Azure DevOps API error: ${response.status} - ${errorText}`);
    }

    return response;
  }

  /**
   * Get pull request details
   * @param {string|number} pullRequestId
   * @returns {Promise<Object>}
   */
  async getPullRequest(pullRequestId) {
    const endpoint = `git/repositories/${this.repositoryId}/pullRequests/${pullRequestId}`;
    const response = await this.makeRequest(endpoint);
    return response.json();
  }

  /**
   * Get pull request iterations
   * @param {string|number} pullRequestId
   * @returns {Promise<Array>}
   */
  async getPullRequestIterations(pullRequestId) {
    const endpoint = `git/repositories/${this.repositoryId}/pullRequests/${pullRequestId}/iterations`;
    const response = await this.makeRequest(endpoint);
    const data = await response.json();
    return data.value || [];
  }

  /**
   * Get changes for a specific iteration
   * @param {string|number} pullRequestId
   * @param {number} iterationId
   * @returns {Promise<Object>}
   */
  async getIterationChanges(pullRequestId, iterationId) {
    const endpoint = `git/repositories/${this.repositoryId}/pullRequests/${pullRequestId}/iterations/${iterationId}/changes`;
    const response = await this.makeRequest(endpoint);
    return response.json();
  }

  /**
   * Get file content at a specific version
   * @param {string} path - File path
   * @param {string} version - Commit/version
   * @returns {Promise<string>}
   */
  async getFileContent(path, version) {
    const params = new URLSearchParams({
      path,
      version,
      includeContent: 'true'
    });
    
    const endpoint = `git/repositories/${this.repositoryId}/items?${params}`;
    const response = await this.makeRequest(endpoint);
    const data = await response.json();
    return data.content || '';
  }

  /**
   * Get diff between two commits
   * @param {string} baseCommit
   * @param {string} targetCommit
   * @returns {Promise<Object>}
   */
  async getDiff(baseCommit, targetCommit) {
    const params = new URLSearchParams({
      baseVersion: baseCommit,
      targetVersion: targetCommit,
      diffCommonCommit: 'true',
      includeFileDiff: 'true'
    });

    const endpoint = `git/repositories/${this.repositoryId}/diffs/commits?${params}`;
    const response = await this.makeRequest(endpoint);
    return response.json();
  }

  /**
   * Get the full diff for a pull request
   * @param {string|number} pullRequestId
   * @returns {Promise<string>} Git diff format
   */
  async getPullRequestDiff(pullRequestId) {
    // Get PR details to find branches
    const pr = await this.getPullRequest(pullRequestId);
    
    const sourceBranch = pr.sourceRefName?.replace('refs/heads/', '');
    const targetBranch = pr.targetRefName?.replace('refs/heads/', '');
    
    if (!sourceBranch || !targetBranch) {
      throw new Error('Could not determine source or target branch');
    }

    // Get iterations for accurate diff
    const iterations = await this.getPullRequestIterations(pullRequestId);
    
    if (iterations.length === 0) {
      throw new Error('No iterations found for pull request');
    }

    const latestIteration = iterations[iterations.length - 1];
    const changes = await this.getIterationChanges(pullRequestId, latestIteration.id);

    // Build unified diff from changes
    return this._buildUnifiedDiff(changes, pr);
  }

  /**
   * Build unified diff from change entries
   * @private
   */
  async _buildUnifiedDiff(changes, pr) {
    const changeEntries = changes.changeEntries || [];
    let unifiedDiff = '';

    for (const entry of changeEntries) {
      const path = entry.item?.path || entry.originalPath;
      if (!path) continue;

      const changeType = entry.changeType;
      
      try {
        if (changeType === 'add' || changeType === 1) {
          // New file
          const content = await this.getFileContent(path, pr.sourceRefName);
          unifiedDiff += this._formatNewFile(path, content);
        } else if (changeType === 'delete' || changeType === 4) {
          // Deleted file
          const content = await this.getFileContent(path, pr.targetRefName);
          unifiedDiff += this._formatDeletedFile(path, content);
        } else if (changeType === 'edit' || changeType === 2) {
          // Modified file - get both versions
          const [oldContent, newContent] = await Promise.all([
            this.getFileContent(path, pr.targetRefName).catch(() => ''),
            this.getFileContent(path, pr.sourceRefName).catch(() => '')
          ]);
          unifiedDiff += this._formatModifiedFile(path, oldContent, newContent);
        }
      } catch (error) {
        // Skip files that can't be fetched
        console.warn(`Could not fetch diff for ${path}:`, error.message);
      }
    }

    return unifiedDiff;
  }

  _formatNewFile(path, content) {
    const lines = content.split('\n');
    let diff = `diff --git a/${path} b/${path}\n`;
    diff += `new file mode 100644\n`;
    diff += `--- /dev/null\n`;
    diff += `+++ b/${path}\n`;
    diff += `@@ -0,0 +1,${lines.length} @@\n`;
    diff += lines.map(l => `+${l}`).join('\n') + '\n';
    return diff;
  }

  _formatDeletedFile(path, content) {
    const lines = content.split('\n');
    let diff = `diff --git a/${path} b/${path}\n`;
    diff += `deleted file mode 100644\n`;
    diff += `--- a/${path}\n`;
    diff += `+++ /dev/null\n`;
    diff += `@@ -1,${lines.length} +0,0 @@\n`;
    diff += lines.map(l => `-${l}`).join('\n') + '\n';
    return diff;
  }

  _formatModifiedFile(path, oldContent, newContent) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    let diff = `diff --git a/${path} b/${path}\n`;
    diff += `--- a/${path}\n`;
    diff += `+++ b/${path}\n`;
    
    // Simple line-by-line diff (basic implementation)
    // For production, consider using a proper diff algorithm
    diff += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;
    
    // Use a simple approach: show removed and added lines
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    
    for (const line of oldLines) {
      if (!newSet.has(line)) {
        diff += `-${line}\n`;
      }
    }
    
    for (const line of newLines) {
      if (!oldSet.has(line)) {
        diff += `+${line}\n`;
      } else {
        diff += ` ${line}\n`;
      }
    }
    
    return diff;
  }
}

/**
 * Extract PR info from current URL
 * @returns {Object|null}
 */
export function extractPRInfoFromUrl() {
  const url = window.location.href;
  const hostname = window.location.hostname;
  
  // Pattern: https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}
  // Or: https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}
  
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
