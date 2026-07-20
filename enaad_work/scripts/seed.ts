import { pool, db } from '@/lib/db'
import { and, eq, sql } from 'drizzle-orm'
import {
  achievements,
  adminAllowlist,
  auditLogs,
  categories,
  educationalSections,
  encouragementMessages,
  levels,
  mathQuestions,
  mathSections,
  user,
} from '@/lib/db/schema'
import { SOLE_ADMIN_EMAIL } from '@/lib/admin-policy'
import { normalizeText } from '@/lib/utils'

type MathSeedQuestion = {
  question: string
  normalizedQuestion: string
  option1: string
  option2: string
  option3: string
  option4: string
  correctOption: 1 | 2 | 3 | 4
  explanation: string
  isActive: boolean
}

function makeMathQuestion(
  question: string,
  correctAnswer: string,
  distractors: [string, string, string],
  index: number,
  explanation: string,
): MathSeedQuestion {
  const correctOption = ((index % 4) + 1) as 1 | 2 | 3 | 4
  const choices = [...distractors]
  choices.splice(correctOption - 1, 0, correctAnswer)
  return {
    question,
    normalizedQuestion: normalizeText(question),
    option1: choices[0]!,
    option2: choices[1]!,
    option3: choices[2]!,
    option4: choices[3]!,
    correctOption,
    explanation,
    isActive: true,
  }
}

const basicsQuestionData: Array<[string, string, [string, string, string], string]> = [
  ['ما ناتج 7 + 5؟', '12', ['10', '11', '13'], 'نجمع 7 و5 فنحصل على 12.'],
  ['ما ناتج 9 + 8؟', '17', ['15', '16', '18'], 'نجمع 9 و8 فنحصل على 17.'],
  ['ما ناتج 14 + 6؟', '20', ['18', '19', '21'], '14 + 6 = 20.'],
  ['ما ناتج 23 + 17؟', '40', ['38', '39', '41'], '23 + 17 = 40.'],
  ['ما ناتج 35 + 28؟', '63', ['61', '62', '64'], '35 + 28 = 63.'],
  ['ما ناتج 46 + 19؟', '65', ['63', '64', '66'], '46 + 19 = 65.'],
  ['ما ناتج 125 + 75؟', '200', ['190', '195', '205'], '125 + 75 = 200.'],
  ['ما ناتج 208 + 92؟', '300', ['290', '298', '302'], '208 + 92 = 300.'],
  ['ما ناتج 18 - 7؟', '11', ['9', '10', '12'], '18 - 7 = 11.'],
  ['ما ناتج 30 - 16؟', '14', ['12', '13', '15'], '30 - 16 = 14.'],
  ['ما ناتج 52 - 27؟', '25', ['23', '24', '26'], '52 - 27 = 25.'],
  ['ما ناتج 100 - 46؟', '54', ['52', '53', '55'], '100 - 46 = 54.'],
  ['ما ناتج 250 - 125؟', '125', ['115', '120', '130'], '250 - 125 = 125.'],
  ['ما ناتج 6 × 4؟', '24', ['20', '22', '28'], '6 × 4 = 24.'],
  ['ما ناتج 7 × 8؟', '56', ['48', '54', '64'], '7 × 8 = 56.'],
  ['ما ناتج 9 × 6؟', '54', ['45', '48', '56'], '9 × 6 = 54.'],
  ['ما ناتج 12 × 5؟', '60', ['50', '55', '65'], '12 × 5 = 60.'],
  ['ما ناتج 11 × 11؟', '121', ['111', '120', '122'], '11 × 11 = 121.'],
  ['ما ناتج 15 × 4؟', '60', ['45', '55', '65'], '15 × 4 = 60.'],
  ['ما ناتج 72 ÷ 8؟', '9', ['7', '8', '10'], '72 ÷ 8 = 9.'],
  ['ما ناتج 63 ÷ 7؟', '9', ['6', '8', '10'], '63 ÷ 7 = 9.'],
  ['ما ناتج 96 ÷ 12؟', '8', ['6', '7', '9'], '96 ÷ 12 = 8.'],
  ['ما ناتج 144 ÷ 12؟', '12', ['10', '11', '14'], '144 ÷ 12 = 12.'],
  ['أي عدد زوجي؟', '18', ['13', '15', '21'], 'العدد الزوجي يقبل القسمة على 2 دون باقٍ.'],
  ['أي عدد فردي؟', '27', ['14', '20', '32'], '27 لا يقبل القسمة على 2 دون باقٍ.'],
  ['ما قيمة المنزلة للرقم 5 في العدد 352؟', '50', ['5', '500', '52'], 'الرقم 5 في منزلة العشرات، وقيمته 50.'],
  ['ما العدد التالي في النمط: 2، 4، 6، 8، ...؟', '10', ['9', '11', '12'], 'النمط يزيد بمقدار 2 كل مرة.'],
  ['ما العدد السابق للعدد 100؟', '99', ['98', '100', '101'], 'العدد السابق مباشرة لـ100 هو 99.'],
  ['كم يساوي نصف العدد 18؟', '9', ['6', '8', '10'], 'نصف 18 يساوي 18 ÷ 2 = 9.'],
  ['كم يساوي ضعف العدد 14؟', '28', ['24', '26', '30'], 'ضعف 14 يساوي 14 × 2 = 28.'],
]

