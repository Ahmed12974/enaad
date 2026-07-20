import { ShieldAlert } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function AccountSuspendedPage() {
  return (
    <main className="verification-page">
      <Card className="recovery-card">
        <CardHeader>
          <div className="account-icon">
            <ShieldAlert />
          </div>
          <CardTitle>الحساب موقوف</CardTitle>
        </CardHeader>
        <CardContent>
          <p>لا يمكن استخدام هذا الحساب حاليًا. تواصل مع إدارة المنصة إذا كنت تعتقد أن الإيقاف حدث بالخطأ.</p>
        </CardContent>
      </Card>
    </main>
  )
}
