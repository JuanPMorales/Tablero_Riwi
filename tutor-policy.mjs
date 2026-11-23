import { tutorRules } from './tutor-rules.mjs';

export const tutorPolicy = [tutorRules, process.env.RIWI_TUTOR_CONTEXT?.trim(), process.env.RIWI_TUTOR_SKILLS?.trim()]
  .filter(Boolean).join('\n\n');