const fractionsQuestionData: Array<[string, string, [string, string, string], string]> = [
  ['أي كسر يساوي النصف؟', '1/2', ['1/3', '2/3', '3/4'], 'النصف يكتب 1/2.'],
  ['أي كسر مكافئ لـ 1/2؟', '2/4', ['1/4', '2/3', '3/4'], 'نضرب البسط والمقام في 2 فنحصل على 2/4.'],
  ['أي كسر مكافئ لـ 2/3؟', '4/6', ['3/6', '4/5', '5/6'], 'نضرب البسط والمقام في 2 فنحصل على 4/6.'],
  ['ما ناتج 1/4 + 2/4؟', '3/4', ['2/4', '3/8', '1'], 'عند تساوي المقامات نجمع البسوط: 1 + 2 = 3.'],
  ['ما ناتج 3/5 + 1/5؟', '4/5', ['3/10', '4/10', '1'], 'نجمع البسوط ونبقي المقام 5.'],
  ['ما ناتج 5/8 - 2/8؟', '3/8', ['2/8', '3/16', '7/8'], 'نطرح البسوط ونبقي المقام 8.'],
  ['ما ناتج 7/10 - 3/10؟', '4/10', ['3/10', '4/20', '10/10'], '7/10 - 3/10 = 4/10.'],
  ['أي الكسرين أكبر: 3/4 أم 2/4؟', '3/4', ['2/4', 'متساويان', 'لا يمكن المقارنة'], 'عند تساوي المقام يكون الأكبر هو صاحب البسط الأكبر.'],
  ['أي الكسرين أصغر: 1/3 أم 2/3؟', '1/3', ['2/3', 'متساويان', '3/3'], 'عند تساوي المقام يكون الأصغر هو صاحب البسط الأصغر.'],
  ['ما الكسر الذي يمثل جزءًا واحدًا من 5 أجزاء متساوية؟', '1/5', ['1/4', '2/5', '5/1'], 'جزء واحد من خمسة أجزاء يكتب 1/5.'],
  ['كم يساوي 1/2 من العدد 20؟', '10', ['5', '8', '12'], '20 ÷ 2 = 10.'],
  ['كم يساوي 1/4 من العدد 24؟', '6', ['4', '8', '12'], '24 ÷ 4 = 6.'],
  ['كم يساوي 3/4 من العدد 20؟', '15', ['10', '12', '16'], 'ربع 20 يساوي 5، وثلاثة أرباع تساوي 15.'],
  ['كم يساوي 2/5 من العدد 25؟', '10', ['5', '12', '15'], 'خمس 25 يساوي 5، إذن 2/5 يساوي 10.'],
  ['ما الصورة العشرية للكسر 1/2؟', '0.5', ['0.2', '0.25', '1.5'], '1 ÷ 2 = 0.5.'],
  ['ما الصورة العشرية للكسر 1/4؟', '0.25', ['0.4', '0.5', '0.75'], '1 ÷ 4 = 0.25.'],
  ['ما الصورة العشرية للكسر 3/4؟', '0.75', ['0.25', '0.5', '0.8'], '3 ÷ 4 = 0.75.'],
  ['أي كسر يساوي العدد 1؟', '5/5', ['1/5', '4/5', '5/4'], 'عندما يتساوى البسط والمقام تكون قيمة الكسر 1.'],
  ['بسّط الكسر 2/4.', '1/2', ['1/4', '2/2', '2/3'], 'نقسم البسط والمقام على 2 فنحصل على 1/2.'],
  ['بسّط الكسر 6/9.', '2/3', ['3/4', '6/3', '1/3'], 'نقسم البسط والمقام على 3 فنحصل على 2/3.'],
  ['بسّط الكسر 8/12.', '2/3', ['3/4', '4/5', '1/2'], 'نقسم البسط والمقام على 4 فنحصل على 2/3.'],
  ['ما ناتج 1/2 + 1/4؟', '3/4', ['2/6', '1/6', '1'], 'نحوّل 1/2 إلى 2/4 ثم نجمع: 2/4 + 1/4 = 3/4.'],
  ['ما ناتج 2/3 + 1/6؟', '5/6', ['3/9', '3/6', '1'], '2/3 = 4/6، ثم 4/6 + 1/6 = 5/6.'],
  ['ما ناتج 3/4 - 1/2؟', '1/4', ['1/2', '2/4', '3/8'], '1/2 = 2/4، إذن 3/4 - 2/4 = 1/4.'],
  ['ما ناتج 5/6 - 1/3؟', '1/2', ['2/3', '4/3', '1/3'], '1/3 = 2/6، إذن 5/6 - 2/6 = 3/6 = 1/2.'],
  ['رتّب من الأصغر: 1/4، 1/2، 3/4.', '1/4 ثم 1/2 ثم 3/4', ['3/4 ثم 1/2 ثم 1/4', '1/2 ثم 1/4 ثم 3/4', '1/4 ثم 3/4 ثم 1/2'], 'الأرباع بالترتيب هي 1/4 ثم 2/4 ثم 3/4.'],
  ['إذا أكلت 2 من 8 قطع، فما الكسر الذي يمثل المأكول؟', '2/8', ['6/8', '2/6', '8/2'], 'المأكول قطعتان من أصل 8، فيمثل 2/8.'],
  ['إذا كان 3/5 من الطلاب ناجحين، فما الجزء غير الناجح؟', '2/5', ['1/5', '3/5', '4/5'], 'الكل 5/5، و5/5 - 3/5 = 2/5.'],
  ['أي كسر أكبر من 1؟', '5/4', ['1/4', '3/4', '4/5'], 'الكسر يكون أكبر من 1 عندما يكون البسط أكبر من المقام.'],
  ['ما العدد الكسري المكافئ لـ 7/4؟', '1 و3/4', ['1 و1/4', '2 و1/4', '3 و1/4'], '7 ÷ 4 = 1 والباقي 3، إذن 1 و3/4.'],
]

