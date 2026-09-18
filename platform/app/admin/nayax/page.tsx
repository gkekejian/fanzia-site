import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { NayaxConsole } from "@/components/admin/NayaxConsole";

export default async function AdminNayaxPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <NayaxConsole />
    </>
  );
}
