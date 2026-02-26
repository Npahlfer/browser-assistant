// Side panel UI logic, state, conversation history, streaming display

const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant analyzing a web page. Here is the page context:

Title: {title}
URL: {url}
{description}
Page Content:
{content}

Use this context to answer the user's questions accurately. If the answer is not in the page content, say so.`;

const DEFAULT_ENDPOINTS = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
  openai: 'https://api.openai.com',
  claude: 'https://api.anthropic.com'
};

const CLOUD_PROVIDERS = ['openai', 'claude'];

// State
let conversationHistory = [];
let systemMessage = '';
let currentMode = null; // 'summarize' | 'ask'
let isStreaming = false;
let currentPort = null;
let cachedScreenshot = null; // { base64, tabId, url }
let apiKeys = {}; // { openai: "sk-...", claude: "sk-..." }
let savedModels = {}; // { ollama: "llama3", openai: "gpt-4o", ... }

// DOM elements
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const providerSelect = document.getElementById('provider-select');
const endpointInput = document.getElementById('endpoint-input');
const apikeyInput = document.getElementById('apikey-input');
const apiKeyGroup = document.querySelector('.api-key-group');
const modelSelect = document.getElementById('model-select');
const refreshModelsBtn = document.getElementById('refresh-models-btn');
const screenshotToggle = document.getElementById('screenshot-toggle');
const systemPromptInput = document.getElementById('system-prompt-input');
const summarizeBtn = document.getElementById('summarize-btn');
const askBtn = document.getElementById('ask-btn');
const statusBanner = document.getElementById('status-banner');
const chatArea = document.getElementById('chat-area');
const inputArea = document.getElementById('input-area');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const screenshotSendBtn = document.getElementById('screenshot-send-btn');

// --- Settings ---

function toggleSettings() {
  settingsPanel.classList.toggle('hidden');
}

function updateProviderUI() {
  // Save current key and model before switching
  const prevProvider = apikeyInput.dataset.provider || providerSelect.dataset.prev;
  if (prevProvider) {
    if (apikeyInput.value.trim()) apiKeys[prevProvider] = apikeyInput.value.trim();
    if (modelSelect.value) savedModels[prevProvider] = modelSelect.value;
  }

  const provider = providerSelect.value;
  providerSelect.dataset.prev = provider;
  endpointInput.value = DEFAULT_ENDPOINTS[provider] || '';
  if (CLOUD_PROVIDERS.includes(provider)) {
    apiKeyGroup.classList.remove('hidden');
    apikeyInput.value = apiKeys[provider] || '';
    apikeyInput.dataset.provider = provider;
    endpointInput.disabled = true;
  } else {
    apiKeyGroup.classList.add('hidden');
    apikeyInput.value = '';
    apikeyInput.dataset.provider = '';
    endpointInput.disabled = false;
  }
  modelSelect.innerHTML = '<option value="">-- Select a model --</option>';
  // Restore models list and selection for this provider if we have them
  fetchModels().then(() => {
    if (savedModels[provider]) modelSelect.value = savedModels[provider];
  });
}

function getSettings() {
  const provider = providerSelect.value;
  // Keep apiKeys in sync with current input
  if (CLOUD_PROVIDERS.includes(provider) && apikeyInput.value.trim()) {
    apiKeys[provider] = apikeyInput.value.trim();
  }
  if (modelSelect.value) savedModels[provider] = modelSelect.value;
  return {
    provider,
    endpoint: endpointInput.value.replace(/\/+$/, ''),
    apiKey: apikeyInput.value.trim(),
    apiKeys: { ...apiKeys },
    model: modelSelect.value,
    savedModels: { ...savedModels },
    includeScreenshot: screenshotToggle.checked,
    systemPrompt: systemPromptInput.value
  };
}

