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
