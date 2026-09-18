import { PolicyPage } from "@/components/PolicyPage";
import { getPolicyPageProps } from "@/lib/policies/published";

export default async function TermsPage() {
  return <PolicyPage {...(await getPolicyPageProps("terms_of_sale"))} />;
}
