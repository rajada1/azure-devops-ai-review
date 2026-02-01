# Azure DevOps AI Code Review

🤖 AI-powered code reviews for Azure DevOps Pull Requests.

Connect your GitHub Copilot subscription or preferred AI provider and get instant, intelligent code reviews directly in your PRs.

## ✨ Features

- **GitHub Copilot Integration**: Use your existing Copilot subscription with GPT-4o, Claude, Gemini and more
- **Multi-Provider Support**: Also supports OpenAI, Anthropic Claude, Google Gemini, Azure OpenAI
- **Instant Reviews**: Get AI-driven insights on code changes
- **Security Detection**: Automatically identify potential vulnerabilities
- **Code Quality**: Receive suggestions for improvements
- **Smart Summaries**: Quickly understand complex changes
- **Privacy-First**: Your code is sent only to your chosen AI provider
- **No Backend Required**: Direct API calls from the extension

## 🚀 Quick Start

1. Install the extension
2. Click the extension icon and go to **Settings**
3. Click **"Sign in with GitHub"** to connect your Copilot subscription
4. Navigate to any Azure DevOps Pull Request
5. Click **"AI Review"** to get instant feedback

## 🔧 Supported AI Providers

| Provider | Models | Setup |
|----------|--------|-------|
| **GitHub Copilot** ⭐ | GPT-4o, Claude Sonnet 4, Gemini 2.0, o3-mini | OAuth Sign-in (requires Copilot subscription) |
| Azure OpenAI | GPT-4o, GPT-4 Turbo, Custom deployments | API Key + Endpoint |
| OpenAI | GPT-4o, GPT-4 Turbo, GPT-3.5 | API Key |
| Anthropic | Claude Sonnet 4, Claude 3.5, Claude 3 Opus | API Key |
| Google | Gemini 2.0 Flash, Gemini 1.5 Pro | API Key |
| OpenAI-Compatible | Any compatible API | Custom endpoint + API Key |

### GitHub Copilot Setup

The easiest way to get started! If you have a GitHub Copilot subscription:

1. Go to **Settings** tab in the extension
2. Click **"Sign in with GitHub"**
3. Authorize the app on GitHub.com
4. Done! You now have access to all Copilot models

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
│   └── content.css
├── providers/              # AI provider implementations
│   ├── base-provider.js    # Abstract base class
│   ├── github-copilot.js   # GitHub Copilot (OAuth)
│   ├── openai.js
│   ├── anthropic.js
│   ├── gemini.js
│   ├── azure-openai.js
│   ├── openai-compatible.js
│   └── provider-factory.js
├── services/               # Core services
│   ├── copilot-auth.js     # Copilot OAuth authentication
│   ├── config.js           # Configuration management
│   └── ...
└── icons/                  # Extension icons
```

## 🔐 Privacy & Security

- **No Data Collection**: We don't collect or store your code
- **Direct API Calls**: Code is sent directly to your chosen AI provider
- **OAuth Authentication**: Secure GitHub OAuth flow for Copilot
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
