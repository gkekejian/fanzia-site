import { PolicyPage } from "@/components/PolicyPage";
import { DRAFT_POLICIES } from "@/lib/policies/content";

export default function ImportPolicyPage() {
  return <PolicyPage {...DRAFT_POLICIES.import_edition_acknowledgment} />;
}
