import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { PoPacksConsole } from "@/components/admin/PoPacksConsole";

export default async function PoPacksPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <main className="admin-main">
        <h1>Distributor PO packs</h1>
        <p className="muted">
          Generate order packs from closed allocation rounds. The platform never auto-submits —
          download the pack, place the order in the distributor&apos;s own channel, then mark the round
          ordered with the confirmation number.
        </p>
        <PoPacksConsole />
      </main>
    </>
  );
}
