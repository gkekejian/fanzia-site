import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { NotificationsConsole } from "@/components/admin/NotificationsConsole";

export default async function AdminNotificationsPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <NotificationsConsole />
    </>
  );
}
