#! /bin/sh

set -xe

CURRENT_DIRECTORY="${0%/*}"

export PATH="${CURRENT_DIRECTORY}/development:$PATH"

termux-notification \
  --title "Хевронія" \
  --content "Starting development server..." \
  --priority high

npm run dev -w backend
