import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { AgentProposalsConsole } from "@/components/admin/AgentProposalsConsole";

export default async function AdminAgentProposalsPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <AgentProposalsConsole />
    </>
  );
}
