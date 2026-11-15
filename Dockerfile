FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node *.mjs index.html login.html login.js google-callback.html google-callback.js lessons.json ui.js ui.css chat-blocks.js chat-runner.html chat-preview.html ./
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production RIWI_DB_PATH=/data/riwi.sqlite PORT=8765
CMD ["node", "server.mjs"]