async function loadSettings() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (resp && resp.settings) {
      const s = resp.settings;
      if (s.provider) providerSelect.value = s.provider;
      if (s.endpoint) endpointInput.value = s.endpoint;
      if (s.apiKeys) apiKeys = s.apiKeys;
      // Migrate old single apiKey to per-provider if needed
      if (s.apiKey && !s.apiKeys && s.provider) apiKeys[s.provider] = s.apiKey;
      if (s.savedModels) savedModels = s.savedModels;
      // Migrate old single model to per-provider if needed
      if (s.model && !s.savedModels && s.provider) savedModels[s.provider] = s.model;
      if (s.includeScreenshot) screenshotToggle.checked = s.includeScreenshot;
      systemPromptInput.value = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      // Update UI visibility and load correct key
      const provider = providerSelect.value;
      providerSelect.dataset.prev = provider;
      if (CLOUD_PROVIDERS.includes(provider)) {
        apiKeyGroup.classList.remove('hidden');
        apikeyInput.value = apiKeys[provider] || '';
        apikeyInput.dataset.provider = provider;
        endpointInput.disabled = true;
      } else {
        apiKeyGroup.classList.add('hidden');
        endpointInput.disabled = false;
      }
      // Restore model list and selection
      await fetchModels();
      if (savedModels[provider]) modelSelect.value = savedModels[provider];
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function saveSettings() {
  const settings = getSettings();
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
}

async function fetchModels() {
  const settings = getSettings();
  if (!settings.endpoint && !CLOUD_PROVIDERS.includes(settings.provider)) {
    showBanner('Please set an endpoint URL first.', 'warning');
    return;
  }
  try {
    refreshModelsBtn.disabled = true;
    const resp = await chrome.runtime.sendMessage({
      type: 'FETCH_MODELS',
      provider: settings.provider,
      endpoint: settings.endpoint,
      apiKey: settings.apiKey
    });
    if (resp.error) {
      showBanner(resp.error, 'error');
      return;
    }
    modelSelect.innerHTML = '<option value="">-- Select a model --</option>';
    for (const model of resp.models || []) {
      const opt = document.createElement('option');
      opt.value = model;
      opt.textContent = model;
      modelSelect.appendChild(opt);
    }
    hideBanner();
  } catch (e) {
    showBanner('Failed to fetch models. Is the server running?', 'error');
  } finally {
    refreshModelsBtn.disabled = false;
  }
}

// --- Banner ---

function showBanner(message, type = 'error') {
  statusBanner.textContent = message;
  statusBanner.className = `status-banner ${type}`;
}

function hideBanner() {
  statusBanner.className = 'status-banner hidden';
}

// --- Chat ---

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = text;
  chatArea.appendChild(div);
  chatArea.scrollTop = chatArea.scrollHeight;
  return div;
}

function createStreamingMessage() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  const textSpan = document.createElement('span');
  textSpan.className = 'text-content';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  div.appendChild(textSpan);
  div.appendChild(cursor);
  chatArea.appendChild(div);
  chatArea.scrollTop = chatArea.scrollHeight;
  return { container: div, textSpan };
}

function clearChat(resetContext = true) {
  chatArea.innerHTML = '';
  conversationHistory = [];
  if (resetContext) {
    systemMessage = '';
    cachedScreenshot = null;
  }
}

function setMode(mode) {
  currentMode = mode;
  if (mode === 'ask') {
    inputArea.classList.remove('hidden');
    userInput.focus();
  } else {
    inputArea.classList.add('hidden');
  }
}

function setStreaming(streaming) {
  isStreaming = streaming;
  summarizeBtn.disabled = streaming;
  askBtn.disabled = streaming;
  sendBtn.disabled = streaming;
  screenshotSendBtn.disabled = streaming;
}

function updateScreenshotButtonVisibility() {
  screenshotSendBtn.classList.toggle('hidden', !screenshotToggle.checked);
}

// --- Page Data ---

async function getPageData() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found');

    // Check for restricted pages
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('about:') || tab.url.startsWith('edge://'))) {
      throw new Error('This page is restricted and cannot be read.');
    }

    const resp = await chrome.runtime.sendMessage({
      type: 'EXTRACT_PAGE_TEXT',
      tabId: tab.id
    });

    if (!resp || !resp.success) {
      throw new Error(resp?.error || 'Failed to extract page content');
    }
    return resp.data;
  } catch (e) {
    throw new Error(e.message || 'Failed to get page data');
  }
}

async function captureScreenshot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resp = await chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' });
    if (!resp || !resp.success) return null;
    cachedScreenshot = { base64: resp.base64, tabId: tab?.id, url: tab?.url };
    return cachedScreenshot.base64;
  } catch (e) {
    console.error('Screenshot failed:', e);
    return null;
  }
}

async function getScreenshotBase64(forceNew = false) {
  if (!screenshotToggle.checked) return null;
  if (forceNew || !cachedScreenshot) return await captureScreenshot();
  // Check if tab or URL changed
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && (tab.id !== cachedScreenshot.tabId || tab.url !== cachedScreenshot.url)) {
      return await captureScreenshot();
    }
  } catch (e) {}
  return cachedScreenshot.base64;
}

// --- LLM Streaming ---

function buildSystemMessage(pageData) {
  const template = systemPromptInput.value.trim() || DEFAULT_SYSTEM_PROMPT;
  return template
    .replace(/\{title\}/g, pageData.title)
    .replace(/\{url\}/g, pageData.url)
    .replace(/\{description\}/g, pageData.metaDescription || '')
    .replace(/\{content\}/g, pageData.content);
}

