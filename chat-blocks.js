(() => {
  const aliases = new Map(Object.entries({
    javascript: ['JavaScript', 'js', ['js', 'mjs', 'cjs', 'jsx']],
    typescript: ['TypeScript', 'ts', ['ts', 'tsx']],
    python: ['Python', 'py', ['py', 'python3']],
    html: ['HTML', 'html', ['htm']],
    xml: ['XML', 'xml', ['svg']],
    markdown: ['Markdown', 'md', ['md', 'mdown', 'mkd']],
    json: ['JSON', 'json', []],
    bash: ['Bash', 'sh', ['sh', 'shell', 'zsh']],
    powershell: ['PowerShell', 'ps1', ['ps1']],
    plaintext: ['Texto', 'txt', ['txt', 'text', '']],
  }).flatMap(([id, [name, extension, extra]]) =>
    [id, ...extra].map(alias => [alias, { id, name, extension }])));

  function language(input) {
    const id = input.trim().toLowerCase().split(/\s+/)[0];
    return aliases.get(id) ?? { id, name: id.toUpperCase(), extension: /^[a-z0-9]{1,16}$/.test(id) ? id : 'txt' };
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function highlight(value, id) {
    if (value.length > 20000 || id === 'plaintext' || !hljs.getLanguage(id)) return escapeHtml(value);
    try { return hljs.highlight(value, { language: id, ignoreIllegals: true }).value; }
    catch { return escapeHtml(value); }
  }

  const markdown = markdownit({
    html: false,
    highlight: (value, info) => {
      const kind = language(info || detectCode(value));
      return '<pre class="chat-code"><code class="hljs">' + highlight(value, kind.id) + '</code></pre>';
    },
  });
  markdown.inline.ruler.before('html_inline', 'chat_break', (state, silent) => {
    if (state.src[state.pos] !== '<') return false;
    const match = /^<br[ \t]*\/?>/i.exec(state.src.slice(state.pos, state.posMax));
    if (!match) return false;
    if (!silent) state.push('hardbreak', 'br', 0);
    state.pos += match[0].length;
    return true;
  });
  markdown.renderer.rules.image = (tokens, index) => escapeHtml(tokens[index].content);
  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return renderer.renderToken(tokens, index, options);
  };
  for (const type of ['fence', 'code_block']) {
    const render = markdown.renderer.rules[type];
    markdown.renderer.rules[type] = (tokens, index, options, env, renderer) => {
      if (!env.chatSnippets) return render(tokens, index, options, env, renderer);
      env.chatSnippets.push(describeSnippet(tokens[index]));
      return '<div data-chat-snippet="' + (env.chatSnippets.length - 1) + '"></div>\n';
    };
  }

  function describeSnippet(token, filename = '') {
    const value = token.content.replace(/\n$/, '');
    return { value, filename, kind: language(token.info || detectCode(value)), standalone: true };
  }

  function renderDocument(value) {
    const chatSnippets = [];
    return { html: markdown.render(value, { chatSnippets }), snippets: chatSnippets };
  }

  function detectCode(text) {
    const value = text.trim();
    if (value.startsWith('{') || value.startsWith('[')) {
      try { JSON.parse(value); return 'json'; } catch { /* An array or object may be source code. */ }
    }
    if (/^<(?:!doctype html|[a-z][\w-]*(?:\s|\/?>))/i.test(value)) return 'html';
    if (/^(?:#!.*python|(?:from\s+[\w.]+\s+import|import\s+[\w.]+[ \t]*(?:\n|$)|(?:async\s+)?def\s+\w+\(|print\())/.test(value)) return 'python';
    if (/^(?:(?:const|let|var)\s+[$\w]+\s*=|(?:async\s+)?function\s|console\.\w+\(|(?:for|if|while)\s*\(|(?:module\.exports|exports\.\w+)\s*=|import\s.*\sfrom\s)/.test(value)) return 'javascript';
    if (/^#!.*(?:ba|z)?sh\b/.test(value) || /^(?:(?:node|npm|npx|git|python3?|pip3?) [^\n]+(?:\n|$))+$/.test(value)) return 'bash';
    if (/^(?:[:.#][\w-]+|[a-z]+)\s*\{[\s\S]*:[\s\S]*\}/.test(value)) return 'css';
    return 'plaintext';
  }

  function describe(content) {
    const parsed = markdown.parse(content, {});
    const isAttachment = parsed.length === 4 && parsed[1].type === 'inline'
      && /^Archivo: [^\n]+$/.test(parsed[1].content) && parsed[3].type === 'fence';
    const fence = isAttachment ? parsed[3] : parsed.length === 1 && parsed[0].type === 'fence' ? parsed[0] : null;
    if (fence) return describeSnippet(fence, isAttachment ? parsed[1].content.slice(9) : '');
    const document = parsed.some(token => token.type === 'fence' || token.type === 'heading_open');
    const detected = document ? 'plaintext' : detectCode(content);
    const formatted = parsed.some(token => !['paragraph_open', 'paragraph_close', 'inline'].includes(token.type)
      || token.children?.some(child => child.type !== 'text' && child.type !== 'softbreak'));
    return { value: content, filename: '', kind: language(detected === 'plaintext' && formatted ? 'markdown' : detected),
      standalone: detected !== 'plaintext' };
  }

  function wrap(text, name) {
    const type = name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() || 'text';
    const size = Math.max(2, ...Array.from(text.matchAll(/\x60+/g), match => match[0].length)) + 1;
    const fence = String.fromCharCode(96).repeat(size);
    return fence + type + '\n' + text + '\n' + fence;
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function button(label, action, className = 'secondary') {
    const node = element('button', label, className);
    node.type = 'button';
    node.onclick = action;
    return node;
  }

  function source(text, kind, className = 'chat-code') {
    const pre = element('pre', undefined, className);
    const code = element('code', undefined, 'hljs');
    code.innerHTML = highlight(text, kind.id);
    pre.append(code);
    return pre;
  }

  function isolatedFrame(path, title, data) {
    const frame = element('iframe');
    frame.title = title;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = path;
    frame.onload = () => frame.contentWindow.postMessage(data, '*');
    return frame;
  }

  function htmlView(text) {
    const iframe = isolatedFrame('/chat-preview.html', 'Vista de HTML', { html: text });
    iframe.className = 'chat-html-preview';
    return iframe;
  }

  let stopRunning;
  function runCode(code, kind, done) {
    stopRunning?.('Se inició otra prueba.');
    const python = kind === 'python';
    const frame = isolatedFrame(python ? '/chat-python-runner.html' : '/chat-runner.html',
      python ? 'Entorno aislado de Python' : 'Entorno aislado de JavaScript', { code });
    frame.hidden = true;
    function finish(result) {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      stopRunning = undefined;
      done(result);
    }
    function onMessage(event) {
      if (event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.type !== 'riwi-run-result') return;
      const { lines, error } = event.data;
      finish([...lines, ...(error ? [error] : [])].join('\n') || 'La prueba terminó sin salida.');
    }
    const timer = setTimeout(() => finish('No se recibió el resultado de la prueba.'), 10000);
    stopRunning = finish;
    window.addEventListener('message', onMessage);
    document.body.append(frame);
  }

  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const file = element('a');
    file.href = url;
    file.download = name;
    file.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function workspace({ value, filename, kind }, report) {
    const block = element('section', undefined, 'chat-workspace');
    const toolbar = element('div', undefined, 'chat-workspace-tools');
    const title = element('div', undefined, 'chat-workspace-title');
    const controls = element('div', undefined, 'row chat-workspace-actions');
    title.append(element('strong', filename || kind.name));
    if (filename) title.append(element('small', kind.name));
    const body = element('div', undefined, 'chat-workspace-body');
    const output = element('div', undefined, 'chat-workspace-result');
    output.hidden = true;
    const field = element('textarea');
    field.value = value;
    field.rows = 9;
    field.wrap = 'off';
    field.maxLength = Math.max(value.length, 20000);
    field.spellcheck = kind.id === 'markdown' || kind.id === 'plaintext';
    field.setAttribute('aria-label', 'Editar ' + (filename || kind.name));
    const editing = element('div', undefined, 'chat-editor');
    const backdrop = source('', kind);
    backdrop.setAttribute('aria-hidden', 'true');
    editing.append(backdrop, field);
    const painted = backdrop.firstElementChild;
    function scrollSource() {
      backdrop.scrollTop = field.scrollTop;
      backdrop.scrollLeft = field.scrollLeft;
    }
    function paint() {
      painted.innerHTML = highlight(field.value, kind.id) + '\n';
      scrollSource();
    }
    field.oninput = paint;
    field.onscroll = scrollSource;

    const selected = new Map();
    function show(mode) {
      for (const [key, control] of selected) control.setAttribute('aria-pressed', String(mode === key));
      body.replaceChildren();
      if (mode === 'source') body.append(source(field.value, kind));
      else if (mode === 'edit') {
        body.append(editing, button('Restaurar original', () => {
          field.value = value;
          paint();
          field.focus();
          report('Contenido original restaurado.');
        }));
        paint();
        field.focus();
      } else if (kind.id === 'markdown') {
        const formatted = element('div', undefined, 'chat-markdown');
        formatted.innerHTML = markdown.render(field.value);
        body.append(formatted);
      } else if (kind.id === 'html') body.append(htmlView(field.value));
      else if (kind.id === 'plaintext') body.append(element('div', field.value, 'chat-plain'));
      else body.append(source(field.value, kind));
    }
    function execute(text, format) {
      output.hidden = false;
      if (text.length > 20000) {
        output.replaceChildren(element('p', 'La prueba admite hasta 20.000 caracteres.'));
      } else if (format.id === 'html') {
        output.replaceChildren(htmlView(text));
      } else if (format.id === 'javascript' || format.id === 'python') {
        run.disabled = true;
        output.replaceChildren(element('p', 'Ejecutando ' + format.name + '…'));
        runCode(text, format.id, result => {
          output.replaceChildren(element('pre', result));
          run.disabled = false;
        });
      } else if (format.id === 'json') {
        try { output.replaceChildren(element('p', 'JSON válido.'), source(JSON.stringify(JSON.parse(text), null, 2), format)); }
        catch (error) { output.replaceChildren(element('p', 'JSON inválido. ' + error.message)); }
      } else if (format.id === 'markdown' || format.id === 'plaintext') {
        show('view');
        output.hidden = true;
      } else {
        const help = ['bash', 'powershell'].includes(format.id)
          ? 'Ejecuta estos comandos en tu terminal, desde la carpeta del proyecto.'
          : 'Descarga este código y ejecútalo con las herramientas de ' + format.name + ' en tu equipo.';
        output.replaceChildren(element('p', help), source(text, format),
          button('Descargar', () => download(text, filename || 'ejemplo.' + format.extension)));
      }
    }

    const run = button('Ejecutar', () => execute(field.value, kind), 'chat-run-action');
    for (const [mode, label] of [['view', 'Ver'], ['source', 'Código'], ['edit', 'Editar']]) {
      selected.set(mode, button(label, () => show(mode)));
    }
    const copy = button('Copiar', async () => {
      try {
        await navigator.clipboard.writeText(field.value);
        report('Copiado.');
      } catch { report('Abre Editar para seleccionar y copiar el contenido.', true); }
    });
    const modes = element('div', undefined, 'row chat-workspace-modes');
    modes.append(...selected.values());
    controls.append(modes, copy, run);
    toolbar.append(title, controls);
    output.setAttribute('aria-live', 'polite');
    block.append(toolbar, body, output);
    show('view');
    return block;
  }

  function message(content, report) {
    const description = describe(content);
    if (description.standalone) return workspace(description, report);
    if (description.kind.id === 'plaintext') return element('div', content, 'chat-message-text');
    const formatted = element('div', undefined, 'chat-message-text chat-markdown');
    const { html, snippets } = renderDocument(content);
    formatted.innerHTML = html;
    for (const slot of formatted.querySelectorAll('[data-chat-snippet]')) {
      slot.replaceWith(workspace(snippets[Number(slot.dataset.chatSnippet)], report));
    }
    return formatted;
  }

  function responsePresentation(content) {
    const text = String(content || '');
    const body = text.replace(/^Respuesta de IA\s*\n+/u, '').trimStart();
    const tagged = /^\[(RESTRINGIDO|ERROR)\]\s*/u.exec(body);
    const hiddenHealth = body === '[contenido de salud omitido]';
    const firstParagraph = body.split(/\n\s*\n/u)[0].slice(0, 600);
    const refusalText = firstParagraph.replace(/`[^`]*`|"[^"\n]*"|“[^”]*”/gu, '');
    const refusal = !firstParagraph.includes('```') && /(?:^(?:lo siento[,.]?\s*(?:pero\s+)?)?no puedo (?:ayudarte con|ayudar con|proporcionar|facilitar|cumplir|darte la soluci[oó]n|resolver (?:tu|el) (?:examen|evaluaci[oó]n))|\bpero no puedo (?:ayudarte con|ayudar con|proporcionar|facilitar)|fuera de mi alcance|fuera del alcance del tutor|solo puedo ayudarte con programaci[oó]n)/iu.test(refusalText);
    return { alert: Boolean(tagged || refusal || hiddenHealth), label: tagged?.[1] === 'ERROR' ? 'No se pudo completar' : 'Solicitud restringida',
      content: hiddenHealth ? 'El contenido no se muestra para proteger información sensible. Reformula el ejercicio con datos ficticios.'
        : tagged ? body.slice(tagged[0].length) : text };
  }

  globalThis.RiwiChatBlocks = { describe, highlight, markdown, renderDocument, wrap, message, responsePresentation };
})();

