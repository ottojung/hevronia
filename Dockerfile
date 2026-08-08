FROM node:26.3
WORKDIR /workspace
RUN apt-get update -y
RUN apt-get install -y rsync git
COPY scripts/development/termux-notification /usr/local/bin/termux-notification
COPY scripts/development/termux-wifi-connectioninfo /usr/local/bin/termux-wifi-connectioninfo
COPY scripts/development/hevronia-daily-tasks /usr/local/bin/hevronia-daily-tasks
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY docs/package.json ./docs/
COPY tools/eslint-plugin-hevronia/package.json ./tools/eslint-plugin-hevronia/
RUN npm ci
COPY . .
ARG HEVRONIA_ALLOW_RELEASE_BLOCKERS
RUN npm run build
RUN sh scripts/link-targeted "$PWD" /usr/local
ENTRYPOINT [ "hevronia" ]
