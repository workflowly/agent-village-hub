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

# lib/paths.js is required unconditionally by memory.js, survival/tick.js,
# and appearance.js at import time. Include it at the correct relative path.
# (Functions in paths.js that reference non-existent dirs are never called in
# standalone mode since all bots are remote.)
RUN mkdir -p /app/lib
COPY lib/paths.js /app/lib/paths.js

# Data volume for village-tokens.json, state files, and logs
VOLUME ["/data"]

EXPOSE 8080

ENV NODE_ENV=production
ENV VILLAGE_DATA_DIR=/data
ENV VILLAGE_HUB_MODE=1

CMD ["node", "hub.js"]
