import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { ApiKeysConsole } from "@/components/admin/ApiKeysConsole";

export default async function AdminApiKeysPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <ApiKeysConsole />
    </>
  );
}
