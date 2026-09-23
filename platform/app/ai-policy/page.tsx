import { PolicyPage } from "@/components/PolicyPage";
import { getPolicyPageProps } from "@/lib/policies/published";

export default async function AiPolicyPage() {
  return <PolicyPage {...(await getPolicyPageProps("ai_data_policy"))} />;
}
