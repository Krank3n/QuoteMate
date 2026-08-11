// @vitest-environment jsdom
/**
 * LaborMarkupScreen, rendered.
 *
 * labourEditor.test.ts proves the hydrate/apply cycle is value-preserving, but
 * a pure-function test cannot see the wiring: whether the screen hands the
 * editor display-space values where canonical ones are expected, or renders a
 * total the save would never produce. That wiring is exactly what shipped a
 * $33,620 quote to a customer at 8× the tradie's rate, so it gets its own test.
 *
 * Heavy native/expo dependency graphs are mocked out — same approach as
 * AuthScreen.forgotPassword.test.tsx / TakePaymentSheet.test.tsx.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import type { LaborUnit, QuoteSection } from '../../types';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: ({ children }: any) => React.createElement('div', null, children),
}));

vi.mock('react-native-paper', () => {
  const TextInput: any = ({ label, value, onChangeText }: any) =>
    React.createElement('input', {
      'aria-label': label,
      value: value ?? '',
      onChange: (e: any) => onChangeText?.(e.target.value),
    });
  TextInput.Affix = () => null;
  TextInput.Icon = () => null;
  return {
    DefaultTheme: { colors: {} },
    MD3DarkTheme: { colors: {} },
    Text: ({ children }: any) => React.createElement('span', null, children),
    Title: ({ children }: any) => React.createElement('h1', null, children),
    Surface: ({ children }: any) => React.createElement('div', null, children),
    Divider: () => null,
    TextInput,
  };
});

const nav = vi.hoisted(() => ({
  navigate: vi.fn(),
  goBack: vi.fn(),
  addListener: vi.fn(() => () => {}),
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => nav,
  useRoute: () => ({ params: {} }),
}));

const doc = vi.hoisted(() => ({ current: null as any, update: vi.fn(), persist: vi.fn() }));
vi.mock('../../utils/documentMode', () => ({
  useCurrentDocument: () => ({ document: doc.current, update: doc.update }),
  useDocumentMode: () => 'quote',
  usePersistDocument: () => doc.persist,
  getPreviewScreenName: () => 'JobPreview',
}));

vi.mock('../../store/useStore', () => ({
  useStore: (selector: any) => selector({ businessSettings: { defaultLaborRate: 85, address: '' } }),
}));

vi.mock('../../components/QuoteSentBanner', () => ({ QuoteSentBanner: () => null }));
vi.mock('../../components/FixedBottomButton', () => ({ FixedBottomButton: () => null }));
vi.mock('../../components/WebContainer', () => ({
  WebContainer: ({ children }: any) => React.createElement('div', null, children),
}));
vi.mock('../../components/AlertModal', () => ({ AlertModal: () => null }));

import { LaborMarkupScreen } from './LaborMarkupScreen';

const HOURLY = 85;

function section(name: string, laborHours: number, unit: LaborUnit, multiplier: number, rate: number): QuoteSection {
  return {
    id: name, name, multiplier, laborHours,
    laborHoursTotal: Math.round(laborHours * multiplier * 100) / 100,
    laborRate: rate, laborUnit: unit as any,
    laborTotal: Math.round(laborHours * rate * multiplier * 100) / 100,
    sortOrder: 0,
  };
}

function quote(sections: QuoteSection[], over: Record<string, unknown> = {}) {
  return {
    id: 'q1', type: 'quote', stage: 'draft',
    customerName: 'Danny', job: { id: 'j1', name: 'Fence', description: '' },
    materials: [{ id: 'm1', name: 'Palings', quantity: 1, unit: 'each', price: 100, totalPrice: 100, manualPriceOverride: false }],
    materialsSubtotal: 100,
    laborRate: HOURLY, laborHours: 0, laborUnit: 'hours', laborExtraHours: 0,
    laborTotal: 0, markup: 0, laborMarkup: 0, markupAmount: 0,
    subtotal: 0, gst: 0, total: 0, sections,
    ...over,
  };
}

/** The "Labour Total" figure as rendered. */
function labourTotalOnScreen(): string {
  const label = screen.getByText('Labour Total');
  return label.parentElement?.querySelectorAll('span')[1]?.textContent ?? '';
}

const rateBox = () => screen.getByLabelText(/Hourly Rate|Daily Rate/) as HTMLInputElement;

