'use strict'

const dprint = (...args) => {
  const debug = false;
  if (debug)
    console.log(...args);
}

// This 'langFromURL' function returns either the url language or the hreflang
// language. The URL language is determined from the 3rd part of the URL, The
// hreflang language is determined by using the URL language as an index into
// langToHreflangMapping. The 'type' parameter is used to determine which
// language type to return.

const get_lang = (url) => url.split('/')[3] || 'en';
const langToHreflangMapping = {
  "en": "en-US",
  "de": "de-DE",
  "fr": "fr-FR",
  "es": "es-ES",
  "ja": "ja-JP",
  "pt_br": "pt-BR",
  "zh": "zh-CN",
  "ko": "ko-KR",
}

module.exports = (pageurl, type, nav) => {
  if (nav.page.layout === '404') return null;
  const lang = get_lang(pageurl);
  if (type === 'hreflang') {
    return langToHreflangMapping[lang] || null;
  } else if (type === 'headerlang') {
    if (lang.toLowerCase() === 'zh') {
      return 'zh_cn';
    } else {
      return lang;
    }
  } else {
    return lang;
  }
}
