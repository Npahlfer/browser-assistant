## Privacy Policy

Browser Assistant processes data locally in your browser and, depending on your configuration, may send data directly to the AI or search providers you choose.

### Data the extension can access

The extension can access:

- The URL, title, and extracted text content of the active web page
- A screenshot of the visible tab if you enable screenshot sending
- The text you type into the extension
- The contents of a file you explicitly attach
- Your extension settings, including selected providers, endpoints, models, and saved API keys

### How data is used

The extension uses this data to:

- Summarize the current page
- Answer questions about the current page
- Generate and send web search queries when you use the search feature
- Persist page-specific conversation history and extension settings locally

The extension requests page access so it can read the currently active page when you use summarize or page chat features. It is not intended to collect browsing data passively in the background.

### Where data goes

- Local model providers: data is sent only to the local endpoint you configure, such as Ollama, LM Studio, or llama.cpp
- Cloud model providers: data is sent directly to the provider you configure, such as OpenAI or Anthropic
- Search providers: search queries are sent directly to DuckDuckGo or Brave Search when that feature is used

The extension does not send data to the extension developer's own servers.

### Local storage

The extension stores data in `chrome.storage.local` on your device, including:

- Provider and model settings
- API keys entered by the user
- Search provider settings and Brave API key
- Page conversation history

This storage is local to your browser profile. It is not encrypted by the extension.

### Data sharing

The extension does not sell data and does not use analytics, advertising, or third-party tracking code.

### User control

You control when the extension is used. Data is processed only when you open the side panel and use features such as summarize, ask, screenshot send, file attachment, or search.

You can remove locally stored data by clearing the extension's local storage from Chrome's extension settings or by uninstalling the extension.

### Contact

Support: https://github.com/Npahlfer/browser-assistant/issues
