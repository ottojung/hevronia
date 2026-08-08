
PREFIX = /usr/local

all: install

install: dist/packages-token
	sh scripts/install-post-npm $(PREFIX)

dist/packages-token: package.json package-lock.json backend/package.json docs/package.json tools/eslint-plugin-hevronia/package.json
	npm ci
	mkdir -p -- dist/
	touch "$@"

uninstall:
	sh scripts/uninstall $(PREFIX)

.PHONY: all install uninstall
.SECONDARY:
