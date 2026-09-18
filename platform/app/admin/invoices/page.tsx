import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { InvoicesList } from "@/components/admin/InvoicesList";

export default async function AdminInvoicesPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <InvoicesList />
    </>
  );
}
