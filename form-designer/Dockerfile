# Form Designer: designer + render API (FD_MODE=full) or render API only (FD_MODE=render)
#   docker build -t form-designer .
#   docker build --build-arg WITH_LIBREOFFICE=1 -t form-designer .   (exact Word import)
FROM node:22-bookworm-slim

ARG WITH_LIBREOFFICE=0
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fontconfig fonts-dejavu-core ca-certificates tini \
 && if [ "$WITH_LIBREOFFICE" = "1" ]; then apt-get install -y --no-install-recommends libreoffice-writer-nogui; fi \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .

ENV NODE_ENV=production \
    PORT=3700 \
    FD_MODE=full \
    FD_STORAGE=/app/storage \
    CHROME_PATH=/usr/bin/chromium \
    TZ=Asia/Jerusalem

# templates, customers and uploaded fonts live here: mount a volume
RUN chown -R node:node /app/storage
VOLUME /app/storage
USER node
EXPOSE 3700
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3700)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]
