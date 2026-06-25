# Storyteller AI Gateway — deploy from monorepo root on Railway.
# Railway: set root directory to repo root, dockerfile path apps/ai-gateway/Dockerfile

FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/ai-gateway/package.json ./apps/ai-gateway/
COPY packages/ai-gateway/package.json ./packages/ai-gateway/
COPY packages/analysis/package.json ./packages/analysis/
COPY packages/shared/package.json ./packages/shared/
COPY packages/transcription/package.json ./packages/transcription/

RUN npm ci --workspace=@storyteller/ai-gateway-service --include-workspace-root

COPY apps/ai-gateway ./apps/ai-gateway
COPY packages/ai-gateway ./packages/ai-gateway
COPY packages/analysis ./packages/analysis
COPY packages/shared ./packages/shared
COPY packages/transcription ./packages/transcription

WORKDIR /app/apps/ai-gateway

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
