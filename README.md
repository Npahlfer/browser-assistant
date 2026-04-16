# Browser Assistant

A Chrome side panel extension that lets you chat with AI about any web page - using a local model or a cloud API. Summarize pages, ask questions, search the web, and export conversations, all without leaving your browser.

## Features

- **Summarize any page**: one click to get a concise summary of the current tab
- **Ask questions**: have a multi-turn conversation grounded in the page content
- **Web search**: augment your questions with live search results (DuckDuckGo or Brave)
- **Screenshot support**: send a visual snapshot of the page to vision-capable models
- **Attach local files**: include a file from your computer alongside the page context
- **Markdown rendering**: responses render with headers, lists, code blocks, bold/italic, and links
- **Export conversations**: download the chat or an AI-generated summary as `.md` or `.txt`
- **Custom system prompt**: fully editable with dynamic page and date/time variables
- **Configurable timeout**: set how long to wait before a slow model is considered unresponsive
- **No telemetry or analytics**: the extension does not include tracking or analytics code

## Supported Providers

| Provider | Type | Requires API Key |
|---|---|---|
| [Ollama](https://ollama.com) | Local | No |
| [LM Studio](https://lmstudio.ai) | Local | No |
| [llama.cpp](https://github.com/ggerganov/llama.cpp) | Local | No |
| [OpenAI](https://platform.openai.com) | Cloud | Yes |
| [Anthropic Claude](https://www.anthropic.com) | Cloud | Yes |

Local providers run entirely on your machine - no data is sent to any external server.

## Installation

### From the Chrome Web Store

[Chrome extension here](https://chromewebstore.google.com/detail/browser-assistant/mcfhffimihllopbdjhkclkdebkakoepb)

### Manual installation (developer mode)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the project folder
5. The extension icon will appear in your toolbar - click it to open the side panel

## Getting Started

### Local model (Ollama example)

1. [Install Ollama](https://ollama.com) and pull a model, e.g. `ollama pull llama3`
2. Make sure Ollama is running (`ollama serve`)
3. Open the extension side panel, go to Settings (⚙)
4. Select **Ollama** as the provider, the endpoint fills in automatically
5. Click the refresh button next to Model and select your model
6. Navigate to any page and click **Summarize** or **Ask about Page**

### Cloud model (OpenAI example)

1. Go to Settings (⚙) and select **OpenAI** as the provider
2. Paste your API key
3. Refresh and select a model (e.g. `gpt-4o`)
4. You're ready to go

## Usage

### Main actions

| Button | What it does |
|---|---|
| **Summarize** | Extracts the page and asks the model for a concise summary |
| **Ask about Page** | Opens the input to start a conversation about the current page |
| **Send** (arrow) | Send your typed message |
| **Search & Send** (magnifier) | Generates an optimized search query, fetches results, and includes them in the message |
| **Screenshot & Send** (camera) | Captures the visible page and sends it with your message (vision models only) |
| **Attach** (paperclip) | Attach a local text file to include in the conversation |

### Keyboard shortcut

Press `Enter` to send a message. Use `Shift+Enter` for a new line.

### Exporting

- Click the **download icon** in the top bar to export the full conversation as `.md` or `.txt`
- Click the **sparkle/star icon** to generate an AI-written summary of the conversation and download it

## Settings

Open settings by clicking the **⚙ gear icon** in the top bar.

### Model

| Setting | Description |
|---|---|
| Provider | The LLM backend to use |
| Endpoint URL | API base URL (auto-filled for known providers, locked for cloud) |
| API Key | Required for OpenAI and Anthropic |
| Model | Select from the models available on your provider |
| Include screenshot | Attach a page screenshot to every message (requires a vision model) |
| Response timeout | Seconds to wait without a token before showing a timeout error (default: 120s) |

### Web Search

| Setting | Description |
|---|---|
| Search Provider | **DuckDuckGo** (free, no key needed) or **Brave Search** (faster, requires API key) |
| Brave API Key | Your [Brave Search API](https://api.search.brave.com) key, if using Brave |

### System Prompt

Fully customizable. The following variables are replaced at runtime:

| Variable | Replaced with |
|---|---|
| `{title}` | Page title |
| `{url}` | Page URL |
| `{description}` | Meta description (if present) |
| `{content}` | Extracted page text |
| `{currentDate}` | Today's date (`YYYY-MM-DD`) |
| `{currentYear}` | Current year |
| `{currentMonth}` | Current month name (e.g. `February`) |
| `{currentDay}` | Current weekday name (e.g. `Tuesday`) |
| `{currentHour}` | Current hour, 24h padded (`00`–`23`) |
| `{currentMinute}` | Current minute, padded (`00`–`59`) |

## Supported file formats (attachment)

`.txt`, `.md`, `.json`, `.csv`, `.js`, `.ts`, `.py`, `.html`, `.css`, `.xml`, `.yaml`, `.yml`, `.sh`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.h`

## Privacy

- **Local providers**: page content, prompts, screenshots, and responses stay on your machine and are sent only to the local model server you configure
- **Cloud providers**: page content, prompts, screenshots, and responses are sent directly to the provider's API (for example OpenAI or Anthropic), subject to that provider's privacy policy
- **Web search**: search queries are sent directly to DuckDuckGo or Brave Search when you use the search feature
- **Local storage**: the extension stores settings, selected models, API keys, attached file content, and page conversation history in `chrome.storage.local` on your device
- The extension does not include analytics, advertising, or third-party tracking scripts
- See [PRIVACY.md](./PRIVACY.md) for a publishable privacy policy

## Roadmap

- Voice input/output
- Firefox, Edge, Brave, and Zen Browser support
- Chrome built-in AI support

## License

MIT
