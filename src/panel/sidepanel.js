import { escHtml, renderMarkdown } from './markdown.js';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant analyzing a web page. Here is the page context:

Title: {title}
URL: {url}
{description}
Page Content:
{content}

Use this context to answer the user's questions accurately. If the answer is not in the page content, say so. Exclude summary of the navigation and other trivial content. Don't include the link of the page in your response, unless asked to.`;

const DEFAULT_ENDPOINTS = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
  llamacpp: 'http://localhost:8080',
  openai: 'https://api.openai.com',
  claude: 'https://api.anthropic.com'
};

const CLOUD_PROVIDERS = ['openai', 'claude'];
const PAGE_CONVERSATIONS_KEY = 'pageConversations';
const MAX_PAGE_CONVERSATIONS = 10;

// State
let conversationHistory = [];
let systemMessage = '';
let currentMode = null; // 'summarize' | 'ask'
let isStreaming = false;
let currentPort = null;
let cachedScreenshot = null; // { base64, tabId, url }
let apiKeys = {}; // { openai: "sk-...", claude: "sk-..." }
let savedModels = {}; // { ollama: "llama3", openai: "gpt-4o", ... }
let braveApiKey = '';
let loadedFile = null; // { name, content }
let requestTimeout = 120; // seconds
let activePageKey = null;
let pageConversations = {};
let activeRequest = null;

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
const searchProviderSelect = document.getElementById('search-provider-select');
const braveKeyInput = document.getElementById('brave-key-input');
const braveKeyGroup = document.querySelector('.brave-key-group');
const summarizeBtn = document.getElementById('summarize-btn');
const askBtn = document.getElementById('ask-btn');
const cancelBtn = document.getElementById('cancel-btn');
const statusBanner = document.getElementById('status-banner');
const chatArea = document.getElementById('chat-area');
const welcomeState = document.getElementById('welcome-state');
const inputArea = document.getElementById('input-area');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const searchSendBtn = document.getElementById('search-send-btn');
const screenshotSendBtn = document.getElementById('screenshot-send-btn');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const fileChip = document.getElementById('file-chip');
const fileChipName = document.getElementById('file-chip-name');
const fileChipRemove = document.getElementById('file-chip-remove');
const downloadBtn = document.getElementById('download-btn');
const downloadMenu = document.getElementById('download-menu');
const aiSummaryBtn = document.getElementById('ai-summary-btn');
const aiSummaryMenu = document.getElementById('ai-summary-menu');
const timeoutInput = document.getElementById('timeout-input');

// --- Settings ---

function toggleSettings() {
  settingsPanel.classList.toggle('hidden');
  downloadMenu.classList.add('hidden');
}

function updateProviderUI() {
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
  fetchModels().then(() => {
    if (savedModels[provider]) modelSelect.value = savedModels[provider];
  });
}

function updateSearchProviderUI() {
  const provider = searchProviderSelect.value;
  if (provider === 'brave') {
    braveKeyGroup.classList.remove('hidden');
    braveKeyInput.value = braveApiKey;
  } else {
    braveKeyGroup.classList.add('hidden');
  }
}

function getSettings() {
  const provider = providerSelect.value;
  if (CLOUD_PROVIDERS.includes(provider) && apikeyInput.value.trim()) {
    apiKeys[provider] = apikeyInput.value.trim();
  }
  if (modelSelect.value) savedModels[provider] = modelSelect.value;
  if (braveKeyInput.value.trim()) braveApiKey = braveKeyInput.value.trim();
  return {
    provider,
    endpoint: endpointInput.value.replace(/\/+$/, ''),
    apiKey: apikeyInput.value.trim(),
    apiKeys: { ...apiKeys },
    model: modelSelect.value,
    savedModels: { ...savedModels },
    includeScreenshot: screenshotToggle.checked,
    systemPrompt: systemPromptInput.value,
    searchProvider: searchProviderSelect.value,
    braveApiKey,
    requestTimeout: parseInt(timeoutInput.value) || 120
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
      if (s.apiKey && !s.apiKeys && s.provider) apiKeys[s.provider] = s.apiKey;
      if (s.savedModels) savedModels = s.savedModels;
      if (s.model && !s.savedModels && s.provider) savedModels[s.provider] = s.model;
      if (s.includeScreenshot) screenshotToggle.checked = s.includeScreenshot;
      systemPromptInput.value = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      if (s.searchProvider) searchProviderSelect.value = s.searchProvider;
      if (s.braveApiKey) {
        braveApiKey = s.braveApiKey;
        braveKeyInput.value = braveApiKey;
      }
      if (s.requestTimeout) {
        requestTimeout = s.requestTimeout;
        timeoutInput.value = requestTimeout;
      }

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
      updateSearchProviderUI();
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

function resetChatUI() {
  chatArea.innerHTML = '';
  if (welcomeState) {
    welcomeState.style.display = '';
    chatArea.appendChild(welcomeState);
  }
}

function addMessage(role, text, isMarkdown = false) {
  hideWelcome();
  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (isMarkdown) {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  chatArea.appendChild(div);
  chatArea.scrollTop = chatArea.scrollHeight;
  return div;
}

function addLoadingMessage(text = 'Thinking') {
  hideWelcome();
  const div = document.createElement('div');
  div.className = 'message assistant loading-message';
  div.innerHTML = `<span class="loading-label">${escHtml(text)}</span><span class="loading-dots"><span></span><span></span><span></span></span>`;
  chatArea.appendChild(div);
  chatArea.scrollTop = chatArea.scrollHeight;
  return div;
}

function createStreamingMessage() {
  hideWelcome();
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

function hideWelcome() {
  if (welcomeState) welcomeState.style.display = 'none';
}

function clearChat(resetContext = true) {
  resetChatUI();
  conversationHistory = [];
  if (resetContext) {
    systemMessage = '';
    cachedScreenshot = null;
  }
}

function renderConversation(history) {
  resetChatUI();
  conversationHistory = history.map(msg => ({ ...msg }));
  for (const msg of conversationHistory) {
    addMessage(msg.role, msg.content, msg.role === 'assistant');
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
  searchSendBtn.disabled = streaming;
  screenshotSendBtn.disabled = streaming;
  cancelBtn.classList.toggle('hidden', !streaming);
  cancelBtn.disabled = !streaming;
}

function updateScreenshotButtonVisibility() {
  screenshotSendBtn.classList.toggle('hidden', !screenshotToggle.checked);
}

// --- Page Conversation State ---

function getPageKey(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function cloneHistory(history) {
  return history.map(msg => ({ ...msg }));
}

function createViewSnapshot() {
  return {
    conversationHistory: cloneHistory(conversationHistory),
    systemMessage,
    currentMode,
    pageKey: activePageKey
  };
}

function restoreViewSnapshot(snapshot) {
  systemMessage = snapshot.systemMessage || '';
  currentMode = snapshot.currentMode || null;
  activePageKey = snapshot.pageKey || activePageKey;

  if (snapshot.conversationHistory.length > 0) {
    renderConversation(snapshot.conversationHistory);
  } else {
    clearChat(false);
  }

  setMode(currentMode);

  if (currentMode === 'ask' && snapshot.pageKey && snapshot.pageKey === activePageKey) {
    if (!systemMessage && conversationHistory.length === 0) {
      delete pageConversations[activePageKey];
    } else {
      pageConversations[activePageKey] = {
        systemMessage,
        history: cloneHistory(conversationHistory),
        updatedAt: Date.now()
      };
    }
    persistPageConversations().catch((e) => {
      console.error('Failed to restore page conversation after cancel:', e);
    });
  }
}

function beginRequest(kind) {
  const request = {
    id: Date.now() + Math.random(),
    kind,
    snapshot: createViewSnapshot(),
    cancelled: false,
    finalized: false
  };
  activeRequest = request;
  setStreaming(true);
  return request;
}

function isActiveRequest(request) {
  return !!request && activeRequest?.id === request.id && !request.cancelled;
}

function finishRequest(request) {
  if (!request || activeRequest?.id !== request.id) return;
  activeRequest = null;
  setStreaming(false);
}

function cancelRequestUI(request) {
  if (!request || request.finalized) return;
  request.finalized = true;
  restoreViewSnapshot(request.snapshot);
  activeRequest = null;
  setStreaming(false);
  showBanner('Request cancelled.', 'warning');
}

function cancelActiveRequest() {
  if (!activeRequest) return;
  activeRequest.cancelled = true;
  const request = activeRequest;

  if (currentPort) {
    try { currentPort.disconnect(); } catch (_) { }
  }

  cancelRequestUI(request);
}

function prunePageConversations() {
  const pruned = Object.entries(pageConversations)
    .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_PAGE_CONVERSATIONS);
  pageConversations = Object.fromEntries(pruned);
}

async function persistPageConversations() {
  prunePageConversations();
  await chrome.storage.local.set({ [PAGE_CONVERSATIONS_KEY]: pageConversations });
}

async function loadPageConversations() {
  try {
    const stored = await chrome.storage.local.get(PAGE_CONVERSATIONS_KEY);
    pageConversations = stored[PAGE_CONVERSATIONS_KEY] || {};
    prunePageConversations();
  } catch (e) {
    console.error('Failed to load page conversations:', e);
    pageConversations = {};
  }
}

function saveCurrentAskConversation() {
  if (currentMode !== 'ask' || !activePageKey) return;

  if (!systemMessage && conversationHistory.length === 0) {
    delete pageConversations[activePageKey];
  } else {
    pageConversations[activePageKey] = {
      systemMessage,
      history: cloneHistory(conversationHistory),
      updatedAt: Date.now()
    };
  }

  persistPageConversations().catch((e) => {
    console.error('Failed to save page conversations:', e);
  });
}

function loadAskConversationForPage(pageKey) {
  activePageKey = pageKey;
  const entry = pageKey ? pageConversations[pageKey] : null;

  if (entry) {
    systemMessage = entry.systemMessage || '';
    renderConversation(entry.history || []);
    entry.updatedAt = Date.now();
    persistPageConversations().catch((e) => {
      console.error('Failed to update page conversation recency:', e);
    });
    return;
  }

  clearChat();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function updateActivePageKey() {
  const tab = await getActiveTab();
  const nextPageKey = getPageKey(tab?.url);
  const pageChanged = nextPageKey !== activePageKey;

  if (pageChanged) {
    cachedScreenshot = null;
    activePageKey = nextPageKey;
  }

  return { tab, pageKey: nextPageKey, pageChanged };
}

async function syncVisibleConversationToActivePage() {
  const { pageChanged, pageKey } = await updateActivePageKey();
  if (!pageChanged) return;

  hideBanner();

  if (isStreaming && currentPort) {
    try { currentPort.disconnect(); } catch (_) { }
  }

  if (currentMode === 'ask') {
    loadAskConversationForPage(pageKey);
    setMode('ask');
    return;
  }

  clearChat();
  setMode(null);
}

// --- Page Data ---

async function getPageData() {
  try {
    const tab = await getActiveTab();
    if (!tab) throw new Error('No active tab found');

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
    const tab = await getActiveTab();
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
  try {
    const tab = await getActiveTab();
    if (tab && (tab.id !== cachedScreenshot.tabId || tab.url !== cachedScreenshot.url)) {
      return await captureScreenshot();
    }
  } catch (e) { }
  return cachedScreenshot.base64;
}

// --- LLM Streaming ---

function buildSystemMessage(pageData) {
  const template = systemPromptInput.value.trim() || DEFAULT_SYSTEM_PROMPT;
  const now = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let result = template
    .replace(/\{title\}/g, pageData.title)
    .replace(/\{url\}/g, pageData.url)
    .replace(/\{description\}/g, pageData.metaDescription || '')
    .replace(/\{content\}/g, pageData.content)
    .replace(/\{currentDate\}/g, now.toLocaleDateString('en-CA')) // YYYY-MM-DD
    .replace(/\{currentYear\}/g, String(now.getFullYear()))
    .replace(/\{currentMonth\}/g, months[now.getMonth()])
    .replace(/\{currentDay\}/g, days[now.getDay()])
    .replace(/\{currentHour\}/g, String(now.getHours()).padStart(2, '0'))
    .replace(/\{currentMinute\}/g, String(now.getMinutes()).padStart(2, '0'));

  // Append loaded file context
  if (loadedFile) {
    result += `\n\n[Attached File: ${loadedFile.name}]\n${loadedFile.content}\n[End of Attached File]`;
  }

  return result;
}

async function streamChat(userMessage, screenshotBase64 = null) {
  const request = activeRequest;
  const settings = getSettings();

  if (!settings.model) {
    finishRequest(request);
    showBanner('Please select a model in settings.', 'warning');
    return;
  }

  hideBanner();

  const messages = [
    { role: 'system', content: systemMessage },
    ...conversationHistory
  ];

  if (screenshotBase64) {
    messages.push({ role: 'user', content: userMessage, image: screenshotBase64 });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  conversationHistory.push({ role: 'user', content: userMessage });
  saveCurrentAskConversation();

  const { container, textSpan } = createStreamingMessage();
  let fullResponse = '';

  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: 'llm-stream' });
    currentPort = port;

    // Inactivity timeout: resets on every token so long responses aren't cut off,
    // but fires if the model goes silent for requestTimeout seconds.
    let inactivityTimer;
    const resetTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        if (request?.cancelled) {
          resolve({ cancelled: true });
          return;
        }
        const msg = `No response for ${requestTimeout}s. Check that your model is running.`;
        const cursor = container.querySelector('.cursor');
        if (cursor) cursor.remove();
        if (!fullResponse) {
          container.innerHTML = `<span class="error-text">${escHtml(msg)}</span>`;
          container.classList.add('error-msg');
        }
        if (fullResponse) {
          conversationHistory.push({ role: 'assistant', content: fullResponse });
          saveCurrentAskConversation();
        }
        showBanner(msg, 'error');
        currentPort = null;
        finishRequest(request);
        try { port.disconnect(); } catch (_) { }
        resolve();
      }, requestTimeout * 1000);
    };
    resetTimer();

    port.onMessage.addListener((msg) => {
      if (request?.cancelled) return;
      if (msg.type === 'TOKEN') {
        resetTimer(); // stay alive as long as tokens keep arriving
        fullResponse += msg.token;
        container.innerHTML = renderMarkdown(fullResponse);
        // Re-add cursor
        const cursor = document.createElement('span');
        cursor.className = 'cursor';
        container.appendChild(cursor);
        chatArea.scrollTop = chatArea.scrollHeight;
      } else if (msg.type === 'DONE') {
        clearTimeout(inactivityTimer);
        container.innerHTML = renderMarkdown(fullResponse);
        conversationHistory.push({ role: 'assistant', content: fullResponse });
        saveCurrentAskConversation();
        currentPort = null;
        finishRequest(request);
        resolve({ cancelled: false });
      } else if (msg.type === 'ERROR') {
        clearTimeout(inactivityTimer);
        if (!fullResponse) {
          container.innerHTML = `<span class="error-text">${escHtml(msg.error)}</span>`;
          container.classList.add('error-msg');
        } else {
          container.innerHTML = renderMarkdown(fullResponse);
        }
        showBanner(msg.error, 'error');
        currentPort = null;
        finishRequest(request);
        resolve({ cancelled: false });
      }
    });

    port.onDisconnect.addListener(() => {
      clearTimeout(inactivityTimer);
      if (request?.cancelled) {
        currentPort = null;
        resolve({ cancelled: true });
        return;
      }
      if (isStreaming) {
        if (fullResponse) container.innerHTML = renderMarkdown(fullResponse);
        currentPort = null;
        finishRequest(request);
        resolve({ cancelled: false });
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

// --- Utility: silent one-shot LLM call (collects full response, no UI) ---

async function callLLMOnce(messages) {
  const settings = getSettings();
  const request = activeRequest;
  if (!settings.model) {
    finishRequest(request);
    return null;
  }
  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: 'llm-stream' });
    currentPort = port;
    let result = '';
    const timer = setTimeout(() => {
      try { port.disconnect(); } catch (_) { }
      currentPort = null;
      resolve(null); // fall back gracefully on timeout
    }, requestTimeout * 1000);
    port.onMessage.addListener((msg) => {
      if (msg.type === 'TOKEN') result += msg.token;
      else if (msg.type === 'DONE') {
        clearTimeout(timer);
        currentPort = null;
        port.disconnect();
        resolve(result.trim());
      } else if (msg.type === 'ERROR') {
        clearTimeout(timer);
        currentPort = null;
        port.disconnect();
        resolve(null);
      }
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      currentPort = null;
      if (request?.cancelled) {
        resolve(null);
        return;
      }
      resolve(result.trim() || null);
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

// --- Web Search ---

async function generateSearchQuery(userMessage) {
  const contextParts = [];

  // Pull title and URL out of the system message if we have one
  if (systemMessage) {
    const titleMatch = systemMessage.match(/^Title: (.+)$/m);
    const urlMatch = systemMessage.match(/^URL: (.+)$/m);
    if (titleMatch) contextParts.push(`Page title: ${titleMatch[1].trim()}`);
    if (urlMatch) contextParts.push(`Page URL: ${urlMatch[1].trim()}`);
  }

  // Include the last few conversation turns for context
  const recent = conversationHistory.slice(-6);
  if (recent.length > 0) {
    contextParts.push('Recent conversation:\n' +
      recent.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`).join('\n'));
  }

  const context = contextParts.length ? `\n\nContext:\n${contextParts.join('\n')}` : '';
  const prompt = `Generate the most effective web search query for the question below. Use the context to make it specific and useful. Reply with ONLY the search query — no explanation, no quotes, no punctuation at the end.${context}\n\nQuestion: ${userMessage}`;

  const generated = await callLLMOnce([{ role: 'user', content: prompt }]);
  // Strip surrounding quotes the model might add anyway
  return generated ? generated.replace(/^["']|["']$/g, '').trim() : userMessage;
}

function addSearchBadge(query) {
  hideWelcome();
  const badge = document.createElement('div');
  badge.className = 'search-badge';
  badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="5" cy="5" r="3.5"/><path d="M8 8l2.5 2.5"/></svg><span>${escHtml(query)}</span>`;
  chatArea.appendChild(badge);
  chatArea.scrollTop = chatArea.scrollHeight;
  return badge;
}

async function performSearch(query) {
  const settings = getSettings();
  const provider = settings.searchProvider || 'duckduckgo';
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'WEB_SEARCH',
      query,
      provider,
      apiKey: braveApiKey
    });
    if (resp.error) throw new Error(resp.error);
    return resp.results;
  } catch (e) {
    console.error('Search failed:', e);
    return null;
  }
}

function formatSearchResults(results) {
  if (!results || !results.results || results.results.length === 0) return '';
  const header = `[Web Search via ${results.provider} for: "${results.query}"]`;
  const body = results.results
    .slice(0, 5)
    .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description || ''}`)
    .join('\n\n');
  return `${header}\n\n${body}\n\n[End of Search Results]`;
}

