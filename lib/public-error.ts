const ARABIC_TEXT = /[\u0600-\u06ff]/
const UNSAFE_DETAILS =
  /\b(select|insert|update|delete|postgres|postgresql|sql|constraint|relation|column|stack|drizzle|query|syntax error)\b|token|secret|database|blob|\bat\s+[A-Za-z_$][\w$]*(?:\.|\s|\()/i

/**
 * Keeps expected Arabic business messages useful without exposing provider,
 * SQL, stack or secret details from unexpected exceptions.
 */
export function publicActionError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const message = error.message.trim()
  if (
    !message ||
    message.length > 240 ||
    !ARABIC_TEXT.test(message) ||
    UNSAFE_DETAILS.test(message) ||
    /[\r\n]/.test(message)
  ) {
    return fallback
  }
  return message
}
