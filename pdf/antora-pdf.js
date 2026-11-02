'use strict'

// Antora extension: the optional PDF build of a release.
//
// It reads pdf-options.yml in the repository root. Without that file, or with
// "mode: none", it does nothing. pdf.mk adds this extension to the Antora
// command with --extension, so playbooks need no change. It has two runs:
//
// - The PDF run (ANTORA_PDF_RUN=pdf, make pdf or make local-pdf). For each
//   selected release and language, it makes one PDF: the landing pages of the
//   release, then each component version that the release pins. It writes the PDFs and pdf-manifest.json to build/pdf/. The site of this run
//   is not used.
// - The site run, in mode deliverable only. It reads pdf-manifest.json, adds
//   the PDFs to the site, and gives each page in a PDF the page-pdf-url,
//   page-pdf-anchor, and page-pdf-title attributes for the toolbar link. It
//   needs no PDF tools.
//
// The release structure comes from the release config of the
// release-url-layout extension in product-docs-common.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')

const PDF_DIR = __dirname

module.exports.register = function ({ config = {}, playbook }) {
  const logger = this.getLogger('antora-pdf')
  // pdf-options.yml is in the repository root: next to the playbook, or in
  // the folder where Antora runs.
  const name = config.optionsFile || 'pdf-options.yml'
  const optionsFile = [playbook.dir, process.cwd()].map((dir) => path.resolve(dir, name)).find((f) => fs.existsSync(f))
  if (!optionsFile) return logger.info(`no ${name}: no PDF`)
  const repoDir = path.dirname(optionsFile)
  // Load the packages of the product repository, not of this folder.
  const requireFromRepo = createRequire(path.join(repoDir, 'package.json'))
  const options = requireFromRepo('js-yaml').load(fs.readFileSync(optionsFile, 'utf8')) || {}
  const mode = process.env.ANTORA_PDF_MODE || options.mode || 'none'
  if (mode === 'none') return logger.info('mode none: no PDF')
  if (!['local', 'deliverable'].includes(mode)) throw new Error(`antora-pdf: unknown mode ${mode} in ${optionsFile}`)
  const outDir = path.resolve(repoDir, options.output_dir || 'build/pdf')
  const manifestFile = path.join(outDir, 'pdf-manifest.json')
  if (process.env.ANTORA_PDF_RUN !== 'pdf') {
    if (mode === 'deliverable') registerLinks.call(this, logger, outDir, manifestFile)
    return
  }

  const toolsDir = path.resolve(repoDir, process.env.ANTORA_PDF_TOOLS || options.tools_dir || 'tmp/pdf-tools')
  const mmdc = path.join(toolsDir, 'node_modules/.bin/mmdc')
  const fontsDir = path.join(toolsDir, 'fonts')
  if (!fs.existsSync(mmdc) || !fs.existsSync(path.join(fontsDir, 'SUSE-Regular.ttf'))) {
    throw new Error(`antora-pdf: no PDF tools in ${toolsDir}. Run: make pdf-tools`)
  }
  Object.assign(process.env, {
    BUNDLE_GEMFILE: path.join(PDF_DIR, 'Gemfile'),
    BUNDLE_PATH: path.join(toolsDir, 'bundle'),
    BUNDLE_FROZEN: 'true',
  })

  const languages = [].concat(options.languages || ['en'])
  const fallback = options.fallback_language || 'en'
  // Languages that need a CJK font as fallback font, and line breaks between
  // characters (scripts=cjk). pdf.mk installs the fonts.
  const CJK_FONTS = { ja: 'NotoSansJP', zh: 'NotoSansSC' }
  const print = { show_urls: true, printed_date: true, ...options.print }
  const printedAt = formatNow()
  const mermaidFiles = writeMermaidFiles(toolsDir, fontsDir)
  const themes = {}
  for (const lang of languages.filter((l) => CJK_FONTS[l])) {
    const font = CJK_FONTS[lang]
    if (!fs.existsSync(path.join(fontsDir, `${font}-Regular.ttf`))) {
      throw new Error(`antora-pdf: no ${font} font for ${lang} in ${fontsDir}. Run: make pdf-tools`)
    }
    themes[lang] = writeCjkTheme(toolsDir, lang, font)
  }
  const pdfFiles = [] // { lang, release, outPath, contents, pages }
  const assemblerConfigs = [] // filled in when the releases are known
  let plan // { prefix, landing, releases: [{ release, bucketVersion }] }

  // Step 1: the PDF nav of each release and language, in the landing copy of
  // the release. The site menu does not list it.
  this.once('contentAggregated', ({ contentAggregate }) => {
    plan = planReleases(contentAggregate, options, requireFromRepo('js-yaml'))
    const names = plan.releases.map(({ release }) => `${release.version}@${plan.landing}`)
    for (const cfg of assemblerConfigs) cfg.componentVersions = names
    const navAttributes = { ...playbook.asciidoc?.attributes }
    for (const { release, bucket } of plan.releases) {
      for (const lang of languages) {
        const nav = releaseNav(contentAggregate, plan, release, bucket, lang, fallback, navAttributes)
        const template =
          bucket.files.find((f) => f.path === `modules/${lang}/nav.adoc`) ||
          bucket.files.find((f) => f.path === `modules/${fallback}/nav.adoc`)
        if (!template) {
          logger.warn(`no nav for ${lang} or ${fallback} in ${bucket.version}@${bucket.name}: no ${lang} PDF`)
          continue
        }
        const file = template.clone({ deep: false })
        const relPath = `modules/${lang}/pdf-release-nav.adoc`
        file.src = { ...template.src, path: relPath, basename: 'pdf-release-nav.adoc', stem: 'pdf-release-nav' }
        delete file.src.abspath
        file.path = relPath
        file.contents = Buffer.from(nav)
        bucket.files.push(file)
      }
      // The landing copies share one descriptor, and each copy has its own nav
      // file with the same path. One assembler profile for each language.
      const origin = [...(bucket.origins || [])][0]
      if (origin?.descriptor) {
        origin.descriptor.ext = {
          ...origin.descriptor.ext,
          assembler: languages.map((lang) => ({ profile: lang, nav: [`modules/${lang}/pdf-release-nav.adoc`] })),
        }
      }
    }
  })

  // Step 2: the assembler resolves xrefs on the raw source, so it cannot
  // resolve a target that is built from attributes, for example
  // xref:{landing-admc-ref}admission-controller:en:introduction.adoc[].
  // Replace these references in the landing copy of each release.
  this.once('contentClassified', ({ contentCatalog }) => {
    for (const { release } of plan.releases) {
      const files = contentCatalog
        .getFiles()
        .filter((f) => f.src.component === plan.landing && f.src.version === release.version && f.contents)
      const values = {}
      for (const [name, version] of Object.entries(release.components)) values[`release-${name}-version`] = version
      for (const f of files) {
        for (const m of f.contents.toString().matchAll(/^:([\w-]+): \{(release-[\w-]+-version)\}@$/gm)) {
          if (m[2] in values) values[m[1]] = values[m[2]] + '@'
        }
      }
      const rx = new RegExp(`\\{(${Object.keys(values).join('|')})\\}`, 'g')
      for (const f of files) {
        if (!f.src.relative?.endsWith('.adoc')) continue
        const text = f.contents.toString()
        const out = text.replace(/xref:[^[\s]*\[/g, (m) => m.replace(rx, (_, n) => values[n]))
        if (out !== text) f.contents = Buffer.from(out)
      }
    }
  })

  // Step 3: one assembler run for each language. After each run, take the
  // PDFs out of the content catalog (each language makes an export with the
  // same name), and keep the page anchors.
  const { register: registerPdfExtension } = requireFromRepo('@antora/pdf-extension')
  for (const lang of languages) {
    const configSource = assemblerConfig(lang)
    assemblerConfigs.push(configSource)
    // asciidoctor-diagram writes the diagram images to the folder of the
    // assembly file. The assembler does not make that folder.
    this.once('navigationBuilt', () => {
      for (const { release } of plan.releases) {
        fs.mkdirSync(path.join(configSource.build.dir, plan.landing, release.version, '_exports'), { recursive: true })
      }
    })
    registerPdfExtension.call(this, { config: { configSource } })
    this.once('navigationBuilt', ({ contentCatalog }) => takeExports(contentCatalog, lang))
  }

  // Step 4: write the PDFs and the manifest to build/pdf/. If the site of an
  // earlier site run is there (ANTORA_PDF_SITE_DIR), copy the PDFs into it too.
  this.once('beforePublish', async () => {
    fs.rmSync(outDir, { recursive: true, force: true })
    fs.mkdirSync(outDir, { recursive: true })
    const siteDir = process.env.ANTORA_PDF_SITE_DIR && path.resolve(repoDir, process.env.ANTORA_PDF_SITE_DIR)
    const manifest = { printedAt, fallback, pdfs: [] }
    for (const pdf of pdfFiles) {
      // The assembler gives the PDF as a stream that reads its build folder.
      const contents = await toBuffer(pdf.contents)
      const file = path.basename(pdf.outPath)
      fs.writeFileSync(path.join(outDir, file), contents)
      if (siteDir && fs.existsSync(siteDir)) {
        fs.mkdirSync(path.dirname(path.join(siteDir, pdf.outPath)), { recursive: true })
        fs.writeFileSync(path.join(siteDir, pdf.outPath), contents)
      }
      const { lang, release, outPath, title, pages } = pdf
      manifest.pdfs.push({ file, lang, release, outPath, title, pages })
      logger.info(`PDF: ${path.join(outDir, file)} (${Object.keys(pages).length} pages)`)
    }
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1) + '\n')
  })

  function assemblerConfig (lang) {
    const attributes = {
      'source-highlighter': 'rouge',
      icons: 'font',
      // Compress the page content. CJK text without compression is very large.
      compress: '',
      'page-origin-branch': '',
      'pdf-theme': themes[lang] || path.join(PDF_DIR, 'suse-theme.yml'),
      ...(themes[lang] && { scripts: 'cjk' }),
      lang,
      'pdf-themesdir': PDF_DIR,
      'pdf-fontsdir': `${fontsDir};GEM_FONTS_DIR`,
      'printed-at': print.printed_date ? printedAt : '',
      // The title page shows revdate. Soft set (@), so that pages can still
      // set their own revdate.
      revdate: print.printed_date ? `Printed ${printedAt}@` : undefined,
      'mermaid-format': 'png',
      'mermaid-scale': 3,
      'mermaid-config': path.join(PDF_DIR, 'mermaid/mermaid-config.json'),
      'mermaid-css': mermaidFiles.css,
      'mermaid-puppeteer-config': mermaidFiles.puppeteer,
      mmdc,
      ...(options.attributes || {}),
    }
    if (print.show_urls) attributes['show-link-uri'] = ''
    for (const [k, v] of Object.entries(attributes)) if (v === undefined) delete attributes[k]
    return {
      componentVersions: [], // set in step 1
      assembly: { profile: lang, rootLevel: 0, attributes },
      build: {
        dir: path.join(toolsDir, 'build', lang),
        publish: true,
        keepSource: Boolean(options.keep_source),
        command: 'bundle exec asciidoctor-pdf -r asciidoctor-diagram --sourcemap',
      },
    }
  }

  function takeExports (contentCatalog, lang) {
    const exports = contentCatalog.findBy({ family: 'export' }).filter((f) => f.src.component === plan.landing)
    for (const file of exports) {
      const release = plan.releases.find((r) => r.release.version === file.src.version)?.release
      if (!release || file.extname !== '.pdf') continue
      const outPath = `${plan.prefix}/${release.version}/${lang}/${plan.prefix}-${release.version}-${lang}.pdf`
      // The pages in the PDF, with their named destination (without "#").
      const pages = {}
      for (const page of contentCatalog.getPages((p) => p.out && p.assembler?.exports)) {
        const entry = page.assembler.exports.find((it) => it.file === file)
        if (entry) pages[pageKey(page)] = entry.fragment && !entry.root ? entry.fragment.replace(/^#/, '') : ''
      }
      const title = `${plan.title} ${release.version}`
      pdfFiles.push({ lang, release: release.version, outPath, title, contents: file.contents, pages })
      contentCatalog.removeFile(file)
    }
  }
}

// The site run: the toolbar links and the PDFs, from the manifest of the PDF
// run.
function registerLinks (logger, outDir, manifestFile) {
  if (!fs.existsSync(manifestFile)) {
    return logger.warn(`no ${manifestFile}: no PDF links. Run make pdf before the site build.`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  // A page can be in more than one PDF, for example an English page in each
  // mixed-language PDF. Link to the PDF in the language of the page (its
  // module), else to the PDF of the fallback language.
  this.once('navigationBuilt', ({ contentCatalog }) => {
    const counts = new Map(manifest.pdfs.map((pdf) => [pdf, 0]))
    for (const page of contentCatalog.getPages((p) => p.out)) {
      const key = pageKey(page)
      const candidates = manifest.pdfs.filter((pdf) => key in pdf.pages)
      const pdf =
        candidates.find((it) => it.lang === page.src.module) ||
        candidates.find((it) => it.lang === (manifest.fallback || 'en')) ||
        candidates[0]
      if (!pdf) continue
      const attrs = ((page.asciidoc ??= {}).attributes ??= {})
      attrs['page-pdf-url'] = path.posix.relative(path.posix.dirname(page.out.path), pdf.outPath)
      attrs['page-pdf-title'] = `${pdf.title} PDF, opens at this page`
      if (pdf.pages[key]) attrs['page-pdf-anchor'] = pdf.pages[key]
      counts.set(pdf, counts.get(pdf) + 1)
    }
    for (const [pdf, count] of counts) logger.info(`${pdf.outPath}: printed ${manifest.printedAt}, links on ${count} pages`)
  })
  this.once('beforePublish', ({ siteCatalog }) => {
    for (const pdf of manifest.pdfs) {
      siteCatalog.addFile({ contents: fs.readFileSync(path.join(outDir, pdf.file)), out: { path: pdf.outPath } })
    }
  })
}

function pageKey (page) {
  const { component, version, module: mod, relative } = page.src
  return `${version}@${component}:${mod}:${relative}`
}

// The releases to build, from the release config of release-url-layout.
function planReleases (contentAggregate, options, yaml) {
  const name = options.release_config
  if (!name) throw new Error('antora-pdf: pdf-options.yml has no release_config')
  let configFile
  for (const bucket of contentAggregate) {
    configFile = bucket.files.find((f) => path.posix.basename(f.path) === name)
    if (configFile) break
  }
  if (!configFile) throw new Error(`antora-pdf: release config ${name} is not in the content`)
  const cfg = yaml.load(configFile.contents.toString())
  const all = cfg.releases || []
  const wanted = options.releases ?? 'latest'
  const selected =
    wanted === 'all'
      ? all
      : wanted === 'latest'
        ? [all.find((r) => !r.prerelease)].filter(Boolean)
        : all.filter((r) => [].concat(wanted).map(String).includes(String(r.version)))
  const landing = cfg.product.component
  const releases = selected.map((release) => {
    const bucket =
      contentAggregate.find((b) => b.name === landing && b.version === release.version) ||
      contentAggregate.find((b) => b.name === landing && b.version === cfg.product.landing_version)
    if (!bucket) throw new Error(`antora-pdf: no landing component ${landing} for release ${release.version}`)
    return { release, bucket }
  })
  const title = releases[0]?.bucket.title || cfg.product.url_prefix
  return { prefix: cfg.product.url_prefix, landing, title, releases }
}

// The PDF nav of one release and language: the landing nav, then the nav of
// each pinned component version one level down, with qualified xrefs.
//
// Mixed language: a component without a nav for the language uses the nav of
// the fallback language (en). The xrefs and includes are qualified with the
// module of the nav that is used.
//
// Nav includes of partials are put in line, so that their xrefs are qualified
// too. Attributes in the include target, such as {build-type}, come from the
// playbook.
function releaseNav (contentAggregate, plan, release, landingBucket, lang, fallback, attributes) {
  const expand = (b, mod, text, depth = 0) =>
    text.replace(/^include::partial\$([^[]+)\[\]$/gm, (line, target) => {
      const rel = target.replace(/\{([\w-]+)\}/g, (m, n) => (n in attributes ? String(attributes[n]).replace(/@$/, '') : m))
      const f = b.files.find((it) => it.path === `modules/${mod}/partials/${rel}`)
      if (!f || depth > 3) return line
      return expand(b, mod, f.contents.toString().replace(/\n$/, ''), depth + 1)
    })
  // Attributes in xref targets: {release-<component>-version}, and attributes
  // that the landing files define from them, such as {landing-admc-ref}.
  const refValues = {}
  for (const [name, version] of Object.entries(release.components)) refValues[`release-${name}-version`] = version
  for (const f of landingBucket.files) {
    if (!f.path.endsWith('.adoc')) continue
    for (const m of f.contents.toString().matchAll(/^:([\w-]+): \{(release-[\w-]+-version)\}@$/gm)) {
      if (m[2] in refValues) refValues[m[1]] = refValues[m[2]] + '@'
    }
  }
  const resolveRefs = (line) =>
    line.replace(/xref:[^[\s]*\[/g, (m) => m.replace(/\{([\w-]+)\}/g, (r, n) => refValues[n] ?? r))
  const navOf = (b) => {
    for (const mod of [lang, fallback]) {
      const f = b.files.find((it) => it.path === `modules/${mod}/nav.adoc`)
      if (f) return { text: expand(b, mod, f.contents.toString()), mod }
    }
    return { text: '', mod: lang }
  }
  // In a mixed-language PDF, an xref to a page of the fallback language goes
  // to the page of the PDF language, if there is one.
  const preferLang = (target) => {
    const m = /^([^@:]+)@([^:]+):([^:]+):([^#]+)(#.*)?$/.exec(target)
    if (!m || m[3] !== fallback || lang === fallback) return target
    const b = contentAggregate.find((it) => it.name === m[2] && it.version === m[1])
    const exists = b?.files.some((f) => f.path === `modules/${lang}/pages/${m[4]}`)
    return exists ? `${m[1]}@${m[2]}:${lang}:${m[4]}${m[5] || ''}` : target
  }
  const qualify = (line, name, version, mod) =>
    resolveRefs(line)
      .replace(/xref:([^[\s]+)\[/g, (m, target) => {
        if (!target.includes('@')) target = `${version}@${name}:${target.includes(':') ? target : `${mod}:${target}`}`
        return `xref:${preferLang(target)}[`
      })
      .replace(/^include::partial\$/, `include::${mod}:partial$`)
  const landingNav = navOf(landingBucket)
  const out = landingNav.text.split('\n').map((line) => qualify(line, landingBucket.name, landingBucket.version, landingNav.mod))
  for (const [name, version] of Object.entries(release.components)) {
    const b = contentAggregate.find((it) => it.name === name && it.version === version)
    if (!b) continue
    const { text, mod } = navOf(b)
    out.push('', `* ${b.title}`)
    for (const line of text.split('\n')) {
      if (/^\*+ /.test(line)) out.push('*' + qualify(line, name, version, mod))
      else if (/^\.(?!\.)/.test(line)) out.push('** ' + qualify(line.slice(1), name, version, mod))
    }
  }
  return out.join('\n') + '\n'
}

// mermaid draws the diagrams in Chromium. Load the SUSE font there, and use
// the installed Chromium if there is one.
function writeMermaidFiles (toolsDir, fontsDir) {
  fs.mkdirSync(toolsDir, { recursive: true })
  const font = (file) => `url("file://${path.join(fontsDir, file)}") format("truetype")`
  const css = path.join(toolsDir, 'mermaid.css')
  fs.writeFileSync(
    css,
    `@font-face { font-family: "SUSE"; src: ${font('SUSE-Regular.ttf')}; font-weight: normal; }\n` +
      `@font-face { font-family: "SUSE"; src: ${font('SUSE-Bold.ttf')}; font-weight: bold; }\n`
  )
  const puppeteer = path.join(toolsDir, 'puppeteer.json')
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || findChromium()
  fs.writeFileSync(puppeteer, JSON.stringify({ ...(executablePath && { executablePath }), args: ['--no-sandbox'] }))
  return { css, puppeteer }
}

// A theme for a CJK language: the SUSE theme, with the Noto font as fallback
// font for the characters that SUSE does not have.
function writeCjkTheme (toolsDir, lang, font) {
  const name = font.replace(/^NotoSans/, 'Noto Sans ')
  const file = path.join(toolsDir, `suse-theme-${lang}.yml`)
  fs.writeFileSync(
    file,
    [
      `extends: ${path.join(PDF_DIR, 'suse-theme.yml')}`,
      'font:',
      '  catalog:',
      '    merge: true',
      `    ${name}:`,
      `      normal: ${font}-Regular.ttf`,
      `      bold: ${font}-Bold.ttf`,
      `      italic: ${font}-Regular.ttf`,
      `      bold_italic: ${font}-Bold.ttf`,
      `  fallbacks: [${name}]`,
      '',
    ].join('\n')
  )
  return file
}

async function toBuffer (contents) {
  if (Buffer.isBuffer(contents)) return contents
  const chunks = []
  for await (const chunk of contents) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function findChromium () {
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim()
    } catch {}
  }
}

function formatNow (now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const zone = now.toLocaleTimeString('en-GB', { timeZoneName: 'short' }).split(' ').pop()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ${zone}`
}
