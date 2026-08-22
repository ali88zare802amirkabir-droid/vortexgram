FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=1458
EXPOSE 1458

CMD ["node", "server.js"]