// @vitest-environment jsdom
/**
 * CurrencyInput contract: the committed `value` prop is the source of truth,
 * blur/submit parses + rounds + clamps and fires onCommit — and anything that
 * can't become a committed figure (junk, unchanged) fires nothing, with the
 * display snapping back. Both payment surfaces (TakePaymentSheet's deposit,
 * Record Payment's amount) lean on exactly these rules.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: any) => React.createElement('span', null, children),
}));

import { CurrencyInput } from './CurrencyInput';

function renderInput(props: Partial<React.ComponentProps<typeof CurrencyInput>> = {}) {
  const onCommit = vi.fn();
  const utils = render(
    <CurrencyInput
      value={300}
      onCommit={onCommit}
      accessibilityLabel="Amount"
      {...props}
    />,
  );
  const input = utils.baseElement.querySelector<HTMLInputElement>(
    'input[aria-label="Amount"]',
  )!;
  return { ...utils, onCommit, input };
}

function typeAndBlur(input: HTMLInputElement, text: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

describe('CurrencyInput', () => {
  it('renders the committed value to two decimal places', () => {
    const { input } = renderInput({ value: 300 });
    expect(input.value).toBe('300.00');
  });

  it('commits the parsed figure, rounded to cents, on blur', () => {
    const { input, onCommit } = renderInput();
    typeAndBlur(input, '512.129');
    expect(onCommit).toHaveBeenCalledWith(512.13);
  });

  it('clamps to the given bounds at commit', () => {
    const { input, onCommit } = renderInput({ min: 0, max: 1200 });
    typeAndBlur(input, '9999');
    expect(onCommit).toHaveBeenCalledWith(1200);
  });

  it('fires nothing on junk input and snaps back to the committed figure', () => {
    const { input, onCommit } = renderInput();
    for (const junk of ['', 'abc']) {
      typeAndBlur(input, junk);
    }
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('300.00');
  });

  it('fires nothing when the figure is unchanged', () => {
    const { input, onCommit } = renderInput();
    typeAndBlur(input, '300.00');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('field variant renders the label and a $ prefix', () => {
    const { getByText } = renderInput({ variant: 'field', label: 'Amount' });
    expect(getByText('Amount')).toBeTruthy();
    expect(getByText('$')).toBeTruthy();
  });
});
