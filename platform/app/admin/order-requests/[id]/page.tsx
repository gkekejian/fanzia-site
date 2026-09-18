import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { OrderRequestDetail } from "@/components/admin/OrderRequestDetail";

export default async function AdminOrderRequestPage({ params }: { params: { id: string } }) {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <OrderRequestDetail requestId={params.id} />
    </>
  );
}
