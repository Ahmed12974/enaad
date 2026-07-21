'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import {
  Award,
  BookOpen,
  Calculator,
  ChartNoAxesCombined,
  ClipboardCheck,
  Crown,
  House,
  Languages,
  LogOut,
  Menu,
  Plus,
  Settings,
  TriangleAlert,
} from 'lucide-react'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { SITE_NAME } from '@/lib/brand'
const links = [
  ['/', 'الرئيسية', House],
  ['/learn', 'الأقسام التعليمية', BookOpen],
  ['/english', 'اللغة الإنجليزية', Languages],
  ['/arabic', 'اللغة العربية', BookOpen],
  ['/add', 'إضافة كلمات وعبارات', Plus],
  ['/quiz', 'قسم الاختبارات', ClipboardCheck],
  ['/math', 'أقسام الرياضيات', Calculator],
  ['/competitions', 'المنافسات', Crown],
  ['/mistakes', 'كلمات أخطأت بها', TriangleAlert],
  ['/challenges', 'التحديات', Award],
  ['/achievements', 'الإنجازات والشهادات', Award],
  ['/results', 'قسم الإحصائيات', ChartNoAxesCombined],
  ['/account', 'أمان الحساب', Settings],
] as const
export function AppShell({
  children,
  name,
  isAdmin = false,
}: {
  children: React.ReactNode
  name: string
  isAdmin?: boolean
}) {
  const path = usePathname(),
    router = useRouter()
  useEffect(() => {
    const record = () => {
      if (document.visibilityState !== 'visible') return
      void fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, durationSeconds: 60 }),
        keepalive: true,
      })
    }
    const timer = window.setInterval(record, 60_000)
    return () => window.clearInterval(timer)
  }, [path])
  const navigation = isAdmin ? [...links, ['/admin', 'لوحة التحكم', Settings] as const] : links
  const mobile = [navigation[0], navigation[1], navigation[2], navigation[4]]
  const isActive = (href: string) => path === href || path.startsWith(href + '/')
  return (
    <div className="app-frame">
      <aside>
        <Link href="/" className="logo">
          <span>ز</span>
          <b>{SITE_NAME}</b>
          <small>تعليم العربية والإنجليزية والرياضيات</small>
        </Link>
        <div className="profile-mini">
          <span>{name.slice(0, 1)}</span>
          <div>
            <b>{name}</b>
            <small>متعلم مستمر</small>
          </div>
        </div>
        <nav>
          {navigation.map(([href, label, Icon]) => (
            <Link key={href} href={href} className={isActive(href) ? 'active' : ''}>
              <Icon />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <button
          className="logout"
          onClick={async () => {
            await authClient.signOut()
            router.push('/sign-in')
            router.refresh()
          }}
        >
          <LogOut /> تسجيل الخروج
        </button>
      </aside>
      <div className="main-column">
        <header>
          <div>
            <p>مرحباً بك،</p>
            <strong>{name}</strong>
          </div>
          <Link href="/add" className="quick-add">
            <Plus /> إضافة جديدة
          </Link>
        </header>
        {children}
      </div>
      <nav className="mobile-nav">
        {mobile.map(([href, label, Icon]) => (
          <Link key={href} href={href} className={isActive(href) ? 'active' : ''}>
            <Icon />
            <small>{label.replace('قسم ', '')}</small>
          </Link>
        ))}
        <Sheet>
          <SheetTrigger
            render={<button type="button" className="mobile-more" aria-label="عرض كل أقسام الموقع" />}
          >
            <Menu />
            <small>المزيد</small>
          </SheetTrigger>
          <SheetContent side="right" dir="rtl" className="mobile-menu-sheet">
            <SheetHeader>
              <SheetTitle>كل أقسام {SITE_NAME}</SheetTitle>
              <SheetDescription>انتقل إلى أي خاصية أو سجّل الخروج من حسابك.</SheetDescription>
            </SheetHeader>
            <nav className="mobile-menu-links">
              {navigation.map(([href, label, Icon]) => (
                <SheetClose
                  key={href}
                  render={<Link href={href} className={isActive(href) ? 'active' : ''} />}
                >
                  <Icon />
                  <span>{label}</span>
                </SheetClose>
              ))}
            </nav>
            <SheetFooter>
              <Button
                variant="outline"
                className="mobile-logout"
                onClick={async () => {
                  await authClient.signOut()
                  router.push('/sign-in')
                  router.refresh()
                }}
              >
                <LogOut data-icon="inline-start" />
                تسجيل الخروج
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </nav>
    </div>
  )
}
