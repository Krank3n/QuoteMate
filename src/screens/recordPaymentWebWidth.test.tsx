// @vitest-environment jsdom
/**
 * Record Payment is a `presentation: 'modal'` route with no width of its
 * own, so on the web build the form — a dollar field, four radios, a date
 * menu — stretched the full width of the browser. Every other payment
 * surface caps at 600 (TakePaymentSheet, StripeCheckoutModal).
 *
 * Renders through react-native-web (the same mapping the Expo web build
 * uses) and asserts the cap is really applied to the content, not just
 * that a component was imported.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../components/GridBackground', () => ({ GridBackground: () => null }));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn(), goBack: vi.fn(), setOptions: vi.fn() }),
  useRoute: () => ({ params: { invoiceId: 'doc-1' } }),
}));
vi.mock('react-native-paper', async () => {
  const { Text, View, TextInput: RNTextInput } = await import('react-native');
  const passthrough =
    (Tag: any) =>
    ({ children, ...props }: { children?: React.ReactNode }) => <Tag {...props}>{children}</Tag>;
  const TextInput: any = passthrough(RNTextInput);
  TextInput.Affix = () => null;
  const RadioButton: any = passthrough(View);
  RadioButton.Group = passthrough(View);
  RadioButton.Item = ({ label }: { label?: string }) => <Text>{label}</Text>;
  const Menu: any = passthrough(View);
  Menu.Item = ({ title }: { title?: string }) => <Text>{title}</Text>;
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    Title: passthrough(Text),
    Button: ({ children, ...props }: { children?: React.ReactNode }) => (
      <View {...props}>
        <Text>{children}</Text>
      </View>
    ),
    Surface: passthrough(View),
    TextInput,
    RadioButton,
    Menu,
  };
});

const invoiceDoc = {
  id: 'doc-1',
  type: 'invoice',
  number: 'INV-005',
  total: 2606.26,
  paidTotal: 1303.13,
  customerName: 'Aaron Ngoi',
  payments: [],
};

const state = {
  invoices: [],
  currentInvoice: null,
  documents: [invoiceDoc],
  xeroConnection: null,
  recordPayment: vi.fn(),
  recordDocumentPayment: vi.fn(),
  pushPaymentToXero: vi.fn(),
  updateDocumentPayment: vi.fn(),
  deleteDocumentPayment: vi.fn(),
};

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: typeof state) => unknown) => selector(state),
  PAYMENT_METHOD_TO_LEDGER: {},
}));

import { RecordPaymentScreen } from './RecordPaymentScreen';

/**
 * Every declaration in force on an element. react-native-web puts
 * StyleSheet styles in atomic CSS classes and dynamic ones (WebContainer's
 * `{ maxWidth }`) in the inline style attribute, so both have to be read.
 */
function cssFor(el: Element): string {
  const node = el as HTMLElement;
  const classes = node.className.split(/\s+/).filter(Boolean);
  const out: string[] = [node.getAttribute('style') ?? ''];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules) as CSSStyleRule[]) {
      const sel = rule.selectorText || '';
      if (classes.some((c) => sel.includes(`.${c}`))) out.push(rule.cssText);
    }
  }
  return out.join('\n');
}

describe('RecordPaymentScreen on web', () => {
  it('caps the form width instead of filling the browser', () => {
    const { container } = render(<RecordPaymentScreen />);

    // Sanity: the real form rendered, not the "Invoice not found" branch.
    expect(container.textContent).toContain('Invoice Summary');
    expect(container.textContent).toContain('INV-005');

    const capped = Array.from(container.querySelectorAll('*')).filter((el) =>
      /max-width:\s*600px/.test(cssFor(el)),
    );
    expect(capped.length).toBeGreaterThan(0);
    // And the cap has to sit ABOVE the form, not on some leaf inside it.
    expect(capped[0].textContent).toContain('Invoice Summary');
  });
});
