import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { TotpSetup } from "@/components/admin/TotpSetup";

export default async function TotpSetupPage() {
  await requireOwnerPageUser();
  return <TotpSetup />;
}