async function streamChat(userMessage, screenshotBase64 = null) {
  const settings = getSettings();

  if (!settings.model) {
    showBanner('Please select a model in settings.', 'warning');
    return;
  }

  setStreaming(true);
  hideBanner();

  // Build messages array
  const messages = [
    { role: 'system', content: systemMessage },
    ...conversationHistory
  ];

  if (screenshotBase64) {
    // Add user message with image
    messages.push({
      role: 'user',
      content: userMessage,
      image: screenshotBase64
    });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  conversationHistory.push({ role: 'user', content: userMessage });

  const { container, textSpan } = createStreamingMessage();
  let fullResponse = '';

  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: 'llm-stream' });
    currentPort = port;

    port.onMessage.addListener((msg) => {
      if (msg.type === 'TOKEN') {
        fullResponse += msg.token;
        textSpan.textContent = fullResponse;
        chatArea.scrollTop = chatArea.scrollHeight;
      } else if (msg.type === 'DONE') {
        // Remove cursor
        const cursor = container.querySelector('.cursor');
        if (cursor) cursor.remove();
        conversationHistory.push({ role: 'assistant', content: fullResponse });
        setStreaming(false);
        currentPort = null;
        resolve();
      } else if (msg.type === 'ERROR') {
        const cursor = container.querySelector('.cursor');
        if (cursor) cursor.remove();
        if (!fullResponse) {
          textSpan.textContent = msg.error;
          container.classList.add('error-msg');
        }
        showBanner(msg.error, 'error');
        setStreaming(false);
        currentPort = null;
        resolve();
      }
    });

    port.onDisconnect.addListener(() => {
      if (isStreaming) {
        const cursor = container.querySelector('.cursor');
        if (cursor) cursor.remove();
        setStreaming(false);
        currentPort = null;
        resolve();
      }
    });

    port.postMessage({
      type: 'CHAT_REQUEST',
      provider: settings.provider,
      endpoint: settings.endpoint,
      apiKey: settings.apiKey,
      model: settings.model,
      messages
    });
  });
}

// --- Actions ---

async function handleSummarize() {
  clearChat();
  setMode('summarize');

  const loadingMsg = addMessage('assistant', 'Extracting page content...');

  try {
    const pageData = await getPageData();
    systemMessage = buildSystemMessage(pageData);

    loadingMsg.remove();
    addMessage('user', 'Summarize this page');

    // Capture fresh screenshot at conversation start
    const screenshotBase64 = await getScreenshotBase64(true);

    await streamChat(
      'Please provide a concise summary of this web page. Highlight the key points and main topics covered.',
      screenshotBase64
    );

    // After summary, switch to ask mode for follow-ups
    setMode('ask');
  } catch (e) {
    loadingMsg.remove();
    showBanner(e.message, 'error');
  }
}

async function handleAsk() {
  // If no context yet, extract it
  if (!systemMessage) {
    const loadingMsg = addMessage('assistant', 'Extracting page content...');
    try {
      const pageData = await getPageData();
      systemMessage = buildSystemMessage(pageData);
      loadingMsg.remove();
    } catch (e) {
      loadingMsg.remove();
      showBanner(e.message, 'error');
      return;
    }
  }
  // Capture fresh screenshot at conversation start
  await getScreenshotBase64(true);
  clearChat(false);
  setMode('ask');
}

async function handleSend(forceNewScreenshot = false) {
  const text = userInput.value.trim();
  if (!text || isStreaming) return;

  userInput.value = '';
  userInput.style.height = 'auto';
  addMessage('user', text);

  // Reuse cached screenshot unless tab/URL changed or forced
  const screenshotBase64 = await getScreenshotBase64(forceNewScreenshot);

  await streamChat(text, screenshotBase64);
}

// --- Event Listeners ---

settingsBtn.addEventListener('click', toggleSettings);

providerSelect.addEventListener('change', () => {
  updateProviderUI();
  saveSettings();
});

endpointInput.addEventListener('change', saveSettings);
apikeyInput.addEventListener('change', () => {
  const provider = providerSelect.value;
  if (CLOUD_PROVIDERS.includes(provider)) {
    apiKeys[provider] = apikeyInput.value.trim();
  }
  saveSettings();
});
modelSelect.addEventListener('change', () => {
  const provider = providerSelect.value;
  if (modelSelect.value) savedModels[provider] = modelSelect.value;
  saveSettings();
});
screenshotToggle.addEventListener('change', () => {
  saveSettings();
  updateScreenshotButtonVisibility();
});
systemPromptInput.addEventListener('change', saveSettings);

refreshModelsBtn.addEventListener('click', fetchModels);

summarizeBtn.addEventListener('click', handleSummarize);
askBtn.addEventListener('click', handleAsk);
sendBtn.addEventListener('click', () => handleSend(false));
screenshotSendBtn.addEventListener('click', () => handleSend(true));

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// Auto-resize textarea
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  const newHeight = Math.min(userInput.scrollHeight, 120);
  userInput.style.height = newHeight + 'px';
  userInput.style.overflowY = newHeight >= 120 ? 'auto' : 'hidden';
});

// Clear error banner when switching tabs
chrome.tabs.onActivated.addListener(() => hideBanner());

// Init
loadSettings().then(() => updateScreenshotButtonVisibility());
