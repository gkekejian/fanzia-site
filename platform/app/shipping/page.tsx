import { PolicyPage } from "@/components/PolicyPage";
import { getPolicyPageProps } from "@/lib/policies/published";

export default async function ShippingPage() {
  return <PolicyPage {...(await getPolicyPageProps("shipping_policy"))} />;
}
