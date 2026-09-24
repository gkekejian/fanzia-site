import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { ModuleOff } from "@/components/admin/ModuleOff";
import { isModuleEnabled } from "@/lib/config";
import { PriceIntelConsole } from "@/components/admin/PriceIntelConsole";

export default async function PriceIntelPage() {
  const user = await requireOwnerPageUser();
  const enabled = await isModuleEnabled("module_price_intel");
  return (
    <>
      <AdminNav userName={user.name} />
      {enabled ? <PriceIntelConsole /> : <ModuleOff label="Price intelligence" />}
    </>
  );
}
