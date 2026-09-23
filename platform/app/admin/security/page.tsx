import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { SecurityConsole } from "@/components/admin/SecurityConsole";

export default async function SecurityPage() {
  await requireOwnerPageUser();
  return <SecurityConsole />;
}
