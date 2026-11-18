'use strict'

// Product releases for the "Component / version" selector and the page
// version menu.
//
// A product, for example SUSE Security, is a landing component and some
// component versions, pinned by product releases. A content repository
// describes a product in shared/modules/ROOT/partials/releases/<product>.yml.
// See the file of SUSE Security for the format: releases/suse-security.yml in
// rancher/suse-security-product-docs. A product with "releases: versions"
// (each version of the component is a release) has nothing to change here,
// so this helper ignores it.
//
// For a product, the selectors show the product releases, not the versions
// of its components. The release-url-layout extension in product-docs-common
// publishes the releases at /<url_prefix>/<release>/<lang>/. It registers the
// landing page of each release as a version of the landing component, with
// the release as the version. This helper works with and without it.
//
// Without a file, the selector shows the components and their versions, as
// the bundle does.
//
//   {{#each (productreleases site.components page.component page.componentVersion page.url)}}
//     The selector entries, in site order. An entry is a component, or a
//     product (product: true) in the place of its first component.
//   {{#with (productreleases site.components page.component page.componentVersion page.url context=true)}}
//     The release of the current page, or an empty string if the page is not
//     in a product.
//   {{#with (productreleases site.components page.component page.componentVersion page.url page.versions menu=true)}}
//     The items of the page version menu, or an empty string if the page is
//     not in a product.
//
// Antora loads helpers as virtual modules at <playbook dir>/ui-helpers/<name>.js,
// so require() finds js-yaml in the playbook node_modules.
const CONFIG_RX = /^releases\/([a-z0-9][a-z0-9-]*)\.yml$/
const SEGMENT_RX = /^[a-z][a-z0-9-]*$/
const RELEASE_RX = /^[0-9A-Za-z][0-9A-Za-z.-]*$/
const HIDDEN = new Set(['shared'])

function findConfigFiles (contentCatalog) {
  if (!contentCatalog) return []
  return contentCatalog.findBy({ component: 'shared', module: 'ROOT', family: 'partial' }).filter(({ src }) =>
    CONFIG_RX.test(src.relative) && contentCatalog.getComponent(src.component)?.latest?.version === src.version)
}

function loadProducts (contentCatalog, parse = (text) => require('js-yaml').load(text)) {
  const products = findConfigFiles(contentCatalog).map((file) => {
    const { component, version, module, relative } = file.src
    const source = `${version}@${component}:${module}:partial$${relative}`
    const config = parse(file.contents.toString())
    if (config?.releases === 'versions') return undefined
    return validateConfig(config, source, CONFIG_RX.exec(relative)[1])
  }).filter(Boolean)
  // A component belongs to one product only, and products need their own URL prefix.
  const owner = new Map()
  const prefixes = new Map()
  for (const product of products) {
    for (const name of product.componentNames) {
      if (owner.has(name)) throw new Error(`product releases: ${name} is in ${owner.get(name)} and in ${product.source}`)
      owner.set(name, product.source)
    }
    if (prefixes.has(product.urlPrefix)) {
      throw new Error(`product releases: url_prefix ${product.urlPrefix} is in ${prefixes.get(product.urlPrefix)} and in ${product.source}`)
    }
    prefixes.set(product.urlPrefix, product.source)
  }
  return products
}

function validateConfig (config, source, name) {
  const fail = (message) => { throw new Error(`${source}: ${message}`) }
  const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value)
  const onlyKeys = (object, keys, where) => {
    for (const key of Object.keys(object)) if (!keys.includes(key)) fail(`${where}: unknown key ${key}`)
  }
  if (!isObject(config)) fail('the file must contain product and releases')
  onlyKeys(config, ['product', 'releases'], 'top level')
  const product = config.product
  if (!isObject(product)) fail('product must be a map')
  onlyKeys(product, ['component', 'landing_version', 'url_prefix'], 'product')
  for (const key of ['component', 'landing_version']) {
    if (typeof product[key] !== 'string' || !product[key]) fail(`product.${key} must be a string`)
  }
  // The URL prefix is the product name (the file name), unless the file sets one.
  const urlPrefix = product.url_prefix ?? name
  if (typeof urlPrefix !== 'string' || !SEGMENT_RX.test(urlPrefix)) fail(`product.url_prefix must match ${SEGMENT_RX}`)
  if (!Array.isArray(config.releases) || !config.releases.length) fail('releases must be a list with at least one release')
  const versions = new Set()
  const componentNames = new Set([product.component])
  const releases = config.releases.map((release, i) => {
    const where = `releases[${i}]`
    if (!isObject(release)) fail(`${where} must be a map`)
    onlyKeys(release, ['version', 'prerelease', 'components'], where)
    if (typeof release.version !== 'string' || !RELEASE_RX.test(release.version)) {
      fail(`${where}: version must be a string that matches ${RELEASE_RX}`)
    }
    if (versions.has(release.version)) fail(`${where}: release ${release.version} appears more than once`)
    versions.add(release.version)
    if (release.prerelease != null && typeof release.prerelease !== 'boolean') fail(`${where}: prerelease must be true or false`)
    if (!isObject(release.components) || !Object.keys(release.components).length) {
      fail(`${where}: components must map component names to versions`)
    }
    for (const [component, version] of Object.entries(release.components)) {
      if (component === product.component) fail(`${where}: ${component} is the landing component`)
      if (typeof version !== 'string' || !version) fail(`${where}: the version of ${component} must be a string, for example '1.0'`)
      componentNames.add(component)
    }
    return { version: release.version, prerelease: release.prerelease === true, components: release.components }
  })
  return {
    name,
    source,
    component: product.component,
    landingVersion: product.landing_version,
    urlPrefix,
    releases,
    componentNames,
  }
}

