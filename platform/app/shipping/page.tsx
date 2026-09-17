import { PolicyPage } from "@/components/PolicyPage";
import { DRAFT_POLICIES } from "@/lib/policies/content";

export default function ShippingPage() {
  return <PolicyPage {...DRAFT_POLICIES.shipping_policy} />;
}
