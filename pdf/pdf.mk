# Optional PDF build. Include this file in the Makefile of a product
# repository:
#
#   DSC ?= dsc-style-bundle
#   -include $(DSC)/pdf/pdf.mk
#
# and use $(PDF_ANTORA_ARGS) in the site build targets:
#
#   npx antora $(PDF_ANTORA_ARGS) ... local-product-playbook.yml
#
# pdf-options.yml in the repository root activates the PDF build. Without that
# file, or with "mode: none", nothing changes. Two runs:
#
# - make pdf (or make local-pdf) builds the PDFs into build/pdf/.
# - In mode deliverable, the site build adds the PDFs from build/pdf/ to the
#   site, and the pages link to them. Run make pdf first.

DSC ?= dsc-style-bundle
PDF_OPTIONS ?= pdf-options.yml
PDF_TOOLS ?= tmp/pdf-tools
PDF_PLAYBOOK ?= local-product-playbook.yml
PDF_SITE_DIR ?= build/site
PDF_DIR := $(abspath $(DSC)/pdf)
PDF_MODE := $(shell sed -n 's/^mode:[[:space:]]*\([a-z]*\).*/\1/p' $(PDF_OPTIONS) 2>/dev/null)
# The site URL for the PDF run: site_url in $(PDF_OPTIONS). With it, a link to
# a page that is not in the PDF becomes a web link. The site build does not
# use it.
PDF_SITE_URL := $(shell sed -n 's/^site_url:[[:space:]]*\([^[:space:]#]*\).*/\1/p' $(PDF_OPTIONS) 2>/dev/null)
# The folder of the PDFs: output_dir in $(PDF_OPTIONS), or build/pdf.
PDF_OUT := $(or $(shell sed -n 's/^output_dir:[[:space:]]*\([^[:space:]#]*\).*/\1/p' $(PDF_OPTIONS) 2>/dev/null),build/pdf)
PDF_EXTENSION := --extension $(PDF_DIR)/antora-pdf.js
# mermaid-cli uses the installed Chromium if there is one.
PDF_CHROMIUM := $(shell command -v chromium chromium-browser google-chrome google-chrome-stable 2>/dev/null | head -1)
# The official SUSE fonts. Change the version and the checksum together.
PDF_FONT_VERSION := v2.001
PDF_FONT_URL := https://github.com/SUSE/suse-font/releases/download/$(PDF_FONT_VERSION)/suse-font-$(PDF_FONT_VERSION).zip
PDF_FONT_SHA256 := 5cfa32328cc408a31459fdeacee623684d82ff2b3d84ca80cf5b4ff7b8ff8221
PDF_FONT_FILES := SUSE-Regular SUSE-Bold SUSE-RegularItalic SUSE-BoldItalic \
	SUSEMono-Regular SUSEMono-Bold SUSEMono-RegularItalic SUSEMono-BoldItalic
# Noto Sans fonts for Japanese (JP) and Chinese (SC), only for the languages in
# $(PDF_OPTIONS). google/fonts has variable fonts only; pdf-tools makes static
# Regular and Bold fonts with fonttools. Change the commit and the checksums
# together.
PDF_LANGS := $(shell sed -n 's/^languages:[[:space:]]*\[\(.*\)\].*/\1/p' $(PDF_OPTIONS) 2>/dev/null | tr ',' ' ')
PDF_NOTO_COMMIT := 6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec
PDF_NOTO_ja := JP
PDF_NOTO_zh := SC
PDF_NOTO_SHA256_JP := c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f
PDF_NOTO_SHA256_SC := a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da
PDF_FONTTOOLS_VERSION := 4.68.0
PDF_CJK_FONTS := $(foreach l,$(filter ja zh,$(PDF_LANGS)),$(PDF_TOOLS)/fonts/NotoSans$(PDF_NOTO_$(l))-Regular.ttf)

# The site build adds the links only in mode deliverable. It needs no tools.
ifeq ($(PDF_MODE),deliverable)
PDF_ANTORA_ARGS := $(PDF_EXTENSION)
endif

.PHONY: pdf-tools pdf local-pdf pdf-summary

# Install the Ruby gems, mermaid-cli, and the fonts in $(PDF_TOOLS). Install
# again only when the lock files or the font versions change.
pdf-tools: $(PDF_TOOLS)/.installed $(PDF_TOOLS)/fonts/.$(PDF_FONT_VERSION) $(PDF_CJK_FONTS)

