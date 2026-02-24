
'use strict'

const dprint = (...args) => {
  const debug = false;
  if (debug)
    console.log(...args);
}

module.exports = (lang, url, languages, thispagelang) => {
  dprint('=======================================');
  dprint('Checking for', lang, 'in', languages, 'for', url);
  if (languages) {
    if (thispagelang === lang) {
      dprint('Returning false as thispagelang == lang');
      return false;
    }
    const arr = languages.replace(/[\[\]\s]/g, '').toLowerCase().split(',')
    const result =  arr.includes(lang.toLowerCase());
    dprint('Returning result =', result);
    return result;
  }
  dprint('No languages.');
  return false;
}