/** The live beforeRemove handler — the most recently registered one. */
function latestBeforeRemove(): (() => void) | undefined {
  const calls = nav.addListener.mock.calls.filter(([evt]) => evt === 'beforeRemove');
  return calls.at(-1)?.[1] as (() => void) | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LaborMarkupScreen — what the tradie actually sees', () => {
  it('renders an hours quote at the hourly rate', () => {
    doc.current = quote([section('Bays', 4, 'hours', 2, HOURLY)]);
    render(React.createElement(LaborMarkupScreen));

    expect(screen.getByLabelText('Hourly Rate')).toBeTruthy();
    expect(rateBox().value).toBe('85');
    expect(labourTotalOnScreen()).toContain('680.00'); // 4 × 2 × 85
  });

  it('renders a multi-day quote in days at the equivalent day rate', () => {
    // 32h reads better as days — and the rate shown must be the DAY rate.
    doc.current = quote([section('Frame', 32, 'hours', 1, HOURLY)]);
    render(React.createElement(LaborMarkupScreen));

    expect(screen.getByLabelText('Daily Rate')).toBeTruthy();
    expect(rateBox().value).toBe('680');          // 85 × 8, display only
    expect(labourTotalOnScreen()).toContain('2,720.00'); // still 32h × $85
  });

  it('prices a legacy day-shaped quote correctly instead of 8× (QU-178621)', () => {
    // Exactly the stored shape that produced $23,337.60 of labour.
    doc.current = quote(
      [
        section('Demolition', 0.1, 'days', 1, 5440),
        section('Fence Bay', 0.19, 'days', 21, 5440),
        section('End Post', 0.1, 'days', 1, 5440),
      ],
      { laborRate: 5440, laborUnit: 'days', laborHours: 4.2, laborExtraHours: 0.1 },
    );
    render(React.createElement(LaborMarkupScreen));

    // The money is preserved exactly as stored — the screen renders it, it does
    // not re-multiply it. $544 + $21,705.60 + $544 + 0.1d extra.
    expect(labourTotalOnScreen()).toContain('23,337.60');
    // …and the rate is shown as the day rate it genuinely is, not $5,440/hour.
    expect(screen.getByLabelText('Daily Rate')).toBeTruthy();
    expect(rateBox().value).toBe('5440');
  });

  it('toggling Hours ⇄ Days never moves the price', () => {
    doc.current = quote([section('Frame', 32, 'hours', 1, HOURLY)]);
    render(React.createElement(LaborMarkupScreen));

    const before = labourTotalOnScreen();
    expect(rateBox().value).toBe('680'); // starts in days

    fireEvent.click(screen.getByText('Hours'));
    expect(rateBox().value).toBe('85');
    expect(labourTotalOnScreen()).toBe(before);

    fireEvent.click(screen.getByText('Days'));
    expect(rateBox().value).toBe('680');
    expect(labourTotalOnScreen()).toBe(before);

    // Ten more flips must not drift a cent.
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByText('Hours'));
      fireEvent.click(screen.getByText('Days'));
    }
    expect(labourTotalOnScreen()).toBe(before);
  });

  it('editing the rate box reprices at the unit on screen', () => {
    doc.current = quote([section('Frame', 32, 'hours', 1, HOURLY)]);
    render(React.createElement(LaborMarkupScreen));

    // Showing days: typing 800 means $800/day = $100/hour over 32h.
    fireEvent.change(rateBox(), { target: { value: '800' } });
    expect(labourTotalOnScreen()).toContain('3,200.00');
  });

  it('saves canonical hours when the screen is left', () => {
    doc.current = quote([section('Frame', 32, 'hours', 1, HOURLY)]);
    render(React.createElement(LaborMarkupScreen));

    // The screen re-registers its beforeRemove save whenever the editor state
    // changes; the real navigator unsubscribes the previous one, so the LAST
    // registration is the live callback. (Our mock's unsubscribe is a no-op.)
    expect(latestBeforeRemove()).toBeTruthy();
    latestBeforeRemove()!();

    expect(doc.update).toHaveBeenCalled();
    const saved = doc.update.mock.calls.at(-1)![0];
    expect(saved.laborUnit).toBe('hours');       // canonical, even though days are shown
    expect(saved.labourDisplayUnit).toBe('days'); // preference kept separately
    expect(saved.laborRate).toBe(HOURLY);         // $/hour, not $/day
    expect(saved.laborHours).toBe(32);
    expect(saved.laborTotal).toBe(2720);
    expect(saved.sections[0].laborUnit).toBe('hours');
    expect(doc.persist).toHaveBeenCalled();
  });

  it('normalises a legacy day-shaped quote to hours on save', () => {
    doc.current = quote(
      [section('Bay', 0.19, 'days', 21, 5440)],
      { laborRate: 5440, laborUnit: 'days', laborHours: 3.99, laborExtraHours: 0 },
    );
    render(React.createElement(LaborMarkupScreen));

    latestBeforeRemove()!();

    const saved = doc.update.mock.calls.at(-1)![0];
    expect(saved.laborUnit).toBe('hours');
    expect(saved.laborRate).toBe(680);            // 5440/day → 680/hour
    expect(saved.sections[0].laborTotal).toBe(21705.6); // money untouched
  });
});