// The releases of a product, resolved against the site. Releases are newest
// first. A pinned component version belongs to all the releases that pin it;
// its home is the oldest of them, where the extension publishes it.
function resolveProduct (product, byName) {
  const fail = (message) => { throw new Error(`${product.source}: ${message}`) }
  const landing = byName.get(product.component)
  if (!landing) fail(`the landing component ${product.component} is not in the site`)
  const releases = product.releases.map((release) => {
    const landingVersion = landing.versions.find((it) => it.version === release.version) ||
      landing.versions.find((it) => it.version === product.landingVersion)
    if (!landingVersion) fail(`release ${release.version}: ${product.component} has neither version ${release.version} nor ${product.landingVersion}`)
    const pins = new Map()
    for (const [name, version] of Object.entries(release.components)) {
      const component = byName.get(name)
      const componentVersion = component?.versions.find((it) => it.version === version)
      if (!componentVersion) fail(`release ${release.version} names ${name} ${version}, which is not in the site`)
      if (componentVersion.prerelease && !release.prerelease) {
        fail(`release ${release.version} names the prerelease ${name} ${version}, so it must set prerelease: true`)
      }
      pins.set(name, componentVersion)
    }
    return {
      version: release.version,
      label: release.prerelease ? `${release.version} (preview)` : release.version,
      prerelease: release.prerelease,
      landingVersion,
      pins,
    }
  })
  const newest = releases.find((release) => !release.prerelease) || releases[0]
  return { ...product, title: landing.title, landing, releases, newest, aliases: aliases(releases) }
}

// The releases that the release-url-layout extension links to from
// /<url_prefix>/latest and /<url_prefix>/dev: the newest release that is not a
// prerelease, and the newest prerelease. Empty strings for an alias without a
// release.
function aliases (releases) {
  return {
    latest: releases.find((release) => !release.prerelease)?.version || '',
    dev: releases.find((release) => release.prerelease)?.version || '',
  }
}

// The release of the current page: the release of a landing copy, the home of
// a pinned component version, or the newest release on the landing page of a
// build without the extension. Undefined if the page is not in the product.
function currentRelease (product, currentComponent, currentVersion) {
  if (!currentComponent) return
  if (currentComponent === product.landing) {
    return product.releases.find((release) => release.landingVersion === currentVersion &&
      release.version === currentVersion.version) || product.newest
  }
  const pinning = product.releases.filter((release) => release.pins.get(currentComponent.name) === currentVersion)
  return pinning[pinning.length - 1]
}

function releaseOptions (product, current) {
  return product.releases.map((release) => ({
    version: release.version,
    label: release.label,
    url: release.landingVersion.url,
    isCurrent: release === current,
  }))
}

// The URL of a pinned component version in a release. A component version that
// several releases pin is published once, under the oldest of them (its home).
// With the release-url-layout extension, the other releases reach it through
// their own path, /<url_prefix>/<release>/..., so the link stays in the release.
function releaseUrl (product, release, componentVersion) {
  const pinning = product.releases.filter((it) => [...it.pins.values()].includes(componentVersion))
  const home = pinning[pinning.length - 1]
  const homePath = `/${product.urlPrefix}/${home.version}/`
  const url = componentVersion.url
  if (home === release || typeof url !== 'string' || !url.startsWith(homePath)) return url
  return `/${product.urlPrefix}/${release.version}/${url.slice(homePath.length)}`
}