// --- Actions ---

async function handleSummarize() {
  if (isStreaming) return;

  await updateActivePageKey();
  const request = beginRequest('summarize');
  clearChat();
  setMode('summarize');

  const loadingMsg = addLoadingMessage('Extracting page content');

  try {
    const pageData = await getPageData();
    if (!isActiveRequest(request)) return;
    systemMessage = buildSystemMessage(pageData);

    loadingMsg.remove();
    addMessage('user', 'Summarize this page');

    const screenshotBase64 = await getScreenshotBase64(true);
    if (!isActiveRequest(request)) return;

    const result = await streamChat(
      'Please provide a concise summary of this web page. Highlight the key points and main topics covered.',
      screenshotBase64
    );
    if (result?.cancelled) return;
  } catch (e) {
    loadingMsg.remove();
    finishRequest(request);
    showBanner(e.message, 'error');
  }
}

async function handleAsk() {
  await updateActivePageKey();
  loadAskConversationForPage(activePageKey);
  setMode('ask');

  if (!systemMessage) {
    const loadingMsg = addLoadingMessage('Extracting page content');
    try {
      const pageData = await getPageData();
      systemMessage = buildSystemMessage(pageData);
      saveCurrentAskConversation();
      loadingMsg.remove();
    } catch (e) {
      loadingMsg.remove();
      showBanner(e.message, 'error');
      return;
    }
  }
  await getScreenshotBase64(true);
}

