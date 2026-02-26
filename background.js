// Background service worker: screenshot capture, LLM streaming, message relay

// Open side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Strip Origin header on localhost requests so Ollama/LM Studio don't reject them
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1, 2],
  addRules: [
    {
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Origin', operation: 'remove' }]
      },
      condition: {
        urlFilter: '||localhost',
        resourceTypes: ['xmlhttprequest']
      }
    },
    {
      id: 2,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Origin', operation: 'remove' }]
      },
      condition: {
        urlFilter: '||127.0.0.1',
        resourceTypes: ['xmlhttprequest']
      }
    }
  ]
});

// --- Settings ---

async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return result.settings || {};
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_SETTINGS':
      getSettings().then(settings => sendResponse({ settings }));
      return true;

    case 'SAVE_SETTINGS':
      saveSettings(message.settings).then(() => sendResponse({ success: true }));
      return true;

    case 'FETCH_MODELS':
      fetchModels(message.provider, message.endpoint, message.apiKey)
        .then(models => sendResponse({ models }))
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case 'CAPTURE_SCREENSHOT':
      captureScreenshot()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'EXTRACT_PAGE_TEXT':
      extractPageText(message.tabId)
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
  }
});

// --- Screenshot ---

async function captureScreenshot() {
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return { success: true, dataUrl, base64 };
}

// --- Page Text Extraction ---

function isRestrictedPageError(e) {
  const msg = e?.message || '';
  return msg.includes('cannot be scripted') ||
         msg.includes('Cannot access') ||
         msg.includes('chrome-extension://') ||
         msg.includes('extensions gallery');
}

async function extractPageText(tabId) {
  try {
    try {
      // Try sending message to content script
      const response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_TEXT' });
      if (response && response.success) return response.data;
      throw new Error(response?.error || 'Content script did not respond');
    } catch (e) {
      if (isRestrictedPageError(e)) throw e;
      // Fallback: inject content script programmatically
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      // Small delay to let script initialize
      await new Promise(r => setTimeout(r, 100));
      // Retry after injection
      const response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_TEXT' });
      if (response && response.success) return response.data;
      throw new Error(response?.error || 'Failed to extract page content');
    }
  } catch (e) {
    if (isRestrictedPageError(e)) {
      throw new Error('This page is restricted and cannot be read.');
    }
    throw e;
  }
}

// --- Model Fetching ---

const CLAUDE_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-20250514'
];

