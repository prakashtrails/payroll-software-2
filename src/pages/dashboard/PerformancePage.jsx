import { useSearchParams } from 'react-router-dom';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import PerformanceWorkspace from '@/features/performance/PerformanceWorkspace';

const PLANNING_SECTIONS = ['Overview', 'Goals', 'Organisation', 'Target planning', 'Scorecards', 'Monthly updates', 'Approvals', 'Analytics', 'Settings'];
const REVIEW_SECTIONS = ['Reviews', 'Templates'];

/** The PMS workspace, reusable inside the Me page. Section lives in ?section=. */
export function PerformanceContent({ defaultSection = 'Overview' }) {
  const { tenant, profile } = useAuth();
  const { isEnabled } = useFeatures();
  const [searchParams, setSearchParams] = useSearchParams();
  const enabledSections = [
    ...(isEnabled('performance_kras') ? PLANNING_SECTIONS : []),
    ...(isEnabled('performance_reviews') ? REVIEW_SECTIONS : []),
  ];
  const changeSection = section => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('section', section);
      return next;
    });
  };
  if (!tenant?.id) return <div className="page-content">Select a company to open its performance workspace.</div>;
  if (!enabledSections.length) return <div className="page-content">Performance goals and reviews are disabled for this company.</div>;
  // Remount on tenant/user switch so no state from the previous context survives.
  return <PerformanceWorkspace key={`${tenant.id}:${profile?.id}`} requestedSection={searchParams.get('section') || defaultSection}
    onSectionChange={changeSection} enabledSections={enabledSections} />;
}

export default function PerformancePage({ defaultSection = 'Overview' }) {
  return <><Header title="Performance" breadcrumb="Goals, growth & reviews" /><PerformanceContent defaultSection={defaultSection} /></>;
}
