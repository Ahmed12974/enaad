'use client'

import { useState, useTransition } from 'react'
import { FileSpreadsheet, Upload, CheckCircle2, AlertCircle } from 'lucide-react'
import { importMathWorkbook } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Section = { id: number; slug: string; name: string }
type Result = { added: number; skipped: number; duplicates: string[] }
export function MathImporter({ sections, counts }: { sections: Section[]; counts: Record<number, number> }) {
  const [section, setSection] = useState(sections[0]?.slug || ''),
    [files, setFiles] = useState<File[]>([]),
    [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(''),
    [pending, start] = useTransition()
  function selectFiles(list: FileList | null) {
    if (!list?.length) return
    setError('')
    setResult(null)
    const selected = Array.from(list)
    if (selected.length > 2) {
      setError('اختر ملفين كحد أقصى.')
      setFiles([])
      return
    }
    if (
      selected.some(
        (file) => !file.name.toLowerCase().endsWith('.xlsx') || !file.size || file.size > 2 * 1024 * 1024,
      )
    ) {
      setError('استخدم ملفات XLSX صحيحة لا يتجاوز حجم كل منها 2MB.')
      setFiles([])
      return
    }
    setFiles(selected)
  }
  function submit() {
    start(async () => {
      try {
        const form = new FormData()
        for (const file of files) form.append('files', file)
        const response = await importMathWorkbook(section, form)
        setResult(response)
        setFiles([])
      } catch (error) {
        setError(error instanceof Error ? error.message : 'تعذر استيراد الأسئلة')
      }
    })
  }
  return (
    <Card className="math-import-card">
      <CardHeader>
        <div className="math-import-heading">
          <div>
            <CardTitle>رفع بنك أسئلة الرياضيات</CardTitle>
            <CardDescription>
              ارفع ملفًا أو ملفين XLSX. تُقرأ الملفات وتُفحص على الخادم، وتُستبعد الأسئلة المكررة تلقائيًا.
            </CardDescription>
          </div>
          <FileSpreadsheet />
        </div>
      </CardHeader>
      <CardContent>
        <div className="math-import-controls">
          <label>
            القسم
            <select value={section} onChange={(event) => setSection(event.target.value)}>
              {sections.map((item) => (
                <option key={item.id} value={item.slug}>
                  {item.name} · {counts[item.id] || 0} سؤال
                </option>
              ))}
            </select>
          </label>
          <label className="file-drop">
            <Upload />
            <b>اختر ملف Excel</b>
            <span>بحد أقصى ملفان · XLSX فقط · 2MB لكل ملف</span>
            <input
              type="file"
              accept=".xlsx"
              multiple
              onChange={(event) => selectFiles(event.target.files)}
            />
          </label>
        </div>
        {files.length > 0 && (
          <div className="import-preview">
            <b>{files.length} ملف جاهز للفحص على الخادم</b>
            <span>{files.map((file) => file.name).join('، ')}</span>
          </div>
        )}
        <div className="import-template">
          <b>ترتيب الأعمدة المطلوب</b>
          <span>
            السؤال · اختيار 1 · اختيار 2 · اختيار 3 · اختيار 4 · الإجابة الصحيحة (1-4) · الشرح (اختياري)
          </span>
        </div>
        {error && (
          <p className="form-message error">
            <AlertCircle />
            {error}
          </p>
        )}
        {result && (
          <div className="form-message success">
            <CheckCircle2 />
            <div>
              <b>تمت معالجة الملف</b>
              <span>
                أضيف {result.added} سؤال، وتخطينا {result.skipped} مكرر أو مطابق.
              </span>
            </div>
          </div>
        )}
        <Button onClick={submit} disabled={!files.length || pending}>
          <Upload />
          {pending ? 'جارٍ الرفع والتحقق...' : 'فحص الملفات وإضافة الأسئلة'}
        </Button>
      </CardContent>
    </Card>
  )
}
