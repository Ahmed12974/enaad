import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin } from 'better-auth/plugins'
import { sendRecoveryEmail } from '@/lib/recovery'
import { normalizeEmail, redactSensitive } from '@/lib/security'
import { SITE_NAME } from '@/lib/brand'

export type AuthEnvironment = Record<string, string | undefined>

function asOrigin(value: string | undefined) {
  if (!value || value.includes('*')) return null
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

export function resolveAuthRuntime(env: AuthEnvironment = process.env) {
  const deploymentUrl = asOrigin(env.VERCEL_URL)
  const productionUrl = asOrigin(env.VERCEL_PROJECT_PRODUCTION_URL)
  const configuredUrl = asOrigin(env.BETTER_AUTH_URL)
  const publicUrl = asOrigin(env.NEXT_PUBLIC_APP_URL)
  const runtimeUrl = asOrigin(env.V0_RUNTIME_URL)
  const baseURL =
    configuredUrl ??
    publicUrl ??
    productionUrl ??
    deploymentUrl ??
    runtimeUrl ??
    (env.NODE_ENV === 'production' ? null : 'http://localhost:3000')

  if (!baseURL)
    throw new Error(
      'BETTER_AUTH_URL or NEXT_PUBLIC_APP_URL must be configured with the public application origin.',
    )
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be a stable, random value containing at least 32 characters.')
  }

  const configuredOrigins = (env.AUTH_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((value) => asOrigin(value.trim()))
    .filter(Boolean) as string[]
  const trustedOrigins = [
    ...new Set(
      [baseURL, publicUrl, deploymentUrl, productionUrl, runtimeUrl, ...configuredOrigins].filter(
        Boolean,
      ) as string[],
    ),
  ]

  if (
    env.NODE_ENV === 'production' &&
    trustedOrigins.some(
      (origin) =>
        origin.startsWith('http://') && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin),
    )
  ) {
    throw new Error('Production trusted origins must use HTTPS.')
  }

  return { baseURL, trustedOrigins, secret: env.BETTER_AUTH_SECRET }
}

export function createNormalizeAuthEmailPlugin(
  isRegistrationEnabled: () => Promise<boolean> = async () => true,
): BetterAuthPlugin {
  return {
    id: 'normalize-auth-email',
    hooks: {
      before: [
        {
          matcher: (context) =>
            Boolean(
              context.path &&
                [
                  '/sign-in/email',
                  '/sign-up/email',
                  '/request-password-reset',
                  '/send-verification-email',
                ].includes(context.path),
            ),
          handler: createAuthMiddleware(async (context) => {
            if (context.path === '/sign-up/email' && !(await isRegistrationEnabled()))
              throw new APIError('FORBIDDEN', {
                message: 'إنشاء الحسابات الجديدة متوقف مؤقتًا بواسطة إدارة المنصة.',
              })
            if (context.body && typeof context.body.email === 'string')
              context.body.email = normalizeEmail(context.body.email)
          }),
        },
      ],
    },
  }
}

export function createAuthOptions({
  database,
  env = process.env,
  isRegistrationEnabled,
}: {
  database: NonNullable<BetterAuthOptions['database']>
  env?: AuthEnvironment
  isRegistrationEnabled?: () => Promise<boolean>
}): BetterAuthOptions {
  const runtime = resolveAuthRuntime(env)
  const canSendEmail = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM)
  const trustedProxies = (env.AUTH_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return {
    appName: SITE_NAME,
    database,
    secret: runtime.secret,
    baseURL: runtime.baseURL,
    basePath: '/api/auth',
    disabledPaths: ['/request-password-reset', '/reset-password'],
    trustedOrigins: runtime.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    emailVerification: canSendEmail
      ? {
          expiresIn: 60 * 60,
          sendOnSignUp: true,
          autoSignInAfterVerification: true,
          async sendVerificationEmail({ user, url }) {
            await sendRecoveryEmail({
              to: user.email,
              subject: `تأكيد بريدك الإلكتروني في ${SITE_NAME}`,
              title: 'تأكيد البريد الإلكتروني',
              text: 'أكد بريدك حتى تتمكن الإدارة من منح حسابك صلاحيات موثوقة عند الحاجة.',
              actionLabel: 'تأكيد البريد',
              actionUrl: url,
            })
          },
        }
      : undefined,
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 8 },
        '/sign-up/email': { window: 300, max: 5 },
        '/request-password-reset': { window: 300, max: 5 },
        '/send-verification-email': { window: 900, max: 3 },
      },
    },
    plugins: [
      createNormalizeAuthEmailPlugin(isRegistrationEnabled),
      admin({
        defaultRole: 'user',
        adminRoles: ['admin'],
        bannedUserMessage: 'هذا الحساب موقوف. تواصل مع إدارة المنصة إذا كنت تعتقد أن ذلك حدث بالخطأ.',
      }),
    ],
    advanced: {
      cookiePrefix: 'lughati',
      useSecureCookies: runtime.baseURL.startsWith('https://'),
      ipAddress: {
        ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
        ...(trustedProxies.length ? { trustedProxies } : {}),
        ipv6Subnet: 64,
      },
    },
    logger: {
      level: env.NODE_ENV === 'development' ? 'info' : 'warn',
      log(level: 'error' | 'warn' | 'info' | 'debug', message: string, ...args: unknown[]) {
        const safeMessage = /invalid password|user not found/i.test(message)
          ? 'Authentication attempt rejected.'
          : redactSensitive(message)
        const safeArgs = args.map(redactSensitive)
        if (level === 'error') console.error(`[auth:${level}]`, safeMessage, ...safeArgs)
        else if (level === 'warn') console.warn(`[auth:${level}]`, safeMessage, ...safeArgs)
        else if (env.NODE_ENV === 'development') console.info(`[auth:${level}]`, safeMessage, ...safeArgs)
      },
    },
  }
}
