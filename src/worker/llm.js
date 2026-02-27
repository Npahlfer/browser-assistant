export async function streamOllama(port, endpoint, model, messages) {
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

export async function streamOpenAICompat(port, endpoint, apiKey, model, messages) {
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

export async function streamClaude(port, endpoint, apiKey, model, messages) {
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
