const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(process.cwd())
const schemaPath = path.join(root, 'lib/db/schema.ts')
const schemaSource = ts.createSourceFile(
  schemaPath,
  fs.readFileSync(schemaPath, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
)

function propertyName(node) {
  const name = node.name
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    ? name.text
    : null
}

const tables = new Map()
function collectTables(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    ts.isCallExpression(node.initializer) &&
    ts.isIdentifier(node.initializer.expression) &&
    node.initializer.expression.text === 'pgTable'
  ) {
    const columns = node.initializer.arguments[1]
    if (columns && ts.isObjectLiteralExpression(columns)) {
      const names = new Set()
      for (const property of columns.properties) {
        const name = propertyName(property)
        if (name) names.add(name)
      }
      tables.set(node.name.text, names)
    }
  }
  ts.forEachChild(node, collectTables)
}
collectTables(schemaSource)

function walk(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(entry.name)) continue
    const pathname = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(pathname))
    else if (/\.(ts|tsx)$/.test(entry.name) && pathname !== schemaPath) files.push(pathname)
  }
  return files
}

const findings = []
let checkedReferences = 0
let checkedWrites = 0
for (const filename of walk(root)) {
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const importedTables = new Map()
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '@/lib/db/schema' &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const item of statement.importClause.namedBindings.elements) {
        const original = (item.propertyName ?? item.name).text
        if (tables.has(original)) importedTables.set(item.name.text, original)
      }
    }
  }

  function location(node) {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source))
    return `${path.relative(root, filename)}:${position.line + 1}`
  }

  function checkObject(tableName, object, kind) {
    if (!object || !ts.isObjectLiteralExpression(object)) return
    checkedWrites += 1
    for (const property of object.properties) {
      const name = propertyName(property)
      if (name && !tables.get(tableName).has(name)) {
        findings.push(`${location(property)} ${kind}(${tableName}) uses unknown column ${name}`)
      }
    }
  }

  function visit(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      importedTables.has(node.expression.text)
    ) {
      checkedReferences += 1
      const tableName = importedTables.get(node.expression.text)
      const columnName = node.name.text
      if (!tables.get(tableName).has(columnName) && !['$inferSelect', '$inferInsert'].includes(columnName)) {
        findings.push(`${location(node)} ${tableName}.${columnName} is not declared in schema`)
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const base = node.expression.expression
      if (
        method === 'set' &&
        ts.isCallExpression(base) &&
        ts.isPropertyAccessExpression(base.expression) &&
        base.expression.name.text === 'update'
      ) {
        const table = base.arguments[0]
        if (table && ts.isIdentifier(table) && importedTables.has(table.text)) {
          checkObject(importedTables.get(table.text), node.arguments[0], 'update')
        }
      }
      if (
        method === 'values' &&
        ts.isCallExpression(base) &&
        ts.isPropertyAccessExpression(base.expression) &&
        base.expression.name.text === 'insert'
      ) {
        const table = base.arguments[0]
        const value = node.arguments[0]
        if (table && ts.isIdentifier(table) && importedTables.has(table.text)) {
          const tableName = importedTables.get(table.text)
          if (value && ts.isArrayLiteralExpression(value)) {
            for (const element of value.elements) checkObject(tableName, element, 'insert')
          } else {
            checkObject(tableName, value, 'insert')
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

console.info(
  JSON.stringify(
    {
      tables: tables.size,
      checkedReferences,
      checkedWrites,
      findings: [...new Set(findings)],
    },
    null,
    2,
  ),
)
if (findings.length) process.exitCode = 1
