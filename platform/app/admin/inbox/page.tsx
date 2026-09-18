import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { InboxConsole } from "@/components/admin/InboxConsole";

export default async function AdminInboxPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <InboxConsole />
    </>
  );
}
