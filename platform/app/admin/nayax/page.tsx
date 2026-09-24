import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { ModuleOff } from "@/components/admin/ModuleOff";
import { isModuleEnabled } from "@/lib/config";
import { NayaxConsole } from "@/components/admin/NayaxConsole";

export default async function AdminNayaxPage() {
  const user = await requireOwnerPageUser();
  const enabled = await isModuleEnabled("module_vending");
  return (
    <>
      <AdminNav userName={user.name} />
      {enabled ? <NayaxConsole /> : <ModuleOff label="Vending" />}
    </>
  );
}
