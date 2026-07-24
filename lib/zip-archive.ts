import { deflateRawSync, inflateRawSync } from 'node:zlib'

export type ZipEntry = {
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


export type ZipInspectionEntry = {
  name: string
  size: number
  compressedSize: number
  crc32: number
}

function parseZipArchive(archive: Buffer, includeData: boolean) {
  if (archive.byteLength < 22) throw new Error('ملف ZIP أقصر من البنية الدنيا.')
  const eocdOffset = archive.byteLength - 22
  if (archive.readUInt32LE(eocdOffset) !== 0x06054b50)
    throw new Error('نهاية ملف ZIP غير صالحة أو تحتوي تعليقًا غير مدعوم.')
  if (
    archive.readUInt16LE(eocdOffset + 4) !== 0 ||
    archive.readUInt16LE(eocdOffset + 6) !== 0 ||
    archive.readUInt16LE(eocdOffset + 20) !== 0
  ) {
    throw new Error('ملفات ZIP متعددة الأقراص أو ذات التعليقات غير مدعومة.')
  }

  const expectedEntries = archive.readUInt16LE(eocdOffset + 10)
  const entriesOnDisk = archive.readUInt16LE(eocdOffset + 8)
  const centralSize = archive.readUInt32LE(eocdOffset + 12)
  const centralOffset = archive.readUInt32LE(eocdOffset + 16)
  if (expectedEntries !== entriesOnDisk || centralOffset + centralSize !== eocdOffset)
    throw new Error('فهرس ZIP المركزي غير متطابق.')

  const entries: ZipInspectionEntry[] = []
  const files = new Map<string, Buffer>()
  const usedNames = new Set<string>()
  const localOffsets: number[] = []
  let offset = 0
  while (offset < centralOffset) {
    if (offset + 30 > centralOffset || archive.readUInt32LE(offset) !== 0x04034b50)
      throw new Error('بنية ملف ZIP المحلية غير صالحة.')

    const flags = archive.readUInt16LE(offset + 6)
    const method = archive.readUInt16LE(offset + 8)
    const expectedCrc = archive.readUInt32LE(offset + 14)
    const compressedSize = archive.readUInt32LE(offset + 18)
    const size = archive.readUInt32LE(offset + 22)
    const nameLength = archive.readUInt16LE(offset + 26)
    const extraLength = archive.readUInt16LE(offset + 28)
    if ((flags & 0x0800) === 0 || (flags & 0x0001) !== 0 || method !== 8)
      throw new Error('طريقة ضغط ZIP أو تشفيره غير مدعومة.')

    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const dataEnd = dataStart + compressedSize
    if (nameStart + nameLength > centralOffset || dataEnd > centralOffset)
      throw new Error('ملف ZIP مبتور.')
    const name = safeEntryName(archive.subarray(nameStart, nameStart + nameLength).toString('utf8'))
    if (usedNames.has(name)) throw new Error(`اسم مكرر داخل ملف ZIP: ${name}`)
    usedNames.add(name)
    const data = inflateRawSync(archive.subarray(dataStart, dataEnd))
    if (data.byteLength !== size || crc32(data) !== expectedCrc)
      throw new Error(`فشل فحص سلامة الملف داخل النسخة: ${name}`)
    localOffsets.push(offset)
    entries.push({ name, size, compressedSize, crc32: expectedCrc })
    if (includeData) files.set(name, data)
    offset = dataEnd
  }
  if (offset !== centralOffset || entries.length !== expectedEntries)
    throw new Error('عدد ملفات ZIP أو موضع الفهرس غير مطابق.')

  let centralCursor = centralOffset
  for (let index = 0; index < expectedEntries; index += 1) {
    if (centralCursor + 46 > eocdOffset || archive.readUInt32LE(centralCursor) !== 0x02014b50)
      throw new Error('بنية فهرس ZIP المركزي غير صالحة.')
    const flags = archive.readUInt16LE(centralCursor + 8)
    const method = archive.readUInt16LE(centralCursor + 10)
    const checksum = archive.readUInt32LE(centralCursor + 16)
    const compressedSize = archive.readUInt32LE(centralCursor + 20)
    const size = archive.readUInt32LE(centralCursor + 24)
    const nameLength = archive.readUInt16LE(centralCursor + 28)
    const extraLength = archive.readUInt16LE(centralCursor + 30)
    const commentLength = archive.readUInt16LE(centralCursor + 32)
    const localOffset = archive.readUInt32LE(centralCursor + 42)
    const next = centralCursor + 46 + nameLength + extraLength + commentLength
    if (next > eocdOffset || (flags & 0x0800) === 0 || (flags & 0x0001) !== 0 || method !== 8)
      throw new Error('فهرس ZIP المركزي يحتوي إدخالًا غير مدعوم.')
    const name = safeEntryName(
      archive.subarray(centralCursor + 46, centralCursor + 46 + nameLength).toString('utf8'),
    )
    const local = entries[index]
    if (
      !local ||
      name !== local.name ||
      size !== local.size ||
      compressedSize !== local.compressedSize ||
      checksum !== local.crc32 ||
      localOffset !== localOffsets[index]
    ) {
      throw new Error(`فهرس ZIP المركزي لا يطابق الإدخال المحلي: ${name}`)
    }
    centralCursor = next
  }
  if (centralCursor !== eocdOffset) throw new Error('حجم فهرس ZIP المركزي غير مطابق.')

  return { entries, entryCount: entries.length, files }
}

/** Validates every local entry, decompression result and CRC. */
export function inspectZipArchive(archive: Buffer) {
  const { entries, entryCount } = parseZipArchive(archive, false)
  return { entries, entryCount }
}

/** Reads a trusted backup after applying the same structural and CRC checks. */
export function readZipArchive(archive: Buffer) {
  return parseZipArchive(archive, true)
}
