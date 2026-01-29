# Azure DevOps AI Code Review

🤖 AI-powered code reviews for Azure DevOps Pull Requests.

Connect your preferred AI model (OpenAI, Anthropic, Ollama, etc.) and get instant, intelligent code reviews directly in your PRs.

## ✨ Features

- **Multi-Provider Support**: Connect OpenAI, Anthropic Claude, Google Gemini, or any OpenAI-compatible API
- **Instant Reviews**: Get AI-driven insights on code changes
- **Security Detection**: Automatically identify potential vulnerabilities
- **Code Quality**: Receive suggestions for improvements
- **Smart Summaries**: Quickly understand complex changes
- **Privacy-First**: Your code is sent only to your chosen AI provider
- **No Backend Required**: Direct API calls from the extension

## 🚀 Quick Start

1. Install the extension
2. Click the extension icon and go to Settings
3. Add your preferred AI provider (API key required for cloud providers)
4. Navigate to any Azure DevOps Pull Request
5. Click "AI Review" to get instant feedback

## 🔧 Supported AI Providers

| Provider | Models | Setup |
|----------|--------|-------|
| **GitHub Copilot** | GPT-4o, Claude 3.5, o1 | GitHub Token (requires Copilot subscription) |
| OpenAI | GPT-4o, GPT-4 Turbo, GPT-3.5 | API Key |
| Anthropic | Claude Sonnet 4, Claude 3.5, Claude 3 Opus | API Key |
| Google | Gemini 2.0 Flash, Gemini 1.5 Pro | API Key |
| OpenAI-Compatible | Any compatible API (Azure OpenAI, etc.) | Custom endpoint + API Key |

## 🏗️ Architecture

```
azure-devops-ai-review/
├── manifest.json           # Extension configuration
├── background.js           # Service worker
├── popup/                  # Extension popup UI
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── content/                # Content scripts for Azure DevOps
│   ├── content.js
│   ├── content.css
│   └── ui/                 # UI components
├── providers/              # AI provider implementations
│   ├── base-provider.js    # Abstract base class
│   ├── openai.js
│   ├── anthropic.js
│   ├── gemini.js
│   ├── ollama.js
│   └── provider-factory.js # Provider factory
├── services/               # Core services
│   ├── azure-devops-api.js # Azure DevOps API client
│   ├── config.js           # Configuration management
│   └── review-service.js   # Review orchestration
└── icons/                  # Extension icons
```

## 🔐 Privacy & Security

- **No Data Collection**: We don't collect or store your code
- **Direct API Calls**: Code is sent directly to your chosen AI provider
- **Local Storage**: Settings stored locally in your browser
- **Open Source**: Full transparency in how the extension works

## 📦 Installation (Developer Mode)

```bash
# Clone the repository
git clone https://github.com/your-username/azure-devops-ai-review.git
cd azure-devops-ai-review

# Load in Chrome
# 1. Open Chrome and navigate to chrome://extensions/
# 2. Enable "Developer mode" (toggle in top right)
# 3. Click "Load unpacked"
# 4. Select the cloned directory
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.
