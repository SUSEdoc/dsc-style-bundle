# PDF build

This folder contains an optional PDF build for product documentation with releases. The PDF build is off until a product repository activates it.

For each release and language, the build makes one PDF: the landing pages of the release, then each component version that the release pins. Web sites do not publish this folder, because it is not in `supplemental-files/`.

## Activate the PDF build

1. In the product repository, add `pdf-options.yml` in the repository root. Refer to [Options](#options).
2. In the product `Makefile`, include `pdf.mk`:

   ```make
   DSC ?= dsc-style-bundle
   -include $(DSC)/pdf/pdf.mk
   ```

3. In the site build targets, add `$(PDF_ANTORA_ARGS)` to the Antora command:

   ```make
   npx antora $(PDF_ANTORA_ARGS) ... local-product-playbook.yml
   ```

Without `pdf-options.yml`, or with `mode: none`, the build does not change.

## Two runs

The PDF build and the site build are different runs. They use the same playbook and the same `pdf-options.yml`.

1. The PDF run (`make pdf` or `make local-pdf`) writes the PDFs and `pdf-manifest.json` to `build/pdf/`. The manifest gives the URL of each PDF and the named destination of each page in it. This run needs the PDF tools.
2. The site run (`make product-local`, `make product-remote`) in mode `deliverable` reads the manifest. It adds the PDFs to the site and a **PDF** link to the toolbar of each page in a PDF. This run does not need the PDF tools.

Do the PDF run first. Without a manifest, the site run gives a warning and adds no links.

## Modes

| Mode | Site build | `make pdf`, `make local-pdf` |
|---|---|---|
| no file, or `none` | No change. | No PDF. |
| `local` | No change. | PDFs in `build/pdf/`. If `build/site/` exists, the PDFs are also copied into it. |
| `deliverable` | Adds the PDFs from `build/pdf/` and the toolbar links. | The same as `local`. |

In CI, use mode `deliverable`, and run `make pdf PDF_PLAYBOOK=remote-product-playbook.yml` before `make product-remote`.

## Make targets

- `make pdf-tools`: installs the tools in `tmp/pdf-tools/`. It installs again only when a lock file or the font version changes.
- `make pdf`: the PDF run with `PDF_PLAYBOOK` (default `local-product-playbook.yml`). The site of this run goes to `tmp/pdf-tools/site/` and is not used.
- `make local-pdf`: `make pdf` with `local-product-playbook.yml`.
- `make pdf-summary`: lists the PDFs in `build/pdf/` (or `output_dir`), with the number of pages and the size. `make pdf` runs it at the end.

To test a dsc-style-bundle checkout that is not the submodule, set `DSC`, for example `make local-pdf DSC=../dsc-style-bundle`.

## Options

```yaml
mode: local                     # none, local, or deliverable
release_config: suse-security-release-config.yml   # the release config of release-url-layout
releases: latest                # latest (newest release that is not a prerelease), all, or a list
languages: [en, ja, zh]         # one PDF for each language
fallback_language: en           # for components without a nav in the language
print:
  show_urls: true               # print the URL after each web link
  printed_date: true            # "Printed <date> <time>" on the title page and in the footer
keep_source: false              # keep the assembled AsciiDoc file, for debugging
attributes: {}                  # more AsciiDoc attributes for the PDF
```

The environment variable `ANTORA_PDF_MODE` overrides `mode`.

## How it works

The code is in [`antora-pdf.js`](antora-pdf.js). `pdf.mk` adds it to the Antora command with `--extension`, so playbooks do not change. `ANTORA_PDF_RUN=pdf` selects the PDF run.

The PDF run uses `@antora/pdf-extension` from the product repository:

1. `contentAggregated`: `releaseNav` makes a nav file for each release and language in the landing copy of the release. The site menu does not show it.
2. `contentClassified`: replaces attributes in the xref targets of the landing pages, for example `{landing-admc-ref}`. The assembler resolves xrefs before it replaces attributes.
3. `navigationBuilt`: one assembler run for each language. `takeExports` keeps each PDF, its URL `/<prefix>/<release>/<lang>/<prefix>-<release>-<lang>.pdf`, and the named destination of each page.
4. `beforePublish`: writes the PDFs and `pdf-manifest.json` to `build/pdf/`.

The site run (`registerLinks`) sets the page attributes `page-pdf-url`, `page-pdf-anchor`, and `page-pdf-title` from the manifest, and adds the PDFs to the site.

The toolbar link is in `supplemental-files/rancher/partials/toolbar.hbs`. It opens the PDF at the page with `#nameddest=<anchor>`.

## Tools and fonts

| Item | Source | Pinned in |
|---|---|---|
| asciidoctor-pdf, asciidoctor-diagram, rouge | Ruby gems | `Gemfile`, `Gemfile.lock` |
| mermaid-cli | npm | `package.json`, `package-lock.json` |
| SUSE and SUSE Mono fonts | [SUSE/suse-font](https://github.com/SUSE/suse-font) release | `pdf.mk`: `PDF_FONT_VERSION`, `PDF_FONT_SHA256` |
| Noto Sans JP and SC fonts (only for `ja` and `zh`) | [google/fonts](https://github.com/google/fonts), variable fonts | `pdf.mk`: `PDF_NOTO_COMMIT`, `PDF_NOTO_SHA256_*` |
| fonttools (makes static Noto fonts) | PyPI, in `tmp/pdf-tools/venv/` | `pdf.mk`: `PDF_FONTTOOLS_VERSION` |

- Keep mermaid-cli on the mermaid major version of `partials/header-scripts.hbs`. Then the PDF diagrams and the web diagrams are the same.
- mermaid diagrams are PNG files at 3 times the size. asciidoctor-pdf does not show the labels of mermaid SVG files.
- The theme is `suse-theme.yml`. The logo is `images/suse-logo.svg`.
- The fonts are not in a repository. `make pdf-tools` downloads them to `tmp/pdf-tools/fonts/`. For `ja` and `zh`, it makes static Regular and Bold Noto fonts (about 11 MB for JP, 21 MB for SC).
- PDFs embed only the characters that they use. The page content is compressed.

## Languages

- Each language has its own PDF. A component without a nav in the language uses the nav of `fallback_language`, so a PDF can have more than one language.
- In a mixed-language PDF, a nav xref to a page in the fallback language goes to the page in the PDF language, if there is one.
- A page can be in more than one PDF. Its toolbar link goes to the PDF in the language of the page, else to the PDF of the fallback language.
- For `ja` and `zh`, `antora-pdf.js` writes a theme in `tmp/pdf-tools/` that adds the Noto font as fallback font, and sets `scripts=cjk` for line breaks between characters.

You must have Ruby with Bundler, Node.js, `curl`, `unzip`, and `sha256sum`. mermaid-cli uses the installed Chromium. If there is no Chromium, npm downloads one.

## Limitations

- The build supports only products with a release config.
- Only `ja` and `zh` have CJK fonts. Other CJK languages, for example `ko`, need a font in `pdf.mk` and `antora-pdf.js`.
- In a mixed-language PDF, a link in page text to a page of the fallback language stays text, if that page is not in the PDF.
- An xref to a page that is not in the PDF nav stays text.
- asciidoctor-pdf cuts a table cell that is longer than one page. The theme uses a 9 pt table font, so that the long cells of the CRD references fit.

## Follow-ups

- The CRD references are generated. Their template puts long field descriptions, with JSON examples, in table rows. Change the template in the upstream repository to show each field as a description list or a subsection. This is better for the web and for the PDF. Then the 9 pt table font is not necessary.
- The generated CRD references show `Optional: \{}` in the Validation column. Do a check of the escape in the template.
- SUSE and SUSE Mono do not have some symbols in the content: box-drawing characters in directory trees, check marks, circled numbers, and emoji. Add a fallback font for symbols, for example DejaVu Sans Mono for code.
- The tooltip of the toolbar link is in English for all languages.
- Only xref targets in the landing pages can use attributes.
