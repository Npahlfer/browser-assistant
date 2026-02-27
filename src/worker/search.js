export async function webSearch(query, provider, apiKey) {
  if (provider === 'brave' && apiKey) {
    return await braveSearch(query, apiKey);
  }
  return await duckduckgoSearch(query);
}

async function duckduckgoSearch(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`DuckDuckGo error: ${resp.status}`);
  const data = await resp.json();

  const results = [];
  if (data.Abstract) {
    results.push({ title: data.AbstractSource || 'Summary', url: data.AbstractURL, description: data.Abstract });
  }
  for (const topic of (data.RelatedTopics || []).slice(0, 4)) {
    if (topic.Text && topic.FirstURL) {
      results.push({ title: topic.Text.split(' - ')[0] || topic.Text, url: topic.FirstURL, description: topic.Text });
    }
  }
  return { provider: 'DuckDuckGo', query, results };
}

async function braveSearch(query, apiKey) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const resp = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey
    }
  });
  if (!resp.ok) {
    if (resp.status === 401) throw new Error('Invalid Brave API key. Check your settings.');
    throw new Error(`Brave Search error: ${resp.status}`);
  }
  const data = await resp.json();
  const results = (data.web?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    description: r.description || ''
  }));
  return { provider: 'Brave', query, results };
}
