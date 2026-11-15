(() => {
  const fenceStart = /^ {0,3}(\x60{3,}|~{3,})\s*([^ \t]*)[^\n]*$/;
  const languageNames = { js: 'JavaScript', javascript: 'JavaScript', mjs: 'JavaScript',
    cjs: 'JavaScript', json: 'JSON', md: 'Markdown', markdown: 'Markdown',
    txt: 'Texto', text: 'Texto', plaintext: 'Texto' };

  function identify(text) {
    if (/^\s*(?:\{|\[)/.test(text)) {
      try { JSON.parse(text); return 'json'; } catch { /* May be JavaScript or prose. */ }
    }
    if (/^\s*<(?:!doctype html|html\b|[a-z][\w-]*(?:\s|>))/i.test(text)) return 'html';
    if (/^\s*(?:(?:const|let|var)\s+[$\w]+\s*=|(?:async\s+)?function\s|console\.\w+\(|for\s*\(|(?:if|while)\s*\()/.test(text)) return 'javascript';
    if (/^ {0,3}(?:#{1,6} |[-*+] |\d+\. |>\s)/m.test(text)) return 'markdown';
    return 'text';
  }

  function split(content) {
    const blocks = [];
    let prose = [], code, fence;
    function flushProse() {
      const text = prose.join('\n').replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '');
      const example = text.match(/^(.*\nEjemplo sencillo)\n([\s\S]+?)\n\n(Cómo comprobarlo\n[\s\S]+)$/s);
      if (example && identify(example[2]) === 'javascript') {
        blocks.push({ text: example[1], language: 'text' },
          { text: example[2], language: 'javascript' }, { text: example[3], language: 'text' });
      } else if (text.trim()) blocks.push({ text, language: identify(text) });
      prose = [];
    }
    for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
      if (fence) {
        if (new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}[ \\t]*$').test(line)) {
          const text = code.join('\n');
          blocks.push({ text, language: fence[2].toLowerCase() || identify(text), fenced: true });
          fence = undefined;
        } else code.push(line);
      } else {
        fence = line.match(fenceStart);
        if (fence) { flushProse(); code = []; }
        else prose.push(line);
      }
    }
    if (fence) {
      const text = code.join('\n');
      blocks.push({ text, language: fence[2].toLowerCase() || identify(text), fenced: true });
    } else flushProse();
    return blocks;
  }

  function wrap(text, name) {
    const language = name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() || 'text';
    const size = Math.max(2, ...Array.from(text.matchAll(/\x60+/g), match => match[0].length)) + 1;
    const fence = String.fromCharCode(96).repeat(size);
    return fence + language + '\n' + text + '\n' + fence;
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function button(label, action) {
    const node = element('button', label, 'secondary');
    node.type = 'button';
    node.onclick = action;
    return node;
  }

  function previewMarkdown(output, text) {
    let list;
    for (const line of text.split('\n')) {
      const heading = line.match(/^ {0,3}(#{1,6})\s+(.+)$/);
      const item = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
      if (item) {
        const tag = item[2] ? 'ol' : 'ul';
        if (list?.localName !== tag) {
          list = element(tag);
          if (item[2]) list.start = Number(item[2]);
          output.append(list);
        }
        list.append(element('li', item[3]));
      } else {
        list = undefined;
        if (heading) output.append(element('h' + heading[1].length, heading[2]));
        else if (line.trim()) output.append(element('p', line));
      }
    }
  }

  let stopRunning;
  function runJavaScript(code, done) {
    stopRunning?.('Se inició otra prueba.');
    const frame = element('iframe');
    frame.hidden = true;
    frame.title = 'Entorno aislado de JavaScript';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = '/chat-runner.html';
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
      finish([...lines, ...(error ? [error] : [])].join('\n') || 'La prueba terminó sin salida. Usa console.log para ver un valor.');
    }
    const timer = setTimeout(() => finish('No se recibió el resultado de la prueba.'), 7000);
    stopRunning = finish;
    window.addEventListener('message', onMessage);
    frame.onload = () => frame.contentWindow.postMessage({ code }, '*');
    document.body.append(frame);
  }

  function renderBlock({ text, language, fenced }, report) {
    const label = Object.hasOwn(languageNames, language) ? languageNames[language] : language.toUpperCase();
    const js = label === 'JavaScript';
    const json = language === 'json';
    const markdown = label === 'Markdown';
    const block = element('section', undefined, 'chat-block');
    const toolbar = element('div', undefined, 'row between chat-block-tools');
    const actions = element('div', undefined, 'row');
    const initial = element(fenced || js || json ? 'pre' : 'div', undefined, 'chat-block-source');
    if (initial.localName === 'pre') initial.append(element('code', text));
    else initial.textContent = text;

    async function copy(value) {
      try {
        await navigator.clipboard.writeText(value);
        report('Copiado.');
      } catch { report('Selecciona el contenido y cópialo con Ctrl+C.', true); }
    }
    const editor = element('div', undefined, 'chat-block-editor');
    editor.hidden = true;
    const field = element('textarea');
    field.rows = 7;
    field.maxLength = Math.max(text.length, 20000);
    field.value = text;
    field.setAttribute('aria-label', 'Editar bloque de ' + label);
    field.spellcheck = !js && !json;
    const output = element('div', undefined, 'chat-block-output');
    output.hidden = true;
    output.setAttribute('aria-live', 'polite');
    const toggle = button('Abrir editor', () => {
      editor.hidden = !editor.hidden;
      initial.hidden = !editor.hidden;
      toggle.setAttribute('aria-expanded', String(!editor.hidden));
      toggle.textContent = editor.hidden ? 'Abrir editor' : 'Cerrar editor';
      if (!editor.hidden) field.focus();
    });
    toggle.setAttribute('aria-expanded', 'false');
    actions.append(button('Copiar', () => copy(editor.hidden ? text : field.value)), toggle);
    toolbar.append(element('strong', label), actions);
    const editorActions = element('div', undefined, 'row');
    const check = button(js ? 'Ejecutar JavaScript' : json ? 'Validar JSON' : 'Ver vista previa', () => {
      output.hidden = false;
      output.replaceChildren();
      const value = field.value;
      if (js && value.length <= 20000) {
        output.textContent = 'Ejecutando…';
        check.disabled = true;
        runJavaScript(value, result => {
          output.replaceChildren(element('pre', result));
          check.disabled = false;
        });
      } else if (js) output.textContent = 'La prueba admite hasta 20.000 caracteres.';
      else if (json) {
        try { output.append(element('pre', JSON.stringify(JSON.parse(value), null, 2))); }
        catch (error) { output.textContent = 'JSON inválido: ' + error.message; }
      } else if (markdown) previewMarkdown(output, value);
      else output.append(element('pre', value));
      if (!output.textContent.trim()) output.textContent = 'El bloque está vacío.';
    });
    editorActions.append(check, button('Restaurar original', () => {
      field.value = text;
      output.hidden = true;
    }));
    editor.append(field, editorActions, output);
    block.append(toolbar, initial, editor);
    return block;
  }

  globalThis.RiwiChatBlocks = { split, wrap, renderBlock };
})();