$(PDF_TOOLS)/.installed: $(PDF_DIR)/package-lock.json $(PDF_DIR)/Gemfile.lock
	mkdir -p $(PDF_TOOLS)
	cp $(PDF_DIR)/package.json $(PDF_DIR)/package-lock.json $(PDF_TOOLS)/
	cd $(PDF_TOOLS) && $(if $(PDF_CHROMIUM),PUPPETEER_SKIP_DOWNLOAD=1) npm ci --no-fund --no-audit --silent
	BUNDLE_GEMFILE=$(PDF_DIR)/Gemfile BUNDLE_PATH=$(abspath $(PDF_TOOLS))/bundle BUNDLE_FROZEN=true \
		bundle install --quiet
	touch $@

$(PDF_TOOLS)/fonts/.$(PDF_FONT_VERSION):
	rm -rf $(PDF_TOOLS)/fonts && mkdir -p $(PDF_TOOLS)/fonts
	curl -fsSL -o $(PDF_TOOLS)/suse-font.zip $(PDF_FONT_URL)
	echo "$(PDF_FONT_SHA256)  $(PDF_TOOLS)/suse-font.zip" | sha256sum -c --quiet -
	unzip -q -j -o $(PDF_TOOLS)/suse-font.zip suse-font-$(PDF_FONT_VERSION)/OFL.txt \
		$(foreach f,$(PDF_FONT_FILES),suse-font-$(PDF_FONT_VERSION)/fonts/ttf/$(f).ttf) -d $(PDF_TOOLS)/fonts
	rm $(PDF_TOOLS)/suse-font.zip
	touch $@

$(PDF_TOOLS)/venv/.fonttools-$(PDF_FONTTOOLS_VERSION):
	python3 -m venv $(PDF_TOOLS)/venv
	$(PDF_TOOLS)/venv/bin/pip install --quiet fonttools==$(PDF_FONTTOOLS_VERSION)
	touch $@

$(PDF_TOOLS)/fonts/NotoSans%-Regular.ttf: | $(PDF_TOOLS)/fonts/.$(PDF_FONT_VERSION) $(PDF_TOOLS)/venv/.fonttools-$(PDF_FONTTOOLS_VERSION)
	curl -fsSL -o $(@D)/NotoSans$*-var.ttf \
		https://github.com/google/fonts/raw/$(PDF_NOTO_COMMIT)/ofl/notosans$(shell echo $* | tr A-Z a-z)/NotoSans$*%5Bwght%5D.ttf
	echo "$(PDF_NOTO_SHA256_$*)  $(@D)/NotoSans$*-var.ttf" | sha256sum -c --quiet -
	curl -fsSL -o $(@D)/OFL-NotoSans$*.txt \
		https://github.com/google/fonts/raw/$(PDF_NOTO_COMMIT)/ofl/notosans$(shell echo $* | tr A-Z a-z)/OFL.txt
	$(PDF_TOOLS)/venv/bin/fonttools varLib.instancer -q --update-name-table $(@D)/NotoSans$*-var.ttf wght=700 \
		-o $(@D)/NotoSans$*-Bold.ttf
	$(PDF_TOOLS)/venv/bin/fonttools varLib.instancer -q --update-name-table $(@D)/NotoSans$*-var.ttf wght=400 -o $@
	rm $(@D)/NotoSans$*-var.ttf

# The PDF run. Its site goes to $(PDF_TOOLS)/site and is not used. If
# $(PDF_SITE_DIR) exists, the PDFs are copied into it too.
pdf:
ifeq ($(filter local deliverable,$(PDF_MODE)),)
	@echo "No PDF: there is no $(PDF_OPTIONS), or its mode is none."
else
	$(MAKE) pdf-tools
	mkdir -p tmp
	ANTORA_PDF_RUN=pdf ANTORA_PDF_SITE_DIR=$(PDF_SITE_DIR) npx antora --stacktrace --log-format=pretty \
		--log-level=info $(PDF_EXTENSION) $(if $(PDF_SITE_URL),--url $(PDF_SITE_URL)) --to-dir $(PDF_TOOLS)/site \
		$(PDF_PLAYBOOK) 2>&1 | tee tmp/pdf-build.log
	@$(MAKE) --no-print-directory pdf-summary
endif

# List the PDFs in $(PDF_OUT), with the number of pages if pdfinfo is installed.
pdf-summary:
	@echo ""
	@echo "PDFs in $(PDF_OUT)/ (log: tmp/pdf-build.log):"
	@found=; for f in $(PDF_OUT)/*.pdf; do \
		[ -e "$$f" ] || continue; found=1; \
		pages=$$(pdfinfo "$$f" 2>/dev/null | sed -n 's/^Pages:[[:space:]]*//p'); \
		echo "  $$f  ($${pages:+$$pages pages, }$$(du -h "$$f" | cut -f1))"; \
	done; [ -n "$$found" ] || echo "  none"

local-pdf:
	$(MAKE) pdf PDF_PLAYBOOK=local-product-playbook.yml
