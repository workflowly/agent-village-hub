# Village Hub — standalone Docker image
#
# Build from project root:
#   docker build -f village/Dockerfile -t village-hub .
#
# Or with docker compose:
#   cd village && docker compose up

FROM node:22-alpine

WORKDIR /app/village

# Install dependencies first (layer cache)
COPY village/package*.json ./
RUN npm ci --omit=dev

# Copy village source
COPY village/ ./

# Data volume for village-tokens.json, state files, and logs
VOLUME ["/data"]

EXPOSE 8080

ENV NODE_ENV=production
ENV VILLAGE_DATA_DIR=/data

CMD ["node", "hub.js"]
