import { and, eq, isNull } from 'drizzle-orm'
import { CheckCircle2, ShieldX } from 'lucide-react'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { certificates, user } from '@/lib/db/schema'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'التحقق من الشهادة', robots: { index: false, follow: false } }

export default async function VerifyCertificatePage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId)) notFound()
  const [record] = await db
    .select({
      title: certificates.title,
      certificateNumber: certificates.certificateNumber,
      issuedAt: certificates.issuedAt,
      revokedAt: certificates.revokedAt,
      revokeReason: certificates.revokeReason,
      learnerName: user.name,
    })
    .from(certificates)
    .innerJoin(user, and(eq(certificates.userId, user.id), isNull(user.deletedAt)))
    .where(eq(certificates.publicId, publicId))
    .limit(1)
  if (!record) notFound()
  const valid = !record.revokedAt
  return (
    <main className="verification-page">
      <Card className="recovery-card">
        <CardHeader>
          <div className="account-icon">{valid ? <CheckCircle2 /> : <ShieldX />}</div>
          <CardTitle>{valid ? 'شهادة صحيحة وموثقة' : 'هذه الشهادة ملغاة'}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant={valid ? 'default' : 'destructive'}>
            <AlertTitle>{record.title}</AlertTitle>
            <AlertDescription>
              <p>
                صاحب الشهادة: <strong>{record.learnerName}</strong>
              </p>
              <p>
                رقم الشهادة: <b dir="ltr">{record.certificateNumber}</b>
              </p>
              <p>تاريخ الإصدار: {record.issuedAt.toLocaleDateString('ar-EG')}</p>
              {!valid && record.revokeReason && <p>سبب الإلغاء: {record.revokeReason}</p>}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </main>
  )
}
