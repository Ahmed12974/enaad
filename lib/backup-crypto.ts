import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export type EncryptedBackupPayload = {
  version: 1
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

export function assertBackupEncryptionSecret(value: string | undefined) {
  const secret = value?.trim()
  if (!secret || secret.length < 32)
    throw new Error('BACKUP_ENCRYPTION_SECRET يجب أن يكون سرًا عشوائيًا بطول 32 حرفًا على الأقل.')
  return secret
}

export function encryptBackupPayload(value: unknown, secretValue: string) {
  const secret = assertBackupEncryptionSecret(secretValue)
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(secret, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  } satisfies EncryptedBackupPayload
}

export function decryptBackupPayload<T>(payload: EncryptedBackupPayload, secretValue: string): T {
  const secret = assertBackupEncryptionSecret(secretValue)
  if (payload.version !== 1 || payload.algorithm !== 'aes-256-gcm' || payload.kdf !== 'scrypt')
    throw new Error('صيغة تشفير بيانات النسخة غير مدعومة.')
  const key = scryptSync(secret, Buffer.from(payload.salt, 'base64'), 32)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ])
    return JSON.parse(plaintext.toString('utf8')) as T
  } catch {
    throw new Error('تعذر فك بيانات اعتماد النسخة. تحقق من سر التشفير وسلامة الملف.')
  }
}
