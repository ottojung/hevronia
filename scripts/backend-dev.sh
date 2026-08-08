#! /bin/sh

set -xe

CURRENT_DIRECTORY="${0%/*}"

export PATH="${CURRENT_DIRECTORY}/development:$PATH"

npm run dev -w backend
