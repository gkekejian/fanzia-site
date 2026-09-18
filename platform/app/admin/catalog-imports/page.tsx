import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { CatalogImportsList } from "@/components/admin/CatalogImportsList";

export default async function AdminCatalogImportsPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <CatalogImportsList />
    </>
  );
}
