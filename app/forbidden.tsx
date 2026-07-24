import Link from 'next/link'
import { ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Forbidden() {
  return (
    <main className="status-page" dir="rtl">
      <Card className="status-card">
        <CardHeader>
          <ShieldX aria-hidden="true" />
          <CardTitle>403 — الوصول مرفوض</CardTitle>
        </CardHeader>
        <CardContent>
          <p>هذا الحساب غير مخوّل لاستخدام لوحة التحكم أو خدماتها الإدارية.</p>
          <Button render={<Link href="/" />}>العودة إلى المنصة</Button>
        </CardContent>
      </Card>
    </main>
  )
}