const algebraQuestionData: Array<[string, string, [string, string, string], string]> = [
  ['إذا كان س + 3 = 8، فما قيمة س؟', '5', ['3', '8', '11'], 'نطرح 3 من الطرفين فنحصل على س = 5.'],
  ['إذا كان س + 7 = 15، فما قيمة س؟', '8', ['7', '15', '22'], '15 - 7 = 8.'],
  ['إذا كان س - 4 = 9، فما قيمة س؟', '13', ['5', '9', '12'], 'نضيف 4 للطرفين فنحصل على س = 13.'],
  ['إذا كان س - 12 = 5، فما قيمة س؟', '17', ['7', '12', '60'], 'نضيف 12 للطرفين: س = 17.'],
  ['إذا كان 2س = 14، فما قيمة س؟', '7', ['6', '12', '28'], 'نقسم الطرفين على 2 فنحصل على س = 7.'],
  ['إذا كان 3س = 21، فما قيمة س؟', '7', ['6', '8', '18'], '21 ÷ 3 = 7.'],
  ['إذا كان 5س = 40، فما قيمة س؟', '8', ['5', '10', '35'], '40 ÷ 5 = 8.'],
  ['إذا كان س ÷ 4 = 6، فما قيمة س؟', '24', ['10', '18', '28'], 'نضرب الطرفين في 4 فنحصل على س = 24.'],
  ['إذا كان 2س + 3 = 13، فما قيمة س؟', '5', ['4', '6', '8'], 'نطرح 3 ثم نقسم على 2: س = 5.'],
  ['إذا كان 3س + 2 = 17، فما قيمة س؟', '5', ['3', '6', '15'], 'نطرح 2 فيصبح 3س = 15، ثم نقسم على 3.'],
  ['إذا كان 4س - 4 = 12، فما قيمة س؟', '4', ['2', '3', '8'], 'نضيف 4 فيصبح 4س = 16، ثم نقسم على 4.'],
  ['إذا كان 5س - 10 = 15، فما قيمة س؟', '5', ['1', '3', '25'], 'نضيف 10 فيصبح 5س = 25، ثم نقسم على 5.'],
  ['ما قيمة 2س + 1 عندما س = 3؟', '7', ['5', '6', '8'], '2 × 3 + 1 = 7.'],
  ['ما قيمة 3س - 2 عندما س = 4؟', '10', ['8', '9', '12'], '3 × 4 - 2 = 10.'],
  ['ما قيمة س² عندما س = 5؟', '25', ['10', '15', '20'], '5² = 5 × 5 = 25.'],
  ['ما قيمة 2س² عندما س = 3؟', '18', ['9', '12', '36'], '2 × 3² = 2 × 9 = 18.'],
  ['بسّط: 3س + 2س.', '5س', ['5', '6س', 'س²'], 'نجمع الحدود المتشابهة: 3س + 2س = 5س.'],
  ['بسّط: 7س - 4س.', '3س', ['3', '11س', 'س'], 'نطرح معاملات الحدود المتشابهة: 7 - 4 = 3.'],
  ['بسّط: 2(س + 3).', '2س + 6', ['2س + 3', 'س + 6', '2س + 5'], 'نوزع 2 على س وعلى 3.'],
  ['بسّط: 3(س - 2).', '3س - 6', ['3س - 2', 'س - 6', '3س + 6'], 'نوزع 3 على الحدين.'],
  ['أي تعبير يمثل ثلاثة أمثال عدد س؟', '3س', ['س + 3', 'س - 3', 'س ÷ 3'], 'ثلاثة أمثال س تعني 3 × س.'],
  ['أي تعبير يمثل عددًا يزيد 5 عن س؟', 'س + 5', ['5س', 'س - 5', '5 - س'], 'الزيادة بمقدار 5 تعني إضافة 5.'],
  ['أي تعبير يمثل عددًا يقل 4 عن س؟', 'س - 4', ['4 - س', '4س', 'س + 4'], 'النقص بمقدار 4 يعني طرح 4 من س.'],
  ['ما الحد التالي في النمط: 3، 6، 9، 12، ...؟', '15', ['13', '14', '18'], 'النمط يزيد 3 في كل مرة.'],
  ['ما الحد التالي في النمط: 2، 4، 8، 16، ...؟', '32', ['18', '24', '30'], 'كل حد يساوي ضعف الحد السابق.'],
  ['إذا كان محيط مربع 20 سم، فما طول ضلعه؟', '5 سم', ['4 سم', '10 سم', '20 سم'], 'طول الضلع = المحيط ÷ 4 = 5 سم.'],
  ['إذا كان ص = س + 2، فما قيمة ص عندما س = 6؟', '8', ['4', '6', '12'], 'نعوّض س = 6: ص = 6 + 2 = 8.'],
  ['إذا كان ص = 2س، فما قيمة ص عندما س = 7؟', '14', ['7', '9', '21'], 'ص = 2 × 7 = 14.'],
  ['حل المعادلة: 2س + 4 = 20.', '8', ['6', '10', '12'], 'نطرح 4 فيصبح 2س = 16، ثم نقسم على 2.'],
  ['حل المعادلة: 6س - 6 = 30.', '6', ['4', '5', '36'], 'نضيف 6 فيصبح 6س = 36، ثم نقسم على 6.'],
]

