import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { AllocationRoundsList } from "@/components/admin/AllocationRoundsList";

export default async function AdminAllocationRoundsPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <AllocationRoundsList />
    </>
  );
}
