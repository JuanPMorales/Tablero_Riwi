import { guidePrompt } from './store.mjs';
import { profilePrivateValues, redactAIText } from './ai-privacy.mjs';

const title = 'Conversación de estudio';

// Account-scoped persistence, with filtering enforced at the storage boundary too.
export function privateChatDatabase(database) {
  return { ...database, clearTemporary() {},
    forAccount(account) {
      const base = database.forAccount(account);
      const privateValues = async () => profilePrivateValues(await base.readProfile());
      const history = async (id, step) => {
        const values = await privateValues();
        return (await base.chatHistory(id, step)).map(row => ({ ...row, content: redactAIText(row.content, values) }));
      };
      const guide = async (id, step, basic) => {
        const rows = await history(id, step);
        return rows.some((row, i) => row.role === 'assistant' && rows[i - 1]?.content === guidePrompt
          && row.content.startsWith(basic ? 'Guía del tablero\n\n' : 'Respuesta de IA\n\n')) ? rows : null;
      };
      return { ...base,
        async snapshot(...args) { return { ...await base.snapshot(...args), historyNotes: {},
          temporaryChat: false, notesDisabled: true, privateChatTitles: true }; },
        saveHistoryNote: async () => { throw Object.assign(new Error('Las notas personales están desactivadas para no guardar texto libre.'), { status: 403 }); },
        chatHistory: history, guideHistory: guide,
        async saveChat(id, step, prompt, answer, revision) {
          const values = await privateValues();
          const saved = await base.saveChat(id, step, redactAIText(prompt, values), redactAIText(answer, values), revision);
          return saved && history(id, step);
        },
        async saveGuide(id, step, basic, answer, revision) {
          const values = await privateValues();
          const saved = await base.saveGuide(id, step, basic, redactAIText(answer, values), revision);
          return saved && history(id, step);
        },
        createChat: (id, step) => base.createChat(id, step, title),
        async findChat(chat) { const value = await base.findChat(chat); return value && { ...value, title }; },
        listChats: async () => (await base.listChats()).map(value => ({ ...value, title })),
        legacyChatTitle: async (id, step) => await base.legacyChatTitle(id, step) ? title : undefined,
        renameChat: (id, step, chat) => base.renameChat(id, step, chat, title),
      };
    },
  };
}
