// @vitest-environment jsdom
/**
 * The utils carry the correctness weight (jobSearch.test.ts, jobSort.test.ts).
 * This file exists for the two things only a rendered screen can catch:
 *
 *   1. The memo chain is wired to the right inputs — a search actually narrows
 *      the rendered rows, and clearing it restores them.
 *   2. renderCard's dep array. It was `[]`, and adding a sort label without
 *      adding sortKey/sortMetrics to the deps leaves every card showing the
 *      label it first rendered with — React.memo on JobCard hides it, so the
 *      list orders by one thing while every card claims another. No unit test
 *      can see that; only a re-render can.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
// Ships untranspiled syntax vitest can't parse. Reached via StickyJobActionBar,
// which the screen imports only for its pure pickPrimaryDoc helper.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: ({ children }: any) => children,
}));
// Also untranspiled. It's the decorative fade over the chip row — purely
// visual, nothing asserted about it.
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text, View, TextInput, Pressable } = await import('react-native');
  const Chip = ({ children, onPress }: any) => (
    <Pressable onPress={onPress}>
      <Text>{children}</Text>
    </Pressable>
  );
  const Searchbar = ({ placeholder, value, onChangeText }: any) => (
    <TextInput placeholder={placeholder} value={value} onChangeText={onChangeText} />
  );
  const Menu = Object.assign(
    ({ anchor, children, visible }: any) => (
      <View>
        {anchor}
        {visible ? children : null}
      </View>
    ),
    {
      Item: ({ title, onPress }: any) => (
        <Pressable onPress={onPress}>
          <Text>{title}</Text>
        </Pressable>
      ),
    },
  );
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    TextInput,
    Searchbar,
    Chip,
    Menu,
    FAB: () => null,
    Card: Object.assign(
      ({ children, ...props }: any) => <View {...props}>{children}</View>,
      { Content: ({ children }: any) => <View>{children}</View> },
    ),
  };
});
vi.mock('../components/ShimmerOverlay', () => ({ ShimmerOverlay: () => null }));
vi.mock('../components/BottomSheet', () => ({
  BottomSheet: () => null,
  useStaggeredEntrance: () => [],
}));
vi.mock('../components/GridBackground', () => ({ GridBackground: () => null }));
vi.mock('../components/WebContainer', () => {
  return {
    WebContainer: ({ children }: any) => <>{children}</>,
  };
});
vi.mock('../components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children }: any) => <>{children}</>,
}));
vi.mock('../components/SkeletonCard', () => ({ SkeletonCardList: () => null }));
vi.mock('../components/SkeletonCrossfade', () => ({
  SkeletonCrossfade: ({ children }: any) => <>{children}</>,
}));
// JobStageSheet is NOT mocked: JobCard needs its real stageMetaFor export, and
// the sheet itself only renders once a job is tapped. Mocking ./BottomSheet
// above is what keeps it parseable (same reason as JobCard.ghost.test.tsx).
vi.mock('../components/ScheduleJobSheet', () => ({ ScheduleJobSheet: () => null }));
vi.mock('../hooks/useJobActionsSheet', () => ({
  useJobActionsSheet: () => ({ open: vi.fn(), element: null }),
}));
vi.mock('../hooks/useIsAppActive', () => ({ useIsAppActive: () => true }));
vi.mock('../utils/haptics', () => ({ lightTap: vi.fn(), selectionTap: vi.fn() }));
vi.mock('../utils/openJobPreview', () => ({ openJobPreview: vi.fn() }));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useScrollToTop: () => {},
}));
// Prefs would otherwise hit AsyncStorage; the store is exercised directly.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

// vi.mock factories are hoisted above the module body, so the fixtures they
// close over have to be hoisted too.
const FIXTURES = vi.hoisted(() => {
  const DAY = 24 * 60 * 60 * 1000;
  const T = Date.now() - 10 * DAY;

  const job = (over: Record<string, any> = {}): any => ({
    id: 'job1',
    stage: 'inquiry',
    name: 'A job',
    customerName: 'Someone',
    jobAddress: '',
    documentIds: [],
    createdAt: T,
    updatedAt: T,
    totalQuoted: 0,
    totalInvoiced: 0,
    totalPaid: 0,
    balanceDue: 0,
    ...over,
  });

  const JOBS = [
    job({
      id: 'jones',
      customerName: 'Bob Jones',
      name: 'Pergola',
      jobAddress: '12 Smith St',
      customerPhone: '0412 345 678',
    }),
    // Deliberately the NEWER job, and the cheaper one, so 'recent' and
    // 'value' disagree about which row leads. Without that the reorder
    // assertion below passes whatever the sort does.
    job({
      id: 'nguyen',
      customerName: 'Dave Nguyen',
      name: 'Deck',
      stage: 'quoted',
      quotedAt: T + DAY,
      updatedAt: T + DAY,
    }),
  ];

  const DOCUMENTS = [
    {
      id: 'inv1',
      jobId: 'jones',
      type: 'invoice',
      stage: 'invoice_sent',
      number: 'IN-1042',
      total: 5000,
      paidTotal: 0,
      balanceDue: 5000,
      payments: [],
      dueDate: T,
    },
    {
      id: 'q2',
      jobId: 'nguyen',
      type: 'quote',
      stage: 'draft',
      number: 'QU-1031',
      total: 100,
      paidTotal: 0,
      balanceDue: 0,
      payments: [],
    },
  ];

  // Mutable so a test can introduce a repeat customer without disturbing the
  // search assertions, which assume one job each.
  const live = { jobs: JOBS };
  return { JOBS, DOCUMENTS, live, job, T, DAY };
});

vi.mock('../store/useJobStore', () => ({
  useJobStore: () => ({
    jobs: FIXTURES.live.jobs,
    jobsLoaded: true,
    loadJobs: vi.fn().mockResolvedValue(undefined),
    saveJob: vi.fn(),
  }),
}));
vi.mock('../store/useStore', () => {
  const state = {
    documents: FIXTURES.DOCUMENTS,
    canCreateQuote: () => true,
    createNewQuote: vi.fn(),
    saveQuote: vi.fn(),
    saveInvoice: vi.fn(),
    createInvoiceFromQuote: vi.fn(),
  };
  return { useStore: (selector?: any) => (selector ? selector(state) : state) };
});

import { JobsListScreen } from './JobsListScreen';
import { useJobListPrefsStore } from '../store/useJobListPrefsStore';
import { DEFAULT_JOB_LIST_PREFS } from '../services/jobListPrefs';
import type { JobSortKey } from '../utils/jobSort';

/** Reset the module-level singletons between tests. */
beforeEach(() => {
  useJobListPrefsStore.setState({
    prefs: DEFAULT_JOB_LIST_PREFS,
    hydrated: true,
    searchQuery: '',
  });
  FIXTURES.live.jobs = FIXTURES.JOBS;
});

