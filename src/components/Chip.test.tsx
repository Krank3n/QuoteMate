// @vitest-environment jsdom
/**
 * The pill lifted out of RecordPaymentScreen so Insights can use the same
 * control. What matters on the way out is that the selected state still
 * reaches assistive tech on web — react-native-web drops
 * accessibilityState.selected, which is why the aria alias is there.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

vi.mock('react-native-paper', async () => {
  const { Text } = await import('react-native');
  return { Text };
});
vi.mock('../theme', async () => await import('../test/stubs/theme'));

import { Chip } from './Chip';

describe('Chip', () => {
  it('marks the active chip as selected and leaves the others alone', () => {
    render(
      <>
        <Chip label="Last FY" active onPress={() => {}} />
        <Chip label="This FY" onPress={() => {}} />
      </>,
    );
    expect(screen.getByText('Last FY').closest('[aria-selected]')?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('This FY').closest('[aria-selected]')?.getAttribute('aria-selected')).toBe('false');
  });

  it('says the whole period where the label is abbreviated to fit', () => {
    // "Last FY" is read out as letters; the chip row can't afford the words.
    render(<Chip label="Last FY" accessibilityLabel="Last financial year" onPress={() => {}} />);
    expect(screen.getByLabelText('Last financial year')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = vi.fn();
    render(<Chip label="Last quarter" onPress={onPress} />);
    fireEvent.click(screen.getByText('Last quarter'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
