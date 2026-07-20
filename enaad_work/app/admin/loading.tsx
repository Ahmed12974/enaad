export default function AdminLoading() {
  return (
    <main className="admin-console" dir="rtl" aria-busy="true" aria-live="polite">
      <span className="sr-only">جارٍ تحميل لوحة التحكم</span>
      <div className="admin-loading-block admin-loading-title" />
      <div className="admin-kpis">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="admin-loading-block admin-loading-card" key={index} />
        ))}
      </div>
      <div className="admin-loading-block admin-loading-table" />
    </main>
  )
}
