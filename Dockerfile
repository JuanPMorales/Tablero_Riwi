FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node *.mjs index.html lessons.json ui.js ui.css ./
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production RIWI_DB_PATH=/data/riwi.sqlite PORT=8765
CMD ["node", "server.mjs"]
