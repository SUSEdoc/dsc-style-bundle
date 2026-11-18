'use strict'

// Run with: node --test tests/*.test.cjs
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { expandNavIncludes } = require('../pdf/antora-pdf.js')

const partials = {
  'all.adoc': '* xref:a.adoc[]\n* xref:b.adoc[]\n',
  'product-specific/nav.adoc': [
    '// A comment outside the tag.',
    '// tag::nav[]',
    '** xref:product-specific/x.adoc[]',
    '** xref:product-specific/y.adoc[]',
    '// end::nav[]',
    '** xref:outside.adoc[]',
  ].join('\n'),
  'two.adoc': [
    '// tag::one[]',
    '* xref:one.adoc[]',
    '// end::one[]',
    '// tag::two[]',
    '* xref:two.adoc[]',
    '// end::two[]',
  ].join('\n'),
  'outer.adoc': 'include::partial$all.adoc[]',
}
const read = (rel) => partials[rel]
const expand = (text, attributes = {}) => expandNavIncludes(text, attributes, read)

test('an include with no attributes adds all lines', () => {
  assert.equal(expand('* Top\ninclude::partial$all.adoc[]\n* End'), '* Top\n* xref:a.adoc[]\n* xref:b.adoc[]\n* End')
})

test('an include with tag adds only the tagged lines, without the markers', () => {
  assert.equal(
    expand('include::partial${build-type}-specific/nav.adoc[tag=nav]', { 'build-type': 'product' }),
    '** xref:product-specific/x.adoc[]\n** xref:product-specific/y.adoc[]',
  )
})

test('an include with tags adds the lines of each tag', () => {
  assert.equal(expand('include::partial$two.adoc[tags=one;two]'), '* xref:one.adoc[]\n* xref:two.adoc[]')
  assert.equal(expand('include::partial$two.adoc[tags="two"]'), '* xref:two.adoc[]')
})

test('an include in an included partial is expanded', () => {
  assert.equal(expand('include::partial$outer.adoc[]'), '* xref:a.adoc[]\n* xref:b.adoc[]')
})

test('an include that is not supported stays as it is', () => {
  for (const line of [
    'include::partial$all.adoc[lines=1]',
    'include::partial$two.adoc[tags=*]',
    'include::partial$two.adoc[tags=!one]',
    'include::partial$missing.adoc[]',
    'include::partial${unknown}/nav.adoc[tag=nav]',
  ]) {
    assert.equal(expand(line), line)
  }
})

// planReleases reads shared/modules/ROOT/partials/releases/<product>.yml.
const { planReleases, compareVersions } = require('../pdf/antora-pdf.js')
const yaml = { load: JSON.parse }
const bucket = (name, version, extra = {}, files = []) => ({ name, version, title: name, files, ...extra })
const releaseFile = (product, data) => ({ path: `modules/ROOT/partials/releases/${product}.yml`, contents: Buffer.from(JSON.stringify(data)) })

test('compareVersions orders versions by their numbers', () => {
  const sorted = ['v2.9', 'v2.15', 'latest', 'v2.11', '1.0.1', '1.0'].sort(compareVersions)
  assert.deepEqual(sorted, ['1.0', '1.0.1', 'v2.9', 'v2.11', 'v2.15', 'latest'])
})

test('releases: versions makes a release of each version, and latest skips a prerelease', () => {
  const aggregate = [
    bucket('shared', 'latest', {}, [releaseFile('rancher-manager', { product: { component: 'rancher-manager' }, releases: 'versions' })]),
    bucket('rancher-manager', 'v2.14'),
    bucket('rancher-manager', 'v2.16', { prerelease: '(Unreleased)' }),
    bucket('rancher-manager', 'v2.15'),
  ]
  const plan = planReleases(aggregate, { product: 'rancher-manager' }, yaml)
  assert.equal(plan.prefix, 'rancher-manager')
  assert.equal(plan.landing, 'rancher-manager')
  assert.deepEqual(plan.releases.map(({ release }) => release.version), ['v2.15'])
  assert.deepEqual(plan.releases[0].release.components, {})
  assert.equal(plan.releases[0].bucket.version, 'v2.15')
  const all = planReleases(aggregate, { product: 'rancher-manager', releases: 'all' }, yaml)
  assert.deepEqual(all.releases.map(({ release }) => release.version), ['v2.16', 'v2.15', 'v2.14'])
})

test('a list of releases uses the landing version, and url_prefix can be set', () => {
  const ss = { product: { component: 'kubewarden', landing_version: '1.0', url_prefix: 'ss' }, releases: [{ version: '6.0.0', components: { a: '1' } }] }
  const aggregate = [bucket('shared', 'latest', {}, [releaseFile('suse-security', ss)]), bucket('kubewarden', '1.0')]
  const plan = planReleases(aggregate, { product: 'suse-security' }, yaml)
  assert.equal(plan.prefix, 'ss')
  assert.deepEqual(plan.releases.map(({ release, bucket }) => [release.version, bucket.version]), [['6.0.0', '1.0']])
})

test('a missing product or product file is an error', () => {
  assert.throws(() => planReleases([], {}, yaml), /pdf-options.yml has no product/)
  assert.throws(() => planReleases([bucket('shared', 'latest')], { product: 'x' }, yaml), /no modules\/ROOT\/partials\/releases\/x.yml/)
})
