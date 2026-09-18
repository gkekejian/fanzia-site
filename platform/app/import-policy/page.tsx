import { PolicyPage } from "@/components/PolicyPage";
import { getPolicyPageProps } from "@/lib/policies/published";

export default async function ImportPolicyPage() {
  return <PolicyPage {...(await getPolicyPageProps("import_edition_acknowledgment"))} />;
}
