import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { AccountsList } from "@/components/admin/AccountsList";

export default async function AdminAccountsPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <AccountsList />
    </>
  );
}
