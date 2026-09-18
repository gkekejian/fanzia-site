import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { AccountingConsole } from "@/components/admin/AccountingConsole";

export default async function AdminAccountingPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <AccountingConsole />
    </>
  );
}
