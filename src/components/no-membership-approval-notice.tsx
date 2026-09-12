/**
 * Universe shops have no membership requirement: there is no application,
 * pending list or approval step. The database is authoritative
 * (`shop_requires_membership_approval`); this notice simply explains why the
 * review list is absent for a Universe shop. New Generation shops keep the
 * full review workflow.
 */
import { EmptyState, PageSection } from "@/components/ui-kit";

export function NoMembershipApprovalNotice({
  title = "No member approval needed",
}: {
  title?: string;
}) {
  return (
    <PageSection
      devSlot="membership-approval.not-required"
      title={title}
      description="This shop is open to everyone on ONE WAVE."
    >
      <EmptyState
        title="Anyone can shop here"
        description="Universe shops do not accept or approve members. People can browse, buy and use their wallet right away. Approving members is only used by New Generation shops."
      />
    </PageSection>
  );
}
