import { PolicyPage } from "@/components/PolicyPage";
import { DRAFT_POLICIES } from "@/lib/policies/content";

export default function ReturnsPage() {
  return <PolicyPage {...DRAFT_POLICIES.returns_policy} />;
}
