FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY ledger.mjs ./
COPY contracts ./contracts
USER node
CMD ["node", "ledger.mjs"]
