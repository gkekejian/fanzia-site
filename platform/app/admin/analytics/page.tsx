import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { AnalyticsConsole } from "@/components/admin/AnalyticsConsole";

export default async function AnalyticsPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <AnalyticsConsole />
    </>
  );
}
