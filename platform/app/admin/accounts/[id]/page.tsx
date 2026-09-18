import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { AccountDetail } from "@/components/admin/AccountDetail";

export default async function AdminAccountDetailPage({ params }: { params: { id: string } }) {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <AccountDetail accountId={params.id} />
    </>
  );
}