async function handleSend(forceNewScreenshot = false, includeSearch = false) {
  const text = userInput.value.trim();
  if (!text || isStreaming) return;

  const request = beginRequest('send');
  userInput.value = '';
  userInput.style.height = 'auto';
  addMessage('user', text);

  let messageText = text;

  if (includeSearch) {
    const queryLoadingMsg = addLoadingMessage('Crafting search query');
    const searchQuery = await generateSearchQuery(text);
    queryLoadingMsg.remove();
    if (!isActiveRequest(request)) return;

    addSearchBadge(searchQuery);

    const searchLoadingMsg = addLoadingMessage('Searching the web');
    const searchResults = await performSearch(searchQuery);
    searchLoadingMsg.remove();
    if (!isActiveRequest(request)) return;

    const formatted = formatSearchResults(searchResults);
    if (formatted) {
      messageText = `${text}\n\n${formatted}`;
    } else {
      showBanner('Web search returned no results.', 'warning');
    }
  }

  const screenshotBase64 = await getScreenshotBase64(forceNewScreenshot);
  if (!isActiveRequest(request)) return;

  try {
    const result = await streamChat(messageText, screenshotBase64);
    if (result?.cancelled) return;
  } catch (e) {
    finishRequest(request);
    showBanner(e.message || 'Request failed.', 'error');
  }
}

