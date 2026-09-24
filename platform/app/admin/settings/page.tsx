import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { SettingsConsole } from "@/components/admin/SettingsConsole";

export default async function SettingsPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <SettingsConsole />
    </>
  );
}
