/** Prevent spreadsheet applications from interpreting user-controlled cells as formulas. */
export function neutralizeSpreadsheetCell(value: unknown) {
  const text = String(value ?? '')
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}
