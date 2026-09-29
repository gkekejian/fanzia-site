import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { DropDetail } from "@/components/admin/DropDetail";

export default async function AdminDropPage({ params }: { params: { id: string } }) {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <DropDetail dropId={params.id} />
    </>
  );
}