function type(getByPlaceholderText: any, text: string) {
  fireEvent.change(getByPlaceholderText('Name, address, phone, invoice #'), {
    target: { value: text },
  });
}

describe('JobsListScreen — search', () => {
  it('typing a customer surname narrows the list to that job', () => {
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    expect(queryByText('Dave Nguyen')).not.toBeNull();

    type(getByPlaceholderText, 'jones');

    expect(queryByText('Bob Jones')).not.toBeNull();
    expect(queryByText('Dave Nguyen')).toBeNull();
  });

  it('REGRESSION: a trailing space still shows the match', () => {
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    type(getByPlaceholderText, 'jones ');
    expect(queryByText('Bob Jones')).not.toBeNull();
  });

  it('finds a job by its invoice number, which the old three-field search could not', () => {
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    type(getByPlaceholderText, 'IN-1042');
    expect(queryByText('Bob Jones')).not.toBeNull();
    expect(queryByText('Dave Nguyen')).toBeNull();
  });

  it('finds a job by phone number', () => {
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    type(getByPlaceholderText, '0412 345 678');
    expect(queryByText('Bob Jones')).not.toBeNull();
    expect(queryByText('Dave Nguyen')).toBeNull();
  });

  it('finds a job from two words in different fields', () => {
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    type(getByPlaceholderText, 'jones pergola');
    expect(queryByText('Bob Jones')).not.toBeNull();
  });

  it('clearing the search restores the full list', () => {
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    type(getByPlaceholderText, 'jones');
    expect(queryByText('Dave Nguyen')).toBeNull();

    type(getByPlaceholderText, '');
    expect(queryByText('Dave Nguyen')).not.toBeNull();
    expect(queryByText('Bob Jones')).not.toBeNull();
  });

  it('shows how much of the list is hidden while searching', () => {
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    expect(queryByText('Showing 2 of 2')).toBeNull();

    type(getByPlaceholderText, 'jones');
    expect(queryByText('Showing 1 of 2')).not.toBeNull();
  });

  it('shows a search-specific empty state, not "No jobs yet", when nothing matches', () => {
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    type(getByPlaceholderText, 'zzzqqq');

    expect(queryByText('No jobs match')).not.toBeNull();
    expect(queryByText('No jobs yet')).toBeNull();
    expect(queryByText('Clear search')).not.toBeNull();
  });

  it('the Clear search button restores the list', () => {
    const { getByPlaceholderText, getByText, queryByText } = render(<JobsListScreen />);
    type(getByPlaceholderText, 'zzzqqq');
    fireEvent.click(getByText('Clear search'));
    expect(queryByText('Bob Jones')).not.toBeNull();
    expect(queryByText('Dave Nguyen')).not.toBeNull();
  });
});

