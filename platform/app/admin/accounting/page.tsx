import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { ModuleOff } from "@/components/admin/ModuleOff";
import { isModuleEnabled } from "@/lib/config";
import { AccountingConsole } from "@/components/admin/AccountingConsole";

export default async function AdminAccountingPage() {
  const user = await requireOwnerPageUser();
  const enabled = await isModuleEnabled("module_accounting");
  return (
    <>
      <AdminNav userName={user.name} />
      {enabled ? <AccountingConsole /> : <ModuleOff label="The cashbook" />}
    </>
  );
}
