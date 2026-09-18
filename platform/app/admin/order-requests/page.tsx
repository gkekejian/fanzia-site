import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { OrderRequestsList } from "@/components/admin/OrderRequestsList";

export default async function AdminOrderRequestsPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <OrderRequestsList />
    </>
  );
}