// For each release, links to the start pages of the component versions it pins,
// in the order of the release config. The list of the current release shows;
// js/product-release.js shows the list of the release in the URL instead.
// The closed list shows the current component, or "Components".
function componentLists (product, shown, currentComponent) {
  return product.releases.map((release) => {
    const components = [...release.pins].map(([name, componentVersion]) => ({
      title: componentVersion.title,
      url: releaseUrl(product, release, componentVersion),
      isCurrent: currentComponent?.name === name,
    }))
    return {
      version: release.version,
      isShown: release === shown,
      label: components.find((it) => it.isCurrent)?.title || 'Components',
      components,
    }
  })
}

function selectorEntries (components, products, currentComponent, currentVersion) {
  const productOf = new Map()
  for (const product of products) for (const name of product.componentNames) productOf.set(name, product)
  const entries = []
  const added = new Set()
  for (const component of components) {
    if (HIDDEN.has(component.name)) continue
    const product = productOf.get(component.name)
    if (!product) {
      entries.push({ component, isCurrent: component === currentComponent })
      continue
    }
    if (added.has(product)) continue
    added.add(product)
    const current = currentRelease(product, currentComponent, currentVersion)
    entries.push({
      product: true,
      title: product.title,
      urlPrefix: product.urlPrefix,
      url: (current || product.newest).landingVersion.url,
      isCurrent: Boolean(current),
      releases: releaseOptions(product, current),
      componentLists: componentLists(product, current || product.newest, currentComponent),
    })
  }
  return entries
}

function findProduct (products, currentComponent, currentVersion) {
  for (const product of products) {
    const release = currentRelease(product, currentComponent, currentVersion)
    if (release) return { product, release }
  }
}

function pageContext (products, currentComponent, currentVersion) {
  const found = findProduct(products, currentComponent, currentVersion)
  if (!found) return ''
  const { product, release } = found
  return {
    productTitle: product.title,
    isLanding: currentComponent === product.landing,
    label: release.label,
    version: release.version,
    urlPrefix: product.urlPrefix,
    aliases: product.aliases,
    releases: releaseOptions(product, release),
  }
}

// The page in each release. For a landing copy, the landing page of each
// release. For a component page, the same page in the version that each
// release pins, from page.versions. If a release pins the same version, the
// page is the same; with the extension, the release has its own path to it,
// /<url_prefix>/<release>/..., through a symlink.
function pageMenu (products, currentComponent, currentVersion, pageUrl, pageVersions) {
  const found = findProduct(products, currentComponent, currentVersion)
  if (!found) return ''
  const { product, release: current } = found
  const homePath = `/${product.urlPrefix}/${current.version}/`
  const layout = typeof pageUrl === 'string' && pageUrl.startsWith(homePath)
  const pageIn = (componentVersion) => (pageVersions || []).find((it) => it.version === componentVersion.version)
  return product.releases.flatMap((release) => {
    const isCurrent = release === current
    const target = currentComponent === product.landing ? release.landingVersion : release.pins.get(currentComponent.name)
    if (!target) return []
    let url, missing
    if (isCurrent || target === currentVersion) {
      url = !isCurrent && layout ? `/${product.urlPrefix}/${release.version}/${pageUrl.slice(homePath.length)}` : pageUrl
      missing = false
    } else {
      const page = pageIn(target)
      url = page ? page.url : target.url
      missing = page ? Boolean(page.missing) : true
    }
    return [{ version: release.version, label: release.label, url, missing, isCurrent }]
  })
}

const cache = new WeakMap()

module.exports = (...args) => {
  // Handlebars passes its options object last.
  const options = args.pop()
  const [components, currentComponent, currentVersion, pageUrl, pageVersions] = args
  const componentList = Array.isArray(components) ? components : Object.values(components || {})
  // Antora puts the content catalog in the root of the UI model, one for each build.
  const contentCatalog = options?.data?.root?.contentCatalog
  let configs = contentCatalog ? cache.get(contentCatalog) : []
  if (!configs) cache.set(contentCatalog, (configs = loadProducts(contentCatalog)))
  const byName = new Map(componentList.map((component) => [component.name, component]))
  const products = configs.map((product) => resolveProduct(product, byName))
  if (options?.hash?.context) return pageContext(products, currentComponent, currentVersion)
  if (options?.hash?.menu) return pageMenu(products, currentComponent, currentVersion, pageUrl, pageVersions)
  return selectorEntries(componentList, products, currentComponent, currentVersion)
}

module.exports.loadProducts = loadProducts
module.exports.validateConfig = validateConfig
module.exports.resolveProduct = resolveProduct
module.exports.selectorEntries = selectorEntries
module.exports.pageContext = pageContext
module.exports.pageMenu = pageMenu
module.exports.componentLists = componentLists
