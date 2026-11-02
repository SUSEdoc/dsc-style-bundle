# AGENTS.md

This repository contains the Antora UI for SUSE product documentation. Antora playbooks in other repositories use it.

## Layout

- `default-ui/ui-bundle.zip`: the Antora default UI bundle. Do not edit it.
- `supplemental-files/<product>/`: product files. Antora adds them to the bundle. A file with the same path as a bundle file replaces it. A file that is not here comes from the bundle.
  - `rancher/`: Rancher and other cloud native products. This set has the most changes.
  - `mlm/susecom-2025/` and `mlm/webui-2025/`: SUSE Multi-Linux Manager.
- Each product set uses the bundle layout:

  | Path | Contents |
  |---|---|
  | `layouts/*.hbs` | Page templates. Only `rancher` has them. |
  | `partials/*.hbs` | Template parts that layouts include. |
  | `helpers/*.js` | Handlebars helpers. |
  | `css/site-extra.css` | Product CSS. It loads after the bundle CSS. |
  | `js/` | Page scripts. |
  | `img/`, `fonts/` | Images and fonts. |

- `pdf/`: the optional PDF build. Web sites do not publish it. Refer to [pdf/README.md](pdf/README.md).
- `tests/`: Node.js tests.
- `rancher-docs/`: notes on changes to `supplemental-files/rancher`.
- `tmp/`: scratch files. They are not part of the UI.

## Rules

- Make changes in `supplemental-files/<product>/`, not in the bundle.
- Keep changes in one product unless the task is for more products.
- Run the tests before you commit: `node --test tests/*.test.cjs`.
- To see a change, build a docs site with a playbook that uses this repository as `supplemental_files`.

## Conventions

### Templates

- Layouts use the Antora variables `page`, `site`, `env`, `uiRootPath` and `siteRootPath`.
- Include a partial with `{{> partial-name}}`.
- Use a Handlebars comment (`{{!-- --}}`) to remove template text. An HTML comment stays in the output.

### Helpers

- Write a helper as a CommonJS module: `module.exports = (args...) => { ... }`.
- Some helpers have `const debug = false`. Set it to `true` to get log output. Do not commit `true`.

### Languages

- Locales: `en`, `de`, `fr`, `es`, `es-es`, `zh-cn`, `pt-br`, `ja`, `ko`.
- A language partial has the name `<partial>_<lang>.hbs`, for example `disclaimer_de.hbs`. The base partial selects the language partial.
- `admonition-trans.txt` has the admonition labels for each language. Update it when you add a language.

### Shared header

- `partials/head-meta.hbs` loads the SUSE shared header from `static.scc.suse.com/shared-header/<version>/`.
- When the shared header has a new release, change the version in the URL.

### CSS

- Put product CSS in `css/site-extra.css`.
- SUSE colors: midnight `#0a112b`, dark green `#0c322c`, accent green `#00c081`.
- Fonts: `SUSE` and `SUSE Mono`.

## Documentation

- Write documentation in ASD-STE100 (Simplified Technical English).
- Write for humans and agents. Use short sentences and lists. Give only the necessary information.
- Refer to the code by file path and function name, not by line number.

## Rancher change notes

- [Copy button for console blocks](rancher-docs/copy-to-clipboard.md): `$ `, `# ` and `> ` prompts, continuation lines, heredocs.
- [Documentation survey link](rancher-docs/docsurvey.md): how to turn the link on and off.