// --- File Attachment ---

function handleAttachFile() {
  fileInput.click();
}

function handleFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  fileInput.value = ''; // Reset so same file can be re-selected

  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = ev.target.result;
    loadedFile = { name: file.name, content };
    fileChipName.textContent = file.name;
    fileChip.classList.remove('hidden');
    // If we have an active system message, update it
    if (systemMessage) {
      // Rebuild won't happen automatically; just note the file is attached
      // It will be included on next buildSystemMessage call
    }
  };
  reader.onerror = () => showBanner('Failed to read file.', 'error');
  reader.readAsText(file);
}

function removeFile() {
  loadedFile = null;
  fileChip.classList.add('hidden');
  fileChipName.textContent = '';
}

// --- AI Summary Download ---

async function downloadAISummary(format = 'md') {
  if (conversationHistory.length === 0) {
    showBanner('Nothing to summarize yet.', 'warning');
    return;
  }

  const settings = getSettings();
  if (!settings.model) {
    showBanner('Please select a model in settings.', 'warning');
    return;
  }

  aiSummaryBtn.disabled = true;

  const convoText = conversationHistory
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const formatInstructions = format === 'md'
    ? `Format the summary as Markdown with these sections:

## Summary
A concise overview of what was discussed.

## Key Points
Bullet list of the most important findings or information.

## Details
Any notable specifics, quotes, data, or conclusions worth preserving.`
    : `Format the summary as plain text with these sections (no markdown, no asterisks, no hashtags, no special characters):

SUMMARY
A concise overview of what was discussed.

KEY POINTS
A numbered list of the most important findings or information.

DETAILS
Any notable specifics, quotes, data, or conclusions worth preserving.`;

  const summaryPrompt = `Please produce a structured summary of the following conversation. ${formatInstructions}

---
Conversation:
${convoText}`;

  let summaryText = '';
  const summaryMsg = addLoadingMessage('Generating AI summary');

  await new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: 'llm-stream' });
    const timer = setTimeout(() => {
      try { port.disconnect(); } catch (_) { }
      showBanner(`Summary timed out after ${requestTimeout}s.`, 'error');
      resolve();
    }, requestTimeout * 1000);

    port.onMessage.addListener((msg) => {
      if (msg.type === 'TOKEN') {
        summaryText += msg.token;
      } else if (msg.type === 'DONE' || msg.type === 'ERROR') {
        clearTimeout(timer);
        if (msg.type === 'ERROR') showBanner(msg.error, 'error');
        resolve();
      }
    });

    port.onDisconnect.addListener(() => { clearTimeout(timer); resolve(); });

    port.postMessage({
      type: 'CHAT_REQUEST',
      provider: settings.provider,
      endpoint: settings.endpoint,
      apiKey: settings.apiKey,
      model: settings.model,
      messages: [{ role: 'user', content: summaryPrompt }]
    });
  });

  summaryMsg.remove();
  aiSummaryBtn.disabled = false;

  if (!summaryText) return;

  const date = new Date().toLocaleDateString('en-CA');
  const header = format === 'md'
    ? `# AI Conversation Summary\n_${date}_\n\n`
    : `AI Conversation Summary — ${date}\n${'='.repeat(40)}\n\n`;
  const blob = new Blob([header + summaryText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `summary-${date}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Download ---

function toggleDownloadMenu() {
  downloadMenu.classList.toggle('hidden');
  aiSummaryMenu.classList.add('hidden');
  settingsPanel.classList.add('hidden');
}

function downloadConversation(format) {
  downloadMenu.classList.add('hidden');

  if (conversationHistory.length === 0) {
    showBanner('Nothing to download yet.', 'warning');
    return;
  }

  let content = '';
  const date = new Date().toLocaleDateString('en-CA');

  if (format === 'md') {
    content = `# Browser Assistant Conversation\n_${date}_\n\n`;
    for (const msg of conversationHistory) {
      const role = msg.role === 'user' ? '**You**' : '**Assistant**';
      content += `${role}\n\n${msg.content}\n\n---\n\n`;
    }
  } else {
    content = `Browser Assistant Conversation — ${date}\n${'='.repeat(50)}\n\n`;
    for (const msg of conversationHistory) {
      const role = msg.role === 'user' ? 'YOU' : 'ASSISTANT';
      content += `${role}:\n${msg.content}\n\n${'-'.repeat(30)}\n\n`;
    }
  }

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `conversation-${date}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Event Listeners ---

settingsBtn.addEventListener('click', toggleSettings);

aiSummaryBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  downloadMenu.classList.add('hidden');
  settingsPanel.classList.add('hidden');
  aiSummaryMenu.classList.toggle('hidden');
});

document.querySelectorAll('#ai-summary-menu .download-option').forEach(btn => {
  btn.addEventListener('click', () => {
    aiSummaryMenu.classList.add('hidden');
    downloadAISummary(btn.dataset.format);
  });
});

downloadBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDownloadMenu();
});

document.querySelectorAll('.download-option').forEach(btn => {
  btn.addEventListener('click', () => downloadConversation(btn.dataset.format));
});

// Close menus on outside click
document.addEventListener('click', (e) => {
  if (!downloadMenu.contains(e.target) && e.target !== downloadBtn) {
    downloadMenu.classList.add('hidden');
  }
  if (!aiSummaryMenu.contains(e.target) && e.target !== aiSummaryBtn) {
    aiSummaryMenu.classList.add('hidden');
  }
});

providerSelect.addEventListener('change', () => {
  updateProviderUI();
  saveSettings();
});

searchProviderSelect.addEventListener('change', () => {
  updateSearchProviderUI();
  saveSettings();
});

braveKeyInput.addEventListener('change', () => {
  braveApiKey = braveKeyInput.value.trim();
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
timeoutInput.addEventListener('change', () => {
  requestTimeout = parseInt(timeoutInput.value) || 120;
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
cancelBtn.addEventListener('click', cancelActiveRequest);
sendBtn.addEventListener('click', () => handleSend(false, false));
searchSendBtn.addEventListener('click', () => handleSend(false, true));
screenshotSendBtn.addEventListener('click', () => handleSend(true, false));

attachBtn.addEventListener('click', handleAttachFile);
fileInput.addEventListener('change', handleFileSelected);
fileChipRemove.addEventListener('click', removeFile);

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
chrome.tabs.onActivated.addListener(() => {
  syncVisibleConversationToActivePage().catch((e) => {
    console.error('Failed to sync active tab conversation:', e);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active || (!changeInfo.url && changeInfo.status !== 'complete')) return;
  syncVisibleConversationToActivePage().catch((e) => {
    console.error('Failed to sync updated tab conversation:', e);
  });
});

// Init
Promise.all([loadSettings(), loadPageConversations()])
  .then(async () => {
    updateScreenshotButtonVisibility();
    await updateActivePageKey();
  })
  .catch((e) => {
    console.error('Initialization failed:', e);
  });
