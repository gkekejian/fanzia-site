import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { SystemStatus } from "@/components/admin/SystemStatus";

export default async function SystemStatusPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <SystemStatus />
    </>
  );
}
