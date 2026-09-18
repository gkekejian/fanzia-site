import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { AllocationRoundDetail } from "@/components/admin/AllocationRoundDetail";

export default async function AdminAllocationRoundPage({ params }: { params: { id: string } }) {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <AllocationRoundDetail roundId={params.id} />
    </>
  );
}
