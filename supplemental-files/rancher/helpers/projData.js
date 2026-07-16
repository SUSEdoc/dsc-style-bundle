'use strict'

const dprint = (...args) => {
  const debug = true;
  if (debug)
    console.log('Inside projData', ...args);
}

const get_project_code = (url) => url.split('/')[1] || null

module.exports = (request, nav, projectData) => {
  if (nav.page.layout == '404') return null;

  const project_code = get_project_code(nav.page.url);
  if (!project_code) return null;

  const project = projectData.find(obj => obj['url-part'] === project_code);
  if (!project) return null;

  const dsc_base_url = project['dsc-base-url'];
  if (!dsc_base_url) return null;

  switch(request) {
    case 'dsc-base-url':
      return dsc_base_url || null;
    case 'title':
      return project.title || null;
    case 'fullTitle':
      return project.fullTitle || project.title || null;
    case 'full-proj-url': {
      if (!dsc_base_url) return null;
      const url = dsc_base_url + '/' + (project['dsc-base-url2'] + '/' + (project['dsc-base-url3']) || '');
      return url
        .replace(/([^:]\/)\/+/g, '$1') // collapse duplicate slashes, keep protocol
        .replace(/\/+$/, '');          // strip trailing slash(es)
    }
    case 'url2': {
      if (!dsc_base_url) return null;
      const url = dsc_base_url + '/' + (project['dsc-base-url2'] || '');
      return url
        .replace(/([^:]\/)\/+/g, '$1') // collapse duplicate slashes, keep protocol
        .replace(/\/+$/, '');          // strip trailing slash(es)
    }
    default:
      return null;
  }
}
