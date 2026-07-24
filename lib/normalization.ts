export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export function cleanText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
}

export function normalizeText(value: unknown) {
  return cleanText(value).toLocaleLowerCase('und')
}
