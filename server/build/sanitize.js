// Raw HTML in markdown is an editor/admin capability — WordPress's
// unfiltered_html line. poops renders markdown with marked, which passes raw
// HTML through, so author-role content gets its HTML neutralized here before
// it reaches the build. Escaping `<` is enough: markdown's own syntax renders
// fine, and a tag that reaches the page as &lt;script&gt; is inert text.
//
// Fenced code blocks and inline code spans are left alone — markdown escapes
// their content itself, so they were never an XSS vector.
// ponytail: indented (4-space) code blocks aren't recognized, so a raw tag in
// one displays as &lt;tag&gt;. Fences won that trade; revisit if anyone writes
// indented blocks on purpose.
export function stripRawHtml(markdown) {
  const out = []
  let fence = null
  for (const line of String(markdown).split('\n')) {
    const open = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      out.push(line)
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null
      continue
    }
    if (open) {
      fence = open[1]
      out.push(line)
      continue
    }
    out.push(escapeOutsideInlineCode(line))
  }
  return out.join('\n')
}

// Escapes tag-opening `<` (before a letter, /, ! or ?) outside `code spans`,
// so "3 < 5" survives untouched.
function escapeOutsideInlineCode(line) {
  return line
    .split(/(`+[^`]*`+)/)
    .map((part) => part.startsWith('`') ? part : part.replace(/<(?=[a-zA-Z/!?])/g, '&lt;'))
    .join('')
}
