// Some restricted build sandboxes deny libuv's RSS syscall. Preserve normal
// measurements everywhere else and provide a zero-only fallback for Next.js
// telemetry so that a missing optional metric cannot abort a valid build.
const originalMemoryUsage = process.memoryUsage.bind(process)
const originalRss = process.memoryUsage.rss.bind(process.memoryUsage)

function safeMemoryUsage() {
  try {
    return originalMemoryUsage()
  } catch {
    return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }
  }
}

safeMemoryUsage.rss = () => {
  try {
    return originalRss()
  } catch {
    return 0
  }
}

process.memoryUsage = safeMemoryUsage
