'use client'

import { Download } from 'lucide-react'

export function PrintCertificateButton() {
  return (
    <button type="button" className="print-certificate" onClick={() => window.print()}>
      <Download aria-hidden="true" />
      حفظ الشهادة PDF
    </button>
  )
}
