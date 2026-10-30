# Copy button for console blocks

The copy button removes prompts and output from console blocks. Only the commands go to the clipboard.

The default UI accepts only the `$ ` prompt. The SUSE style guide uses `> ` for a user and `# ` for root. Refer to [Prompts](https://documentation.suse.com/style/current/html/style-guide-adoc/sec-structure.html#sec-prompt).

## Code

- Override: [`supplemental-files/rancher/js/site.js`](../supplemental-files/rancher/js/site.js). This file replaces `js/site.js` in `default-ui/ui-bundle.zip` for rancher only.
- The last module in the file is the patched copy module. It starts at the comment `Rancher patch`. The other modules are the minified original. Do not change them.
- `hasPrompt` decides if a block has prompts.
- `extractCommands` finds the commands in a block.
- `HEREDOC_RX` finds heredocs.
- `writeToClipboard` calls `extractCommands` for `console` blocks where `hasPrompt` is true.
- `fixPromptSelection` sets which prompts the mouse cannot select. Refer to [Mouse selection](#mouse-selection).

## Rules

| Item | Behavior |
|---|---|
| Prompt | The first line sets the prompt: `$ `, `# ` or `> `. Only lines with this prompt start a command. |
| `# ` prompt | A `# ` block is a root block only if all lines start with `# ` or `> `. Other `# ` blocks are copied without changes. Example: a script with `# ` comments. |
| Other lines | Output and comments. The copy button removes them. |
| `\` at end of line | The next line continues the command. A `> ` at the start of the next line is removed. |
| `> ` after a command | In a `$ ` or `# ` block, the line continues the command, for example a multi-line string. |
| Heredoc | `<<EOF`, `<<-EOF`, `<<'EOF'` and `<<"EOF"`. The body continues to the delimiter line. The body can have `> ` prompts or no prompts. The first body line sets this. |
| Join | Commands are joined with ` && `. If a command has more than one line, commands are joined with new lines. |
| No prompt | The block is copied without changes. |
| Literal block | A literal block that starts with `$ ` becomes a console block. Other literal blocks get no copy button. |

## Mouse selection

highlight.js marks each `$`, `#` or `>` at the start of a console line as a prompt (`hljs-meta`). The bundle CSS makes `hljs-meta` unselectable. Without a fix, a mouse selection removes the `#` from a comment, and the comment becomes a command.

`fixPromptSelection` runs on the page `load` event, after highlight.js. It keeps `hljs-meta` only on the lines where the copy button removes a prompt. `extractCommands` gives these lines.

- Prompts that the copy button removes: the mouse cannot select them.
- Comments, output, and text in heredoc bodies without prompts: the mouse selects all characters.
- Blocks where `hasPrompt` is false: the mouse selects all characters.

## Limitations and writing rules

The code cannot find the difference between these items and commands. Writers must prevent them.

- In a root block, a `# ` comment is copied as a command. Do not put comments in root blocks.
- A root block with output is copied without changes. The `# ` prompts stay in the copy. Put the output in a different block.
- In a `> ` block, an output line that starts with `> ` is copied as a command. Put this output in a different block.
- In a block with mixed prompts, only the first-line prompt is used. Use one prompt for each block. Use `sudo` where possible.
- If a heredoc has no delimiter line, the body continues to the end of the block.

## Test

1. Run `node --test tests/*.test.cjs`. [`tests/copy-to-clipboard.test.cjs`](../tests/copy-to-clipboard.test.cjs) tests `hasPrompt`, `extractCommands`, and the prompt lines for mouse selection.
2. For a browser test, build a rancher docs site with this repository as `supplemental_files`. Click the copy buttons on pages with console blocks. Select the blocks with the mouse and copy.

## When `ui-bundle.zip` changes

The override replaces the `site.js` of the new bundle. Do these steps:

1. Copy `js/site.js` from the new bundle.
2. Find the copy module. It starts with `var s=/^\$ `.
3. Replace this module with the patched module from the current override.
4. Run the tests.
