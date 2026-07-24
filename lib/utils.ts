import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export { cleanText, normalizeText } from '@/lib/normalization'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}
