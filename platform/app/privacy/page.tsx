import { PolicyPage } from "@/components/PolicyPage";
import { getPolicyPageProps } from "@/lib/policies/published";

export default async function PrivacyPage() {
  return <PolicyPage {...(await getPolicyPageProps("privacy_policy"))} />;
}