const mathQuestionBanks: Record<string, MathSeedQuestion[]> = {
  basics: basicsQuestionData.map(([question, answer, distractors, explanation], index) =>
    makeMathQuestion(question, answer, distractors, index, explanation),
  ),
  fractions: fractionsQuestionData.map(([question, answer, distractors, explanation], index) =>
    makeMathQuestion(question, answer, distractors, index, explanation),
  ),
  algebra: algebraQuestionData.map(([question, answer, distractors, explanation], index) =>
    makeMathQuestion(question, answer, distractors, index, explanation),
  ),
}

async function seed() {
  await db.transaction(async (tx) => {
    await tx
      .insert(adminAllowlist)
      .values({ email: SOLE_ADMIN_EMAIL, role: 'SUPER_ADMIN', isActive: true })
      .onConflictDoUpdate({
        target: adminAllowlist.email,
        set: { role: 'SUPER_ADMIN', isActive: true, updatedAt: new Date() },
      })

    const [adminAccount] = await tx
      .select({ id: user.id, role: user.role, emailVerified: user.emailVerified })
      .from(user)
      .where(
        and(
          sql`lower(trim(${user.email})) = ${SOLE_ADMIN_EMAIL}`,
          eq(user.emailVerified, true),
          sql`${user.deletedAt} is null`,
        ),
      )
      .limit(1)
    if (adminAccount && adminAccount.role !== 'admin') {
      await tx.update(user).set({ role: 'admin', updatedAt: new Date() }).where(eq(user.id, adminAccount.id))
      await tx.insert(auditLogs).values({
        actorUserId: adminAccount.id,
        action: 'bootstrap_admin',
        entityType: 'user',
        entityId: adminAccount.id,
        before: { role: adminAccount.role },
        after: { role: 'admin', allowlistedEmail: SOLE_ADMIN_EMAIL },
        reason: 'Secure seed promoted the verified sole administrator account.',
      })
    }

    await tx
      .insert(levels)
      .values([
        { name: 'مبتدئ', rank: 1, minimumPoints: 0, color: '#64748b' },
        { name: 'متعلّم', rank: 2, minimumPoints: 500, color: '#0ea5e9' },
        { name: 'متقدّم', rank: 3, minimumPoints: 1500, color: '#8b5cf6' },
        { name: 'خبير', rank: 4, minimumPoints: 4000, color: '#f59e0b' },
      ])
      .onConflictDoNothing()

    await tx
      .insert(educationalSections)
      .values([
        {
          name: 'العربية',
          slug: 'arabic',
          shortDescription: 'مسارات تعلم اللغة العربية',
          color: '#14b8a6',
          access: 'free',
          status: 'published',
          sortOrder: 10,
        },
        {
          name: 'English',
          slug: 'english',
          shortDescription: 'English learning paths',
          color: '#3b82f6',
          access: 'free',
          status: 'published',
          sortOrder: 20,
        },
        {
          name: 'الرياضيات',
          slug: 'mathematics',
          shortDescription: 'مسارات الرياضيات والمهارات الحسابية',
          color: '#8b5cf6',
          access: 'free',
          status: 'published',
          sortOrder: 30,
        },
        {
          name: 'القراءة',
          slug: 'reading',
          shortDescription: 'قصص وأنشطة الفهم القرائي',
          color: '#f59e0b',
          access: 'free',
          status: 'draft',
          sortOrder: 40,
        },
        {
          name: 'العلوم',
          slug: 'science',
          shortDescription: 'محتوى العلوم والأنشطة الاستكشافية',
          color: '#22c55e',
          access: 'free',
          status: 'draft',
          sortOrder: 50,
        },
      ])
      .onConflictDoNothing()

    await tx
      .insert(categories)
      .values([
        {
          scope: 'platform',
          userId: null,
          language: 'ar',
          name: 'عام',
          normalizedName: 'عام',
          slug: 'arabic-general',
          description: 'الكلمات العربية العامة',
          sortOrder: 10,
        },
        {
          scope: 'platform',
          userId: null,
          language: 'en',
          name: 'General',
          normalizedName: 'general',
          slug: 'english-general',
          description: 'General English vocabulary',
          sortOrder: 10,
        },
        {
          scope: 'platform',
          userId: null,
          language: 'en',
          name: 'Daily life',
          normalizedName: 'daily life',
          slug: 'daily-life',
          description: 'Everyday English vocabulary',
          sortOrder: 20,
        },
      ])
      .onConflictDoNothing()

    await tx
      .insert(mathSections)
      .values([
        {
          slug: 'basics',
          name: 'الأساسيات',
          normalizedName: 'الأساسيات',
          description: 'الجمع والطرح والضرب والقسمة',
          sortOrder: 10,
        },
        {
          slug: 'fractions',
          name: 'الكسور',
          normalizedName: 'الكسور',
          description: 'الكسور والنسب',
          sortOrder: 20,
        },
        {
          slug: 'algebra',
          name: 'الجبر',
          normalizedName: 'الجبر',
          description: 'المعادلات والمفاهيم الجبرية',
          sortOrder: 30,
        },
      ])
      .onConflictDoNothing()

    const seededMathSections = await tx
      .select({ id: mathSections.id, slug: mathSections.slug })
      .from(mathSections)
    for (const section of seededMathSections) {
      const questions = mathQuestionBanks[section.slug]
      if (!questions?.length) continue
      await tx
        .insert(mathQuestions)
        .values(questions.map((question) => ({ sectionId: section.id, ...question })))
        .onConflictDoNothing()
    }

    await tx
      .insert(achievements)
      .values([
        {
          name: 'البداية',
          description: 'إضافة أول كلمة',
          requirementType: 'words',
          requirementValue: 1,
          xpReward: 10,
          coinReward: 2,
          sortOrder: 10,
        },
        {
          name: 'جامع الكلمات',
          description: 'إضافة 100 كلمة',
          requirementType: 'words',
          requirementValue: 100,
          xpReward: 100,
          coinReward: 25,
          sortOrder: 20,
        },
        {
          name: 'المراجع المثابر',
          description: 'إكمال 50 مراجعة',
          requirementType: 'reviews',
          requirementValue: 50,
          xpReward: 75,
          coinReward: 20,
          sortOrder: 30,
        },
      ])
      .onConflictDoNothing()

    await tx
      .insert(encouragementMessages)
      .values([
        { message: 'كل خطوة صغيرة تقرّبك من الطلاقة.', minProgress: 0, maxProgress: 39, sortOrder: 10 },
        { message: 'أنت في منتصف الطريق، استمر!', minProgress: 40, maxProgress: 79, sortOrder: 20 },
        { message: 'إنجاز رائع؛ بقي القليل.', minProgress: 80, maxProgress: 100, sortOrder: 30 },
      ])
      .onConflictDoNothing()
  })
  console.info('Seed completed successfully.')
}

seed()
  .catch((error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : 'unknown database error')
    process.exitCode = 1
  })
  .finally(() => pool.end())
