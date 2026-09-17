import { PolicyPage } from "@/components/PolicyPage";
import { DRAFT_POLICIES } from "@/lib/policies/content";

export default function TermsPage() {
  return <PolicyPage {...DRAFT_POLICIES.terms_of_sale} />;
}
