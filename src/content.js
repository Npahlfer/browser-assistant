// Content script: page text extraction

const MAX_CONTENT_LENGTH = 15000;

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg',
  'nav', 'footer', 'header',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '.ad', '.ads', '.advertisement', '[class*="sidebar"]',
  '[class*="cookie"]', '[class*="popup"]', '[class*="modal"]',
  '[aria-hidden="true"]'
];

function getMetaDescription() {
  const meta = document.querySelector('meta[name="description"]') ||
               document.querySelector('meta[property="og:description"]');
  return meta ? meta.getAttribute('content') || '' : '';
}

function cleanNode(node) {
  const clone = node.cloneNode(true);
  for (const sel of STRIP_SELECTORS) {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  }
  return clone;
}

function extractText(node) {
  const cleaned = cleanNode(node);
  return cleaned.innerText
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function scoreElement(el) {
  const text = el.innerText || '';
  const wordCount = text.split(/\s+/).length;
  const linkText = Array.from(el.querySelectorAll('a'))
    .reduce((sum, a) => sum + (a.innerText || '').length, 0);
  const linkDensity = text.length > 0 ? linkText / text.length : 1;
  const paragraphs = el.querySelectorAll('p').length;
  return wordCount * (1 - linkDensity) + paragraphs * 10;
}

function extractPageContent() {
  // Tier 1: semantic elements
  const article = document.querySelector('article');
  if (article) {
    const text = extractText(article);
    if (text.length > 200) return text;
  }

  const main = document.querySelector('main, [role="main"]');
  if (main) {
    const text = extractText(main);
    if (text.length > 200) return text;
  }

  // Tier 2: heuristic scoring
  const candidates = document.querySelectorAll('div, section');
  let bestEl = null;
  let bestScore = 0;
  for (const el of candidates) {
    const score = scoreElement(el);
    if (score > bestScore) {
      bestScore = score;
      bestEl = el;
    }
  }
  if (bestEl && bestScore > 100) {
    const text = extractText(bestEl);
    if (text.length > 200) return text;
  }

  // Tier 3: body fallback
  return extractText(document.body);
}

function getPageData() {
  let content = extractPageContent();
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated]';
  }
  return {
    title: document.title,
    url: window.location.href,
    metaDescription: getMetaDescription(),
    content
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_TEXT') {
    try {
      sendResponse({ success: true, data: getPageData() });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }
  return true;
});