describe('LaborMarkupScreen — interactions that used to move money', () => {
  it('a legacy day quote survives toggling to hours and back', () => {
    doc.current = quote(
      [section('Bay', 0.19, 'days', 21, 5440)],
      { laborRate: 5440, laborUnit: 'days', laborHours: 3.99, laborExtraHours: 0 },
    );
    render(React.createElement(LaborMarkupScreen));
    const before = labourTotalOnScreen();
    expect(before).toContain('21,705.60');

    fireEvent.click(screen.getByText('Hours'));
    expect(rateBox().value).toBe('680');   // the true hourly rate
    expect(labourTotalOnScreen()).toBe(before);

    fireEvent.click(screen.getByText('Days'));
    expect(rateBox().value).toBe('5440');
    expect(labourTotalOnScreen()).toBe(before);

    latestBeforeRemove()!();
    const saved = doc.update.mock.calls.at(-1)![0];
    expect(saved.laborRate).toBe(680);
    expect(saved.laborUnit).toBe('hours');
    expect(saved.sections[0].laborTotal).toBe(21705.6);
  });

  it('a section stepper changes the price by exactly one step', () => {
    doc.current = quote([section('Bays', 4, 'hours', 2, HOURLY)]); // 8h total, shows hours
    render(React.createElement(LaborMarkupScreen));
    expect(labourTotalOnScreen()).toContain('680.00');

    // The section row reads "Bays  [-] 8.0 hrs [+]  $680.00". Walk from the
    // section's own displayed total to the +/- controls beside it.
    const sectionQty = screen.getByText('8.0 hrs');
    const row = sectionQty.closest('div')!.parentElement!;
    // react-native-web renders TouchableOpacity as a focusable div, not a
    // button role — hence the tabindex selector rather than getByRole.
    const steppers = Array.from(row.querySelectorAll('div[tabindex="0"]'));
    expect(steppers.length).toBe(2); // exactly a minus and a plus

    // In hours mode a step is 1 hour = $85 on a ×2 section... the stepper moves
    // the section TOTAL, so one tap is one hour of labour.
    fireEvent.click(steppers[steppers.length - 1]); // the plus
    expect(labourTotalOnScreen()).toContain('765.00'); // 9h × $85

    fireEvent.click(steppers[0]); // the minus, back to where we started
    expect(labourTotalOnScreen()).toContain('680.00');
  });

  it('typing an hours total reprices and keeps the extra buffer visible', () => {
    doc.current = quote([section('Bays', 4, 'hours', 2, HOURLY)]);
    render(React.createElement(LaborMarkupScreen));

    const totalBox = screen.getByLabelText('Estimated Hours') as HTMLInputElement;
    expect(totalBox.value).toBe('8');
    fireEvent.change(totalBox, { target: { value: '10' } });

    // 8h of sections + 2h extra, all at $85.
    expect(labourTotalOnScreen()).toContain('850.00');

    latestBeforeRemove()!();
    const saved = doc.update.mock.calls.at(-1)![0];
    expect(saved.laborHours).toBe(10);
    expect(saved.laborExtraHours).toBe(2);
    expect(saved.laborRate).toBe(HOURLY);
  });

  it('a zero-rate quote renders without NaN', () => {
    doc.current = quote([section('Bays', 4, 'hours', 1, 0)], { laborRate: 0 });
    render(React.createElement(LaborMarkupScreen));
    expect(labourTotalOnScreen()).toContain('0.00');
    expect(labourTotalOnScreen()).not.toContain('NaN');
  });
});
