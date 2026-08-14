// @vitest-environment jsdom
/**
 * Regression test for the web-only vanishing customer name.
 *
 * A repeat customer's name got `flex: 0` to cancel the one-off case's
 * `flex: 1`. React Native reads that as "basis auto, don't grow";
 * react-native-web compiles it to `flex: 0 1 0%` — a ZERO basis that never
 * grows. So on the web build every card for a customer with 2+ jobs
 * rendered the name at 0px wide: the card showed "· 3 jobs" and no name.
 * Native was fine, which is why it survived.
 *
 * These tests render through react-native-web (the same mapping the Expo
 * web build uses) and assert against the CSS actually applied.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

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
vi.mock('./BottomSheet', () => ({ BottomSheet: () => null, useStaggeredEntrance: () => [] }));
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn() }));
vi.mock('../utils/openJobPreview', () => ({ openJobPreview: vi.fn() }));
vi.mock('../hooks/useIsAppActive', () => ({ useIsAppActive: () => true }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: { documents: never[] }) => unknown) => selector({ documents: [] }),
}));

import { JobCard } from './JobCard';
import type { Job } from '../../shared/job/types';

const job = {
  id: 'job-1',
  stage: 'quoted',
  name: 'Lounge Room Paint',
  customerName: 'Jennifer Lynn',
  createdAt: 1,
  updatedAt: 1,
} as unknown as Job;

/** The leaf element rendering exactly this text. */
function leafWithText(container: HTMLElement, text: string): HTMLElement {
  const el = Array.from(container.querySelectorAll('*')).find(
    (n) => n.textContent === text && n.children.length === 0,
  );
  if (!el) throw new Error(`no element rendering "${text}"`);
  return el as HTMLElement;
}

/**
 * react-native-web emits atomic CSS classes rather than inline styles, so
 * the declarations have to be read back out of the stylesheet.
 */
function cssFor(el: HTMLElement): string {
  const classes = el.className.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules) as CSSStyleRule[]) {
      const sel = rule.selectorText || '';
      if (classes.some((c) => sel.includes(`.${c}`))) out.push(rule.cssText);
    }
  }
  return out.join('\n');
}

describe('JobCard customer name on web', () => {
  it('gives a repeat customer’s name a real width', () => {
    const { container } = render(
      <JobCard
        job={job}
        onPress={() => {}}
        customerJobCount={3}
        onCustomerPress={() => {}}
      />,
    );
    const name = leafWithText(container, 'Jennifer Lynn');
    const css = cssFor(name);

    // The bug, exactly: a zero flex-basis that can never grow back.
    expect(css).not.toMatch(/flex:\s*0\s+1\s+0%/);
    expect(css).not.toMatch(/flex-basis:\s*0%/);
    // It still has to give way to "· 3 jobs" rather than shove it off.
    expect(css).toMatch(/flex-shrink:\s*1/);
    // And the count is still there beside it.
    expect(leafWithText(container, '· 3 jobs')).toBeTruthy();
  });

  it('still lets a one-off customer’s name own the row', () => {
    const { container } = render(<JobCard job={job} onPress={() => {}} />);
    // flex:1 → `flex: 1 1 0%`: grows into the space up to the price.
    expect(cssFor(leafWithText(container, 'Jennifer Lynn'))).toMatch(
      /flex:\s*1\s+1\s+0%/,
    );
  });
});
