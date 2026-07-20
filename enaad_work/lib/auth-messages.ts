type AuthErrorLike = {
  code?: string
  message?: string
  status?: number
  statusCode?: number
}

export function getArabicAuthError(error: AuthErrorLike | null | undefined, mode: 'sign-in' | 'sign-up') {
  const code = error?.code ?? ''
  const status = error?.status ?? error?.statusCode

  if (status === 429 || code.includes('RATE_LIMIT'))
    return 'محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم حاول مرة أخرى.'
  if (code === 'BANNED_USER')
    return 'هذا الحساب موقوف. تواصل مع إدارة المنصة إذا كنت تعتقد أن ذلك حدث بالخطأ.'
  if (code === 'EMAIL_NOT_VERIFIED') return 'يجب تأكيد البريد الإلكتروني قبل تسجيل الدخول.'
  if (code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL')
    return 'يوجد حساب بهذا البريد بالفعل. سجّل الدخول أو استخدم استعادة كلمة المرور.'
  if (code === 'PASSWORD_TOO_SHORT') return 'يجب أن تتكون كلمة المرور من 10 أحرف على الأقل.'
  if (code === 'PASSWORD_TOO_LONG') return 'كلمة المرور أطول من الحد المسموح.'
  if (code === 'INVALID_EMAIL') return 'أدخل بريدًا إلكترونيًا صحيحًا.'
  if (code === 'INVALID_EMAIL_OR_PASSWORD' || status === 401)
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
  if (code === 'FAILED_TO_CREATE_SESSION')
    return 'تم التحقق من البيانات، لكن تعذر إنشاء الجلسة. حاول مرة أخرى أو تواصل مع الدعم.'
  if (status && status >= 500)
    return 'الخدمة غير متاحة مؤقتًا بسبب مشكلة في الخادم أو قاعدة البيانات. حاول لاحقًا.'
  return mode === 'sign-up'
    ? 'تعذر إنشاء الحساب الآن. تحقق من البيانات ثم حاول مرة أخرى.'
    : 'تعذر تسجيل الدخول الآن. حاول مرة أخرى.'
}
