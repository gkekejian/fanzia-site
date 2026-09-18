import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { PriceIntelConsole } from "@/components/admin/PriceIntelConsole";

export default async function PriceIntelPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <PriceIntelConsole />
    </>
  );
}
