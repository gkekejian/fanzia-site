import { PolicyPage } from "@/components/PolicyPage";
import { getPolicyPageProps } from "@/lib/policies/published";

export default async function ReturnsPage() {
  return <PolicyPage {...(await getPolicyPageProps("returns_policy"))} />;
}
