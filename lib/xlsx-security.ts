export function assertSafeWorkbookArchive(bytes: Buffer) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw new Error('الملف ليس مصنف XLSX صالحًا.')
  const searchStart = Math.max(0, bytes.length - 65_557)
  let endOffset = -1
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) throw new Error('بنية ملف XLSX غير مكتملة.')
  const entries = bytes.readUInt16LE(endOffset + 10)
  const directorySize = bytes.readUInt32LE(endOffset + 12)
  const directoryOffset = bytes.readUInt32LE(endOffset + 16)
  if (!entries || entries > 256 || directoryOffset + directorySize > bytes.length)
    throw new Error('بنية ملف XLSX غير مسموحة.')

  let cursor = directoryOffset
  let totalUncompressed = 0
  for (let entry = 0; entry < entries; entry += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('دليل ملف XLSX غير صالح.')
    const flags = bytes.readUInt16LE(cursor + 8)
    const method = bytes.readUInt16LE(cursor + 10)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const uncompressedSize = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > bytes.length || flags & 1 || ![0, 8].includes(method))
      throw new Error('يحتوي ملف XLSX على إدخال غير مسموح.')
    const entryName = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    if (entryName.startsWith('/') || entryName.startsWith('\\') || entryName.split(/[\\/]/).includes('..'))
      throw new Error('يحتوي ملف XLSX على مسار غير آمن.')
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff)
      throw new Error('ملفات XLSX بنمط ZIP64 غير مدعومة.')
    totalUncompressed += uncompressedSize
    if (
      uncompressedSize > 10 * 1024 * 1024 ||
      totalUncompressed > 24 * 1024 * 1024 ||
      (compressedSize > 0 && uncompressedSize / compressedSize > 200)
    ) {
      throw new Error('الملف مضغوط بنسبة أو حجم غير آمن.')
    }
    cursor = next
  }
}
