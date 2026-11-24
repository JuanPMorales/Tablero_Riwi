import { redactAIValue, redactAIText, assertAIQuestionSafe } from './ai-privacy.mjs';

// Include the whole current day once, with numeric pointers to the selected exercise.
export function lessonContext(lesson, { track, module, step = '', stepsDone = 0 }) {
  const [questIndex, stepIndex] = step.split('-').map(Number);
  const selected = step && lesson.quests[questIndex]?.[2]?.[stepIndex] !== undefined
    ? { quest: questIndex + 1, step: stepIndex + 1 } : null;
  return {
    track, module,
    day: { title: lesson.title, week: lesson.week, day: lesson.day,
      technology: lesson.technology, summary: lesson.summary },
    quests: lesson.quests.map(([title, context, steps, metadata], index) => ({
      number: index + 1, title, context, steps,
      ...Object.fromEntries(['requirements', 'criteria', 'deliverable']
        .filter(key => typeof metadata?.[key] === 'string')
        .map(key => [key, metadata[key]])),
    })),
    selected, stepsDone,
  };
}

// Bound repeated history without cutting code or editing the saved conversation.
export function chatTurns(context, history, prompt, privateValues = []) {
  assertAIQuestionSafe(prompt);
  const serialized = JSON.stringify(redactAIValue(context, privateValues));
  prompt = redactAIText(prompt, privateValues);
  const recent = history.slice(-6).map(({ role, content }) => ({ role,
    content: typeof content === 'string' ? redactAIText(content, privateValues) : content }));
  const kept = [];
  // A larger day leaves less room for repeated conversation, never less day content.
  // Character budget is an approximation, not the provider's token limit.
  let remaining = Math.max(2000, Math.min(12000, 20000 - serialized.length - prompt.length));
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
    { role: 'user', content: serialized },
    ...(kept.length < history.length ? [{ role: 'user', content:
      'Se omitieron mensajes anteriores para ahorrar cuota. Si falta un dato de ellos, pídelo; no lo supongas.' }] : []),
    ...kept,
    { role: 'user', content: prompt },
  ];
}
