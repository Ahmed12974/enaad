import { deflateRawSync } from 'node:zlib'

type ZipEntry = {
  name: string
  data: Buffer
  modifiedAt?: Date
}

const CRC_TABLE = Array.from({ length: 256 }, (_, initial) => {
  let value = initial
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(data: Buffer) {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date) {
  const safe = date.getFullYear() < 1980 ? new Date('1980-01-01T00:00:00.000Z') : date
  const time =
    ((safe.getHours() & 0x1f) << 11) |
    ((safe.getMinutes() & 0x3f) << 5) |
    ((Math.floor(safe.getSeconds() / 2) & 0x1f) << 0)
  const day = safe.getDate() & 0x1f
  const month = (safe.getMonth() + 1) & 0x0f
  const year = Math.max(0, safe.getFullYear() - 1980) & 0x7f
  return { time, date: (year << 9) | (month << 5) | day }
}

function safeEntryName(name: string) {
  const normalized = name.replaceAll('\\', '/').replace(/^\/+/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (!parts.length || parts.some((part) => part === '.' || part === '..' || part.includes('\0')))
    throw new Error('اسم ملف غير صالح داخل النسخة الاحتياطية.')
  return parts.join('/')
}

export function createZipArchive(entries: ZipEntry[]) {
  if (!entries.length) throw new Error('لا توجد بيانات لإنشاء النسخة الاحتياطية.')
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const usedNames = new Set<string>()

  for (const entry of entries) {
    const name = safeEntryName(entry.name)
    if (usedNames.has(name)) throw new Error(`اسم مكرر داخل النسخة الاحتياطية: ${name}`)
    usedNames.add(name)

    const nameBuffer = Buffer.from(name, 'utf8')
    const compressed = deflateRawSync(entry.data, { level: 6 })
    const checksum = crc32(entry.data)
    const { time, date } = dosDateTime(entry.modifiedAt ?? new Date())

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(time, 10)
    localHeader.writeUInt16LE(date, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressed.byteLength, 18)
    localHeader.writeUInt32LE(entry.data.byteLength, 22)
    localHeader.writeUInt16LE(nameBuffer.byteLength, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, nameBuffer, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt16LE(time, 12)
    centralHeader.writeUInt16LE(date, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressed.byteLength, 20)
    centralHeader.writeUInt32LE(entry.data.byteLength, 24)
    centralHeader.writeUInt16LE(nameBuffer.byteLength, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBuffer)

    offset += localHeader.byteLength + nameBuffer.byteLength + compressed.byteLength
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, end])
}