/** Store writes are React state updates — act() so the re-render flushes. */
function chooseSort(key: JobSortKey) {
  act(() => {
    useJobListPrefsStore.getState().setSort('all', key);
  });
}

describe('JobsListScreen — sort', () => {
  it('shows the active sort by name so the order on screen is explained', () => {
    const { queryByText } = render(<JobsListScreen />);
    expect(queryByText('Recent')).not.toBeNull();
  });

  it('switching sort to Biggest $ reorders the rendered cards', () => {
    // Nguyen is the newer job, so 'recent' leads with Nguyen. Jones owes
    // $5,000 against Nguyen's $100 quote, so 'value' must flip them.
    const { queryAllByText } = render(<JobsListScreen />);
    const names = () => queryAllByText(/Bob Jones|Dave Nguyen/).map((n: any) => n.textContent);
    expect(names()[0]).toBe('Dave Nguyen');

    chooseSort('value');
    expect(names()[0]).toBe('Bob Jones');
  });

  it('switching sort to Oldest first reorders the rendered cards', () => {
    const { queryAllByText } = render(<JobsListScreen />);
    const names = () => queryAllByText(/Bob Jones|Dave Nguyen/).map((n: any) => n.textContent);
    expect(names()[0]).toBe('Dave Nguyen');

    chooseSort('oldest');
    expect(names()[0]).toBe('Bob Jones');
  });

  it('changing sort does not change how many cards are rendered', () => {
    const { queryAllByText } = render(<JobsListScreen />);
    const before = queryAllByText(/Bob Jones|Dave Nguyen/).length;
    expect(before).toBe(2);

    for (const key of ['oldest', 'value', 'scheduled', 'overdue'] as const) {
      chooseSort(key);
      expect(queryAllByText(/Bob Jones|Dave Nguyen/).length).toBe(before);
    }
  });

  it('REGRESSION: the cards re-render their sort label when the sort changes', () => {
    // renderCard was useCallback(..., []). With a stale dep array the overdue
    // label never appears, because the rows keep their first render and
    // React.memo hides the staleness.
    const { queryByText } = render(<JobsListScreen />);
    expect(queryByText(/Overdue \d+ days/)).toBeNull();

    chooseSort('overdue');
    expect(queryByText(/Overdue \d+ days/)).not.toBeNull();
  });
});

