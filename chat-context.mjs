// Bound repeated history without cutting code or editing the saved conversation.
export function chatTurns(context, history, prompt) {
  const recent = history.slice(-6);
  const kept = [];
  let remaining = 12000;
  for (let i = recent.length - 1; i >= 0; i--) {
    const { role, content } = recent[i];
    if (!['user', 'assistant'].includes(role) || typeof content !== 'string') break;
    if (content.length > remaining) break;
    kept.unshift({ role, content });
    remaining -= content.length;
  }
  // Keep complete exchanges when older user turns have been excluded.
  while (kept[0]?.role === 'assistant') kept.shift();
  return [
    { role: 'user', content: JSON.stringify(context) },
    ...(kept.length < history.length ? [{ role: 'user', content:
      'Se omitieron mensajes anteriores para ahorrar cuota. Si falta un dato de ellos, pídelo; no lo supongas.' }] : []),
    ...kept,
    { role: 'user', content: prompt },
  ];
}
