'use strict'

const get_project_code = (url) => url.split('/')[1] || null

module.exports = (request, nav, projectData) => {
  if (nav.page.layout == '404') return null;

  const project_code = get_project_code(nav.page.url);
  if (!project_code) return null;

  const project = projectData.find(obj => obj['url-part'] === project_code);
  if (!project) return null;

  switch(request) {
    case 'title':
      return project.title || null;
    case 'url':
      return project.url || null;
    default:
      return null;
  }
}