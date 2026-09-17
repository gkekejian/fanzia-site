import { PolicyPage } from "@/components/PolicyPage";
import { DRAFT_POLICIES } from "@/lib/policies/content";

export default function PrivacyPage() {
  return <PolicyPage {...DRAFT_POLICIES.privacy_policy} />;
}
