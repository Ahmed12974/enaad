import { notFound } from 'next/navigation'
import { ContentEditor } from '@/components/admin/content-editor'
import { getAdminContentEditorData } from '@/lib/admin-content'
export default async function EditContentPage({ params }: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await params
  const data = await getAdminContentEditorData(contentId)
  if (!data.current) notFound()
  return <ContentEditor data={data} />
}
