import { NextRequest, NextResponse } from 'next/server'
import { getAuditRequestContext, writeAdminAudit } from '@/lib/admin-audit'
import { ForbiddenError, UnauthorizedError } from '@/lib/admin-policy'
import { requirePermission } from '@/lib/auth-session'
import { db } from '@/lib/db'
import { queryUsersForExport, sanitizedReportName } from '@/lib/admin-user-export'
import { neutralizeSpreadsheetCell } from '@/lib/export-security'
import { consumeRateLimit } from '@/lib/rate-limit'

function csvCell(value: unknown) {
  return `"${neutralizeSpreadsheetCell(value).replaceAll('"', '""')}"`
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requirePermission('reports:read')
    const limit = await consumeRateLimit(`admin-report:${actor.id}`, 10, 60)
    if (!limit.allowed)
      return NextResponse.json(
        { error: 'طلبات تصدير كثيرة.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      )
    const rows = await queryUsersForExport(request.nextUrl.searchParams)
    const header = [
      'رقم المستخدم',
      'الاسم',
      'البريد',
      'البريد موثق',
      'تاريخ التسجيل',
      'الحالة',
      'المستوى',
      'النقاط',
      'العملات',
      'الاستمرار',
      'آخر نشاط',
    ]
    const body = [
      header.map(csvCell).join(','),
      ...rows.map((row) =>
        [
          row.id,
          row.name,
          row.email,
          row.emailVerified ? 'نعم' : 'لا',
          row.createdAt.toISOString(),
          row.status ?? 'active',
          row.level ?? '',
          row.points ?? 0,
          row.coins ?? 0,
          row.streak ?? 0,
          row.lastActiveAt?.toISOString() ?? '',
        ]
          .map(csvCell)
          .join(','),
      ),
    ].join('\r\n')
    const context = await getAuditRequestContext()
    await db.transaction((tx) =>
      writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'report.users.export',
          entityType: 'report',
          entityId: 'users-csv',
          after: { records: rows.length, filters: Object.fromEntries(request.nextUrl.searchParams) },
        },
        context,
      ),
    )
    return new NextResponse(`\uFEFF${body}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${sanitizedReportName(request.nextUrl.searchParams.get('report'))}-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError)
      return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'تعذر تصدير التقرير.' }, { status: 500 })
  }
}
