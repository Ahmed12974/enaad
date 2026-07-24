import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { certificates } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import QRCode from 'qrcode'
import Image from 'next/image'
import { PrintCertificateButton } from '@/components/print-certificate-button'
import { getAppUrl } from '@/lib/recovery'

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const { id } = await params
  const [certificate] = await db
    .select()
    .from(certificates)
    .where(and(eq(certificates.id, Number(id)), eq(certificates.userId, session.user.id)))
    .limit(1)
  if (!certificate) notFound()
  const verification = `${getAppUrl()}/certificates/verify/${certificate.publicId}`
  const qr = await QRCode.toDataURL(verification, {
    width: 180,
    margin: 1,
    color: { dark: '#123c32', light: '#fffaf0' },
  })
  return (
    <main className="certificate-page">
      <article className="certificate-paper">
        <div className="certificate-inner">
          <header className="certificate-header">
            <span>أكاديمية زايد التعليمية</span>
            <small>شهادة إنجاز موثقة</small>
          </header>
          {certificate.revokedAt && <p className="error">هذه الشهادة ملغاة ولا تُعد صالحة للتحقق.</p>}
          <p className="certificate-kicker">تشهد أكاديمية زايد التعليمية بأن المتعلم</p>
          <h1>{session.user.name}</h1>
          <p className="certificate-copy">قد أتم بنجاح متطلبات الإنجاز</p>
          <h2>{certificate.title}</h2>
          <div className="certificate-seal">
            <b>أكاديمية زايد التعليمية</b>
            <span>إنجاز</span>
          </div>
          <footer>
            <div>
              <b>
                {certificate.issuedAt.toLocaleDateString('ar-EG', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </b>
              <span>تاريخ الإصدار</span>
            </div>
            <div className="certificate-verify">
              <Image
                src={qr}
                width={88}
                height={88}
                unoptimized
                alt={`رمز التحقق للشهادة ${certificate.certificateNumber}`}
              />
              <small>امسح للتحقق من صحة الشهادة</small>
            </div>
            <div>
              <b dir="ltr">{certificate.certificateNumber}</b>
              <span>رقم الشهادة</span>
            </div>
          </footer>
        </div>
      </article>
      <PrintCertificateButton />
    </main>
  )
}
