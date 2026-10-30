'use strict'

// Run with: node --test tests/*.test.cjs
// Tests hasPrompt and extractCommands in the rancher site.js override. site.js
// is a browser script, so the test takes the functions out of the source text.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '../supplemental-files/rancher/js/site.js'), 'utf8')
const { hasPrompt, extractCommands } = new Function(
  src.match(/ {2}var HEREDOC_RX[^\n]*\n/)[0] +
  src.match(/ {2}function extractCommands[\s\S]*?\n {2}}\n/)[0] +
  src.match(/ {2}function hasPrompt[\s\S]*?\n {2}}\n/)[0] +
  'return { hasPrompt, extractCommands }'
)()
// Same steps as writeToClipboard for a console block.
const copy = (text) => {
  text = text.replace(/ +$/gm, '')
  return hasPrompt(text) ? extractCommands(text) : text
}

const cases = {
  'commands with output, joined with &&': ['$ ls -l\nfoo\nbar\n$ pwd\n/home', 'ls -l && pwd'],
  'backslash continuation': ['$ helm install \\\n  --set a=b \\\n  rancher', 'helm install --set a=b rancher'],
  'backslash continuation with "> " prompt': ['$ helm install \\\n> --set a=b', 'helm install --set a=b'],
  'backslash continuation without space': ['$ echo foo\\\nbar', 'echo foobar'],
  'root block, one command': ['# zypper ref', 'zypper ref'],
  'root block, commands only': ['# zypper ref\n\n# zypper in foo', 'zypper ref && zypper in foo'],
  'root block with output is copied as shown': ['# zypper ref\nLoading...', '# zypper ref\nLoading...'],
  'script with "# " comments is copied as shown': [
    '# Clone the AUR package\ngit clone https://aur.archlinux.org/kwctl.git\ncd kwctl\n\n# Build\nmakepkg -si',
    '# Clone the AUR package\ngit clone https://aur.archlinux.org/kwctl.git\ncd kwctl\n\n# Build\nmakepkg -si',
  ],
  'no prompt is copied as shown': ['kubectl get ns\nNAME STATUS', 'kubectl get ns\nNAME STATUS'],
  '"# " comment in "$ " block is dropped': ['$ ls\n# a comment\n$ pwd', 'ls && pwd'],
  '"> " block, each "> " line is a command': ['> 1 + 1\n2\n> 2 + 2\n4', '1 + 1 && 2 + 2'],
  'SUSE style sudo commands': ['> sudo zypper ref\n> sudo zypper in foo', 'sudo zypper ref && sudo zypper in foo'],
  'backslash continuation in "> " block': ['> helm install \\\n  --set a=b \\\n  rancher', 'helm install --set a=b rancher'],
  'heredoc, body without prompts, output after': [
    '> kubectl apply -f - <<EOF\na: 1\n\nb: 2\nEOF\n\nnamespace/test created',
    'kubectl apply -f - <<EOF\na: 1\n\nb: 2\nEOF',
  ],
  'heredoc in "$ " block, body without prompts': ['$ cat <<EOF > f\nline1\nEOF\n$ ls', 'cat <<EOF > f\nline1\nEOF\nls'],
  'heredoc in "> " block, body with "> " prompts': ['> cat <<EOF\n> a: 1\n> \n> b: 2\n> EOF\nout', 'cat <<EOF\na: 1\n\nb: 2\nEOF'],
  'heredoc in "$ " block, body with "> " prompts': ['$ cat <<EOF > f\n> line1\n> EOF\n$ ls', 'cat <<EOF > f\nline1\nEOF\nls'],
  'heredoc in "# " block, body with "> " prompts': ['# cat <<EOF > /etc/x\n> k=v\n> \n> EOF', 'cat <<EOF > /etc/x\nk=v\n\nEOF'],
  'heredoc in "# " block, body without prompts, is copied as shown': ['# cat <<EOF > /etc/x\nk=v\nEOF', '# cat <<EOF > /etc/x\nk=v\nEOF'],
  "quoted delimiter <<'EOF'": ["> cat <<'EOF'\n$HOME\nEOF", "cat <<'EOF'\n$HOME\nEOF"],
  'quoted delimiter <<"END"': ['> cat <<"END" | tee f\nx\nEND', 'cat <<"END" | tee f\nx\nEND'],
  '<<-EOF with tabs': ['> cat <<-EOF\n\tx\n\tEOF\n> ls', 'cat <<-EOF\n\tx\n\tEOF\nls'],
  'heredoc after backslash continuation': ['> kubectl apply \\\n  -f - <<EOF\na: 1\nEOF', 'kubectl apply -f - <<EOF\na: 1\nEOF'],
  'two heredocs': ['> cat <<A <<B\na\nA\nb\nB', 'cat <<A <<B\na\nA\nb\nB'],
  '"> " text in a body without prompts is kept': ['> cat <<EOF\nquote:\n> quoted\nEOF', 'cat <<EOF\nquote:\n> quoted\nEOF'],
  'here-string <<< is not a heredoc': ['> grep x <<< "$v"\nout', 'grep x <<< "$v"'],
  '$((1<<2)) is not a heredoc': ['> echo $((1<<2))\n4', 'echo $((1<<2))'],
  'multi-line string with blank continuation line': ['$ echo "a\n>\n> b"', 'echo "a\n\nb"'],
  // Known limitations. See rancher-docs/copy-to-clipboard.md.
  'limitation: "# " comment in root block is a command': ['# zypper ref\n# install it\n# zypper in x', 'zypper ref && install it && zypper in x'],
  'limitation: mixed prompts use the first-line prompt': ['> sudo -i\n# yast', 'sudo -i'],
}

for (const [name, [input, expected]] of Object.entries(cases)) {
  test(name, () => assert.equal(copy(input), expected))
}

// Lines where the prompt is unselectable with the mouse (fixPromptSelection).
const promptLines = (text) => {
  text = text.replace(/ +$/gm, '')
  const lines = []
  if (hasPrompt(text)) extractCommands(text, lines)
  return lines
}

const promptCases = {
  'commands, output has no prompt': ['$ ls\nfoo\n$ pwd', [0, 2]],
  '"# " comment in "$ " block is not a prompt': ['$ ls\n# rm -rf /tmp/x\n$ pwd', [0, 2]],
  'script with "# " comments has no prompts': ['# Clone it\ngit clone x\n\n# Build\nmake', []],
  'root block': ['# zypper ref\n\n# zypper in x', [0, 2]],
  'backslash continuation with "> " prompt': ['$ helm install \\\n> --set a=b', [0, 1]],
  'backslash continuation without prompt': ['> helm install \\\n  --set a=b', [0]],
  'heredoc body with "> " prompts, blank body line': ['> cat <<EOF\n> a\n> \n> EOF\nout', [0, 1, 2, 3]],
  'heredoc body without prompts': ['> cat <<EOF\na\n> quoted\nEOF', [0]],
  'multi-line string in "$ " block': ['$ echo "a\n>\n> b"', [0, 1, 2]],
  'no prompt': ['kubectl get ns\nNAME', []],
}

for (const [name, [input, expected]] of Object.entries(promptCases)) {
  test('prompt lines: ' + name, () => assert.deepEqual(promptLines(input), expected))
}
