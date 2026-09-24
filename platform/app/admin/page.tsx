import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { TodayConsole } from "@/components/admin/TodayConsole";

/** Owner home: everything waiting on a human, most urgent first. */
export default async function AdminHomePage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <TodayConsole />
    </>
  );
}
