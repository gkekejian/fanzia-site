import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { ApplicationsList } from "@/components/admin/ApplicationsList";

export default async function AdminApplicationsPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <ApplicationsList />
    </>
  );
}
