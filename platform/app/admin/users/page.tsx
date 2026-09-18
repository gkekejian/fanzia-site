import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { UsersConsole } from "@/components/admin/UsersConsole";

export default async function AdminUsersPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <UsersConsole />
    </>
  );
}
