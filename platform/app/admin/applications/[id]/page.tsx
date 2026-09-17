import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { ApplicationDetail } from "@/components/admin/ApplicationDetail";

export default async function AdminApplicationDetailPage({ params }: { params: { id: string } }) {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <ApplicationDetail applicationId={params.id} />
    </>
  );
}
