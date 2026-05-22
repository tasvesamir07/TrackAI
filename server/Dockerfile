# Track AI Server - Production Dockerfile
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
