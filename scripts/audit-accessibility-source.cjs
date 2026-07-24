const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(process.cwd())
const findings = []
const controls = new Set(['Input', 'Textarea', 'Select', 'input', 'textarea', 'select'])

function tagName(tag) {
  return tag.getText()
}

function attributes(element) {
  const result = new Map()
  for (const property of element.attributes.properties) {
    if (ts.isJsxAttribute(property)) result.set(property.name.text, property)
  }
  return result
}

function literalAttribute(attribute) {
  if (!attribute?.initializer) return null
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isStringLiteral(attribute.initializer.expression)
  ) {
    return attribute.initializer.expression.text
  }
  return null
}

function auditFile(filename) {
  const text = fs.readFileSync(filename, 'utf8')
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const parents = new Map()

  function mapParents(node) {
    ts.forEachChild(node, (child) => {
      parents.set(child, node)
      mapParents(child)
    })
  }
  mapParents(source)

  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const name = tagName(node.tagName)
      if (controls.has(name)) {
        const attrs = attributes(node)
        const hidden = literalAttribute(attrs.get('type')) === 'hidden' || attrs.has('hidden')
        let labelled =
          attrs.has('aria-label') || attrs.has('aria-labelledby') || attrs.has('title')
        let parent = node
        while (!labelled && (parent = parents.get(parent))) {
          if (ts.isJsxElement(parent) && tagName(parent.openingElement.tagName) === 'label') {
            labelled = true
          }
        }
        if (!hidden && !labelled) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source))
          findings.push(
            `${path.relative(root, filename)}:${position.line + 1}:${position.character + 1} <${name}> lacks a label or accessible name`,
          )
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(entry.name)) continue
    const pathname = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (pathname === path.join(root, 'components', 'ui')) continue
      walk(pathname)
    } else if (pathname.endsWith('.tsx')) {
      auditFile(pathname)
    }
  }
}

for (const directory of ['app', 'components']) {
  const pathname = path.join(root, directory)
  if (fs.existsSync(pathname)) walk(pathname)
}

console.log(
  JSON.stringify(
    {
      controlsPolicy: 'Every non-hidden input/select/textarea has a visible label or accessible name.',
      findings,
    },
    null,
    2,
  ),
)
process.exitCode = findings.length ? 1 : 0
