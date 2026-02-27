export function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdown(text) {
  // 1. Extract and protect fenced code blocks
  const codeBlocks = [];
  text = text.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = codeBlocks.length;
    const safeCode = escHtml(code.replace(/\n$/, ''));
    codeBlocks.push(`<pre><code${lang ? ` class="lang-${escHtml(lang)}"` : ''}>${safeCode}</code></pre>`);
    return `\x02${i}\x02`;
  });

  // 2. Extract and protect inline code
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const i = inlineCodes.length;
    inlineCodes.push(`<code>${escHtml(code)}</code>`);
    return `\x03${i}\x03`;
  });

  // 3. Escape HTML in remaining text
  text = escHtml(text);

  // 4. Process line-by-line for block elements
  const lines = text.split('\n');
  const out = [];
  let inUl = false, inOl = false;

  const closeList = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };

  for (const line of lines) {
    // Code block placeholder on its own line
    if (/^\x02\d+\x02$/.test(line)) {
      closeList();
      out.push(line); // restored later
      continue;
    }

    // Heading
    const hMatch = line.match(/^(#{1,6}) (.+)$/);
    if (hMatch) {
      closeList();
      const lvl = hMatch[1].length;
      out.push(`<h${lvl}>${inlineFormat(hMatch[2], inlineCodes)}</h${lvl}>`);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeList();
      out.push('<hr>');
      continue;
    }

    // Blockquote
    if (/^> /.test(line)) {
      closeList();
      out.push(`<blockquote>${inlineFormat(line.slice(2), inlineCodes)}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[*\-+] /.test(line)) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inlineFormat(line.replace(/^[*\-+] /, ''), inlineCodes)}</li>`);
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${inlineFormat(line.replace(/^\d+\. /, ''), inlineCodes)}</li>`);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      closeList();
      out.push('<br>');
      continue;
    }

    // Regular text
    closeList();
    out.push(`<p>${inlineFormat(line, inlineCodes)}</p>`);
  }

  closeList();

  // 5. Assemble and restore
  let html = out.join('');
  html = html.replace(/\x02(\d+)\x02/g, (_, i) => codeBlocks[+i]);
  html = html.replace(/\x03(\d+)\x03/g, (_, i) => inlineCodes[+i]);
  return html;
}

function inlineFormat(text, inlineCodes) {
  // Bold + italic combinations first
  text = text.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/___([^_\n]+)___/g, '<strong><em>$1</em></strong>');
  text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  text = text.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // Restore inline code
  text = text.replace(/\x03(\d+)\x03/g, (_, i) => inlineCodes[+i]);
  return text;
}
