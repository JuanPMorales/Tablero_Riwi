import { tutorRules } from './tutor-rules.mjs';
import { redactAIText } from './ai-privacy.mjs';

export const tutorPolicy = [tutorRules, ...[process.env.RIWI_TUTOR_CONTEXT?.trim(), process.env.RIWI_TUTOR_SKILLS?.trim()]
  .filter(Boolean).map(value => redactAIText(value))]
  .filter(Boolean).join('\n\n');
