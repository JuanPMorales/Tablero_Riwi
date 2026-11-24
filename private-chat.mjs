import { randomUUID } from 'node:crypto';
import { guidePrompt } from './store.mjs';

// Temporary process memory only. No user-authored text is passed to database methods.
export function privateChatDatabase(database, { now = () => Date.now(), ttl = 15 * 60 * 1000 } = {}) {
  const accounts = new Map();
  const prune = () => { for (const [id, value] of accounts) if (value.expires <= now()) accounts.delete(id); };
  const timer = setInterval(prune, Math.min(ttl, 60000));
  timer.unref?.();
  function memory(account) {
    prune();
    if (!accounts.has(account)) {
      if (accounts.size >= 100) accounts.delete(accounts.keys().next().value);
      accounts.set(account, { expires: now() + ttl, rooms: new Map(), chats: new Map() });
    }
    const value = accounts.get(account);
    value.expires = now() + ttl;
    return value;
  }
  return { ...database, clearTemporary: account => accounts.delete(account),
    close() { clearInterval(timer); accounts.clear(); database.close(); },
    forAccount(account) {
      const base = database.forAccount(account);
      const room = (id, step) => {
        const state = memory(account), key = `${id}/${step}`;
        if (!state.rooms.has(key)) {
          if (state.rooms.size >= 12) state.rooms.delete(state.rooms.keys().next().value);
          state.rooms.set(key, { revision: 0, history: [] });
        }
        return state.rooms.get(key);
      };
      const history = async (id, step) => structuredClone(room(id, step).history);
      const save = async (id, step, prompt, answer, revision) => {
        const value = room(id, step);
        if (value.revision !== revision) return null;
        const created = new Date(now()).toISOString();
        value.history.push({ role: 'user', content: prompt, created }, { role: 'assistant', content: answer, created });
        while (value.history.length > 12 || (value.history.length > 2
          && value.history.reduce((n, row) => n + row.content.length, 0) > 24000)) value.history.splice(0, 2);
        return history(id, step);
      };
      const guide = async (id, step, basic) => {
        const rows = await history(id, step);
        return rows.some((row, i) => row.role === 'assistant' && rows[i - 1]?.content === guidePrompt
          && row.content.startsWith(basic ? 'Guía del tablero\n\n' : 'Respuesta de IA\n\n')) ? rows : null;
      };
      return { ...base,
        async snapshot(...args) { return { ...await base.snapshot(...args), historyNotes: {}, temporaryChat: true }; },
        saveHistoryNote: async () => { throw Object.assign(new Error('Las notas personales están desactivadas para no guardar texto libre.'), { status: 403 }); },
        chatHistory: history, chatRevision: async (id, step) => room(id, step).revision,
        saveChat: save, guideHistory: guide,
        async saveGuide(id, step, basic, answer, revision) {
          if (room(id, step).revision !== revision) return null;
          return await guide(id, step, basic) || save(id, step, guidePrompt, answer, revision);
        },
        async deleteChat(id, step, chat) {
          const value = room(id, step); value.history = []; value.revision++;
          if (chat) memory(account).chats.delete(chat);
          return value.revision;
        },
        async createChat(id, step) {
          const chat = randomUUID(), value = { id, step, chat, title: 'Conversación temporal', created: new Date(now()).toISOString() };
          const state = memory(account);
          if (state.chats.size >= 12) state.chats.delete(state.chats.keys().next().value);
          state.chats.set(chat, value); return { ...value };
        },
        findChat: async chat => { const value = memory(account).chats.get(chat); return value && { ...value }; },
        listChats: async () => {
          const value = memory(account);
          const implicit = [...value.rooms.entries()].flatMap(([key, entry]) => {
            const slash = key.indexOf('/'), step = key.slice(slash + 1);
            return entry.history.length && !step.includes('~') ? [{ id: Number(key.slice(0, slash)), step,
              title: 'Conversación temporal', created: entry.history[0].created }] : [];
          });
          return [...value.chats.values()].map(item => ({ ...item })).concat(implicit);
        },
        legacyChatTitle: async (id, step) => room(id, step).history.length ? 'Conversación temporal' : undefined,
        renameChat: async (id, step, chat) => chat ? memory(account).chats.has(chat) : room(id, step).history.length > 0,
        focus: (id, step) => base.focus(id, step),
      };
    },
  };
}
