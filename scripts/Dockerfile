# pooppress in a container: one process, one volume.
#
#   docker build -t pooppress -f scripts/Dockerfile .
#   docker run -it -v $PWD/data:/app/data pooppress pooppress init
#   docker run -d -p 3000:3000 -v $PWD/data:/app/data -v $PWD/output:/app/output pooppress
FROM node:22-slim

# better-sqlite3 and sharp ship prebuilt binaries, so no compiler is needed.
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY bin ./bin
COPY server ./server
COPY themes ./themes
COPY admin/dist ./admin/dist
COPY admin/src/markup ./admin/src/markup

RUN ln -s /app/bin/pooppress.js /usr/local/bin/pooppress

# Everything that survives a restart lives here; mount it.
VOLUME ["/app/data", "/app/output"]
ENV PORT=3000
EXPOSE 3000

USER node
CMD ["pooppress", "start"]
