// @vitest-environment jsdom
/**
 * Regression test for the July 2026 startup crash: a server aggregate write
 * racing a client job delete recreated the deleted Job as a stage-less
 * "ghost" doc (only balanceDue/totalPaid/totalQuoted/totalInvoiced/
 * documentIds/updatedAt). JobCard indexed JOB_STAGE_META[job.stage] with no
 * fallback, so `meta.color` threw a TypeError during render — an uncaught
 * fatal that closed the app on every open (Android JavascriptException,
 * blank page on web) until the doc was repaired.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Job } from '../../shared/job/types';

// Heavy native/expo dependency graphs that don't matter for the stage-meta
// lookup under test — same approach as useJobActionsSheet.test.tsx.
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    Card: Object.assign(
      ({ children, ...props }: { children?: React.ReactNode }) => <View {...props}>{children}</View>,
      { Content: ({ children }: { children?: React.ReactNode }) => <View>{children}</View> },
    ),
  };
});
vi.mock('./ShimmerOverlay', () => ({ ShimmerOverlay: () => null }));
// react-native-safe-area-context (via BottomSheet) ships untranspiled syntax
// vitest can't parse; JobCard only uses JobStageSheet's stage-meta exports.
vi.mock('./BottomSheet', () => ({
  BottomSheet: () => null,
  useStaggeredEntrance: () => [],
}));
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn() }));
vi.mock('../utils/openJobPreview', () => ({ openJobPreview: vi.fn() }));
vi.mock('../hooks/useIsAppActive', () => ({ useIsAppActive: () => true }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: { documents: never[] }) => unknown) => selector({ documents: [] }),
}));

import { JobCard } from './JobCard';
import { stageMetaFor, JOB_STAGE_META } from './JobStageSheet';

// The exact shape the syncJobAggregates race left behind (copied from the
// affected user's Firestore doc) — no id, stage, name, or createdAt.
const ghostJob = {
  balanceDue: 0,
  totalPaid: 0,
  totalQuoted: 0,
  totalInvoiced: 0,
  documentIds: [],
  updatedAt: 1783648190748,
} as unknown as Job;

describe('stageMetaFor', () => {
  it('falls back to inquiry meta for a missing stage', () => {
    expect(stageMetaFor(undefined)).toBe(JOB_STAGE_META.inquiry);
  });

  it('falls back to inquiry meta for an unknown stage value', () => {
    expect(stageMetaFor('bogus' as never)).toBe(JOB_STAGE_META.inquiry);
  });

  it('returns the real meta for a known stage', () => {
    expect(stageMetaFor('cancelled')).toBe(JOB_STAGE_META.cancelled);
  });
});

describe('JobCard with a ghost job doc', () => {
  it('renders without throwing and shows the fallback customer label', () => {
    const { getAllByText } = render(
      <JobCard job={ghostJob} onPress={() => {}} onStagePress={() => {}} onMenuPress={() => {}} />,
    );
    // Reaching here at all is the regression: pre-fix, render threw
    // "Cannot read properties of undefined (reading 'color')".
    expect(getAllByText('Unknown customer').length).toBeGreaterThan(0);
  });
});
