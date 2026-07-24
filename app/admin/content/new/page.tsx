import { ContentEditor } from '@/components/admin/content-editor'
import { getAdminContentEditorData } from '@/lib/admin-content'
export default async function NewContentPage() {
  return <ContentEditor data={await getAdminContentEditorData()} />
}