async function fetchModels(provider, endpoint, apiKey) {
  switch (provider) {
    case 'ollama': {
      const resp = await fetch(`${endpoint}/api/tags`);
      if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
      const data = await resp.json();
      return (data.models || []).map(m => m.name);
    }
    case 'lmstudio': {
      const resp = await fetch(`${endpoint}/v1/models`);
      if (!resp.ok) throw new Error(`LM Studio error: ${resp.status}`);
      const data = await resp.json();
      return (data.data || []).map(m => m.id);
    }
    case 'openai': {
      const resp = await fetch(`${endpoint}/v1/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!resp.ok) {
        if (resp.status === 401) throw new Error('Invalid API key. Check your OpenAI API key in settings.');
        throw new Error(`OpenAI error: ${resp.status}`);
      }
      const data = await resp.json();
      return (data.data || [])
        .map(m => m.id)
        .filter(id => id.startsWith('gpt-') || id.startsWith('o') || id.startsWith('chatgpt-'))
        .sort();
    }
    case 'claude':
      return CLAUDE_MODELS;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// --- LLM Streaming via Port ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'llm-stream') return;

  let disconnected = false;
  port.onDisconnect.addListener(() => { disconnected = true; });

  port.onMessage.addListener((msg) => {
    if (msg.type !== 'CHAT_REQUEST') return;

    const { provider, endpoint, apiKey, model, messages } = msg;

    const run = async () => {
      switch (provider) {
        case 'ollama':
          await streamOllama(port, endpoint, model, messages);
          break;
        case 'lmstudio':
          await streamOpenAICompat(port, endpoint, null, model, messages);
          break;
        case 'openai':
          await streamOpenAICompat(port, endpoint, apiKey, model, messages);
          break;
        case 'claude':
          await streamClaude(port, endpoint, apiKey, model, messages);
          break;
        default:
          port.postMessage({ type: 'ERROR', error: `Unknown provider: ${provider}` });
      }
    };

    run().catch((err) => {
      if (!disconnected) {
        try {
          port.postMessage({ type: 'ERROR', error: err.message || 'Stream failed' });
        } catch (_) {}
      }
    });
  });
});

// --- Ollama Streaming (NDJSON) ---

async function streamOllama(port, endpoint, model, messages) {
  const ollamaMessages = messages.map(m => {
    const msg = { role: m.role, content: m.content };
    if (m.image) {
      msg.images = [m.image];
    }
    return msg;
  });

  const resp = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: ollamaMessages, stream: true })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Ollama error ${resp.status}: ${text || 'Server unreachable'}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processLine = (line) => {
    line = line.replace(/\r$/, '').trim();
    if (!line) return false;
    let data;
    try {
      data = JSON.parse(line);
    } catch (e) {
      return false; // Skip malformed JSON
    }
    if (data.error) {
      throw new Error(data.error);
    }
    if (data.message?.content) {
      port.postMessage({ type: 'TOKEN', token: data.message.content });
    }
    return !!data.done;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (processLine(line)) {
        port.postMessage({ type: 'DONE' });
        return;
      }
    }
  }

  // Process any remaining data in the buffer
  if (buffer.trim()) {
    processLine(buffer);
  }

  port.postMessage({ type: 'DONE' });
}

// --- OpenAI-compatible Streaming (SSE) — LM Studio & OpenAI ---

async function streamOpenAICompat(port, endpoint, apiKey, model, messages) {
  const openaiMessages = messages.map(m => {
    if (m.image) {
      return {
        role: m.role,
        content: [
          { type: 'text', text: m.content },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${m.image}` } }
        ]
      };
    }
    return { role: m.role, content: m.content };
  });

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const resp = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages: openaiMessages, stream: true })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 401) throw new Error('Invalid API key. Check your API key in settings.');
    throw new Error(`API error ${resp.status}: ${text || 'Request failed'}`);
  }

  await parseSSE(resp, port, (data) => {
    const content = data.choices?.[0]?.delta?.content;
    if (content) {
      port.postMessage({ type: 'TOKEN', token: content });
    }
    if (data.choices?.[0]?.finish_reason) {
      return true; // Signal done
    }
    return false;
  });

  port.postMessage({ type: 'DONE' });
}

// --- Claude Streaming (SSE) ---

async function streamClaude(port, endpoint, apiKey, model, messages) {
  // Separate system message from conversation
  let systemContent = '';
  const claudeMessages = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemContent += (systemContent ? '\n' : '') + m.content;
      continue;
    }

    if (m.image) {
      claudeMessages.push({
        role: m.role,
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: m.image }
          },
          { type: 'text', text: m.content }
        ]
      });
    } else {
      claudeMessages.push({ role: m.role, content: m.content });
    }
  }

  const body = {
    model,
    max_tokens: 4096,
    stream: true,
    messages: claudeMessages
  };
  if (systemContent) {
    body.system = systemContent;
  }

  const resp = await fetch(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 401) throw new Error('Invalid API key. Check your Claude API key in settings.');
    throw new Error(`Claude error ${resp.status}: ${text || 'Request failed'}`);
  }

  await parseSSE(resp, port, (data) => {
    if (data.type === 'content_block_delta' && data.delta?.text) {
      port.postMessage({ type: 'TOKEN', token: data.delta.text });
    }
    if (data.type === 'message_stop') {
      return true;
    }
    return false;
  });

  port.postMessage({ type: 'DONE' });
}

// --- SSE Parser ---

async function parseSSE(resp, port, onData) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') return;
        let data;
        try {
          data = JSON.parse(dataStr);
        } catch (e) {
          continue; // Skip malformed JSON
        }
        const isDone = onData(data);
        if (isDone) return;
      }
    }
  }
}