describe('JobsListScreen — remembering your place', () => {
  it('opens on the pile the prefs store restored, not always on All', () => {
    useJobListPrefsStore.setState({
      prefs: { filter: 'owed', sortByFilter: {} },
      hydrated: true,
      searchQuery: '',
    });
    const { queryByText } = render(<JobsListScreen />);
    // Only the Jones job owes money.
    expect(queryByText('Bob Jones')).not.toBeNull();
    expect(queryByText('Dave Nguyen')).toBeNull();
  });

  it('opens the Owed pile on most-overdue without the tradie choosing', () => {
    useJobListPrefsStore.setState({
      prefs: { filter: 'owed', sortByFilter: {} },
      hydrated: true,
      searchQuery: '',
    });
    const { queryByText } = render(<JobsListScreen />);
    expect(queryByText('Most overdue')).not.toBeNull();
  });

  it('renders every filter chip — the single-line scroller must not drop any', () => {
    // The chip row was a wrapping View and is now a horizontal ScrollView, to
    // save a whole band of vertical chrome. Every pile still has to be
    // reachable; a misconfigured scroller silently hiding chips is the way this
    // breaks.
    const { queryByText } = render(<JobsListScreen />);
    for (const label of ['All', 'To send', 'Waiting', 'Owed', 'Scheduled', 'Done']) {
      // Counts are appended, so match on the label prefix.
      expect(queryByText(new RegExp(`^${label}( \\(\\d+\\))?$`))).not.toBeNull();
    }
  });

  it('chip counts stay whole-population while a search is active', () => {
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    type(getByPlaceholderText, 'jones');
    // "All (2)" must not become "All (1)" — the counts describe the piles, not
    // the search.
    expect(queryByText('All (2)')).not.toBeNull();
  });
});

describe('JobsListScreen — the customer entry points', () => {
  /** Give Bob Jones a second job so he reads as a repeat customer. */
  function withRepeatCustomer() {
    FIXTURES.live.jobs = [
      ...FIXTURES.JOBS,
      FIXTURES.job({
        id: 'jones2',
        customerName: 'Bob Jones',
        name: 'Carport',
        customerPhone: '0412 345 678',
      }),
    ];
  }

  it('marks a repeat customer on the card with their job count', () => {
    withRepeatCustomer();
    const { queryAllByText } = render(<JobsListScreen />);
    // Both of Bob's cards carry the marker; Dave's does not.
    expect(queryAllByText('· 2 jobs')).toHaveLength(2);
  });

  it('leaves a one-off customer’s card unmarked', () => {
    const { queryByText } = render(<JobsListScreen />);
    expect(queryByText(/· \d+ jobs/)).toBeNull();
  });

  it('offers a customer row above the results when a search matches a repeat customer', () => {
    withRepeatCustomer();
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    type(getByPlaceholderText, 'jones');
    expect(queryByText('2 jobs · $5,000.00 owed')).not.toBeNull();
  });

  it('offers no customer row for a one-off customer — it would just repeat the card', () => {
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    type(getByPlaceholderText, 'nguyen');
    expect(queryByText(/\d+ jobs/)).toBeNull();
  });

  it('offers no customer row until the query is at least two characters', () => {
    withRepeatCustomer();
    const { getByPlaceholderText, queryByText } = render(<JobsListScreen />);
    type(getByPlaceholderText, 'j');
    // The card markers still read "· 2 jobs"; it's the customer ROW — the one
    // carrying the owed total — that must not have appeared yet.
    expect(queryByText('2 jobs · $5,000.00 owed')).toBeNull();
  });
});
