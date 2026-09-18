import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { CatalogImportDetail } from "@/components/admin/CatalogImportDetail";

export default async function AdminCatalogImportDetailPage({ params }: { params: { id: string } }) {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <CatalogImportDetail importId={params.id} />
    </>
  );
}
