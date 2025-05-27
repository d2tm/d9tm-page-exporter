SHELL := /bin/bash -o pipefail

NEWSLETTERS=newsletters
NEWSLETTERS_PDF=$(NEWSLETTERS)/pdf

.PHONY: test test-* format build

format:
	pushd $(NEWSLETTERS) && prettier --write download.js && popd
	gofmt -w .

install-ubuntu-libs:
	sudo add-apt-repository -y ppa:longsleep/golang-backports
	sudo apt update -y
	curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
	sudo apt-get install -y nodejs libatk1.0-0 libc6 libcairo2 \
							libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 \
							libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 \
							libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
							libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
							libxss1 libxtst6 ca-certificates fonts-liberation libnss3 lsb-release \
							xdg-utils wget ca-certificates

install-npm-tools:
	npm install --save-dev puppeteer
	npm install --save-dev node-fetch
	npm install -g prettier
	npm install -g node-fetch

install-tools: install-ubuntu-libs install-npm-tools

download-newsletters:
	rm -Rf output/$(NEWSLETTERS) reports/$(NEWSLETTERS)
	mkdir -p output/$(NEWSLETTERS)
	pushd $(NEWSLETTERS) && node download.js && popd
	pushd $(NEWSLETTERS_PDF) && go run main.go && popd

test: download-newsletters




