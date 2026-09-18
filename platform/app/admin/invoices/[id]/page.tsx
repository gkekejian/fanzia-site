import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { InvoiceDetail } from "@/components/admin/InvoiceDetail";

export default async function AdminInvoicePage({ params }: { params: { id: string } }) {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <InvoiceDetail invoiceId={params.id} />
    </>
  );
}
