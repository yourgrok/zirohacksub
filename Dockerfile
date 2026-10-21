# Single deployable service: Express API + built React console + mock listing sites.
# Default reader is plain HTTP (no browser) so it fits a free host (e.g. Render free web service).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production READER_MODE=http PORT=3000
COPY package*.json ./
# build tools only needed if better-sqlite3 has no prebuilt binary for the platform
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --include=dev \
    && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm run build && npm prune --omit=dev
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
