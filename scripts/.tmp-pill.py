import re

# ------------------------------------------------- InvoiceDisplaySettings
p = 'src/components/InvoiceDisplaySettings.tsx'
s = open(p).read()


def sub(old, new, count=1):
    global s
    assert s.count(old) == count, (p, s.count(old), old[:90])
    s = s.replace(old, new)


sub(
    """
/** The three options, in increasing order of what stays private. */
const PRICE_DETAIL_OPTIONS: { value: PriceDetail; label: string; blurb: string }[] = [
  { value: 'itemised', label: 'Itemised', blurb: 'Every line with its quantity and unit price.' },
  {
    value: 'summary',
    label: 'Scope only',
    blurb: 'What you\\u2019re doing and the section totals \\u2014 no quantities, no unit prices.',
  },
  { value: 'total', label: 'Total only', blurb: 'One number: the total.' },
];
""",
    "",
)

sub(
    """      <View style={styles.detailBlock}>
        <Text style={styles.toggleTitle}>{`What the customer sees on the ${docLabel}`}</Text>
        <View style={styles.segmented}>
          {PRICE_DETAIL_OPTIONS.map((opt) => {
            const active = priceDetail === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => onChange({ priceDetail: opt.value, ...legacyFlagsFor(opt.value) })}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                activeOpacity={0.85}
              >
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.toggleSubtitle}>
          {`${PRICE_DETAIL_OPTIONS.find((o) => o.value === priceDetail)?.blurb} Your own screens always show the lot \\u2014 this only changes the ${docLabel}, the email and the acceptance page.`}
        </Text>
      </View>""",
    """      <View style={styles.detailBlock}>
        <Text style={styles.toggleTitle}>{`What the customer sees on the ${docLabel}`}</Text>
        <PillToggle
          value={priceDetail}
          onChange={(v) => onChange({ priceDetail: v, ...legacyFlagsFor(v) })}
          options={PRICE_DETAIL_OPTIONS}
          fullWidth
        />
        <Text style={styles.toggleSubtitle}>
          {`${priceDetailBlurb(priceDetail)} Your own screens always show the lot \\u2014 this only changes the ${docLabel}, the email and the acceptance page.`}
        </Text>
      </View>""",
)

sub(
    "import { legacyFlagsFor, type PriceDetail } from '../../shared/document/priceDetail';",
    "import {\n"
    "  legacyFlagsFor,\n"
    "  priceDetailBlurb,\n"
    "  PRICE_DETAIL_OPTIONS,\n"
    "  type PriceDetail,\n"
    "} from '../../shared/document/priceDetail';\n"
    "import { PillToggle } from './PillToggle';",
)

sub(
    """  segmented: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.bg,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 6,
  },
  segmentActive: {
    backgroundColor: t.colors.accentSubtle,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  segmentLabelActive: {
    color: t.colors.accentText,
  },
""",
    "",
)

sub(
    """    PRICE_DETAIL_OPTIONS.find((o) => o.value === priceDetail)?.label ?? 'Itemised',
  ];""",
    """    PRICE_DETAIL_OPTIONS.find((o) => o.value === priceDetail)?.label ?? 'Itemised',
  ];""",
)

open(p, 'w').write(s)

# ------------------------------------------------- BusinessDefaultsScreen
p = 'src/screens/settings/BusinessDefaultsScreen.tsx'
s = open(p).read()

sub(
    """/** Mirrors the per-document control on the preview screen. */
const PRICE_DETAIL_OPTIONS: { value: PriceDetail; label: string; blurb: string }[] = [
  { value: 'itemised', label: 'Itemised', blurb: 'Every line with its quantity and unit price.' },
  {
    value: 'summary',
    label: 'Scope only',
    blurb: 'What you\\u2019re doing and the section totals \\u2014 no quantities, no unit prices.',
  },
  { value: 'total', label: 'Total only', blurb: 'One number: the total.' },
];

""",
    "",
)

sub(
    """            <View style={styles.toggleLabel}>
              <Text style={styles.toggleTitle}>What the customer sees</Text>
              <Text style={styles.toggleDescription}>
                {PRICE_DETAIL_OPTIONS.find((o) => o.value === priceDetail)?.blurb}
              </Text>
            </View>
            <View style={styles.segmented}>
              {PRICE_DETAIL_OPTIONS.map((opt) => {
                const active = priceDetail === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.segment, active && styles.segmentActive]}
                    onPress={() => setPriceDetail(opt.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>""",
    """            <View style={styles.toggleLabel}>
              <Text style={styles.toggleTitle}>What the customer sees</Text>
              <Text style={styles.toggleDescription}>{priceDetailBlurb(priceDetail)}</Text>
            </View>
            <PillToggle
              value={priceDetail}
              onChange={setPriceDetail}
              options={PRICE_DETAIL_OPTIONS}
              fullWidth
              style={{ marginTop: 10 }}
            />""",
)

sub(
    "import { resolvePriceDetail, legacyFlagsFor, type PriceDetail } from '../../../shared/document/priceDetail';",
    "import { PillToggle } from '../../components/PillToggle';",
)

sub(
    "import { resolveGstMode, GstMode, NO_GST_NOTE } from '../../../shared/document';",
    "import {\n"
    "  resolveGstMode,\n"
    "  GstMode,\n"
    "  NO_GST_NOTE,\n"
    "  resolvePriceDetail,\n"
    "  legacyFlagsFor,\n"
    "  priceDetailBlurb,\n"
    "  PRICE_DETAIL_OPTIONS,\n"
    "  type PriceDetail,\n"
    "} from '../../../shared/document';",
)

sub(
    """  segmented: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.bg,
    overflow: 'hidden',
    marginTop: 10,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 6,
  },
  segmentActive: {
    backgroundColor: t.colors.accentSubtle,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  segmentLabelActive: {
    color: t.colors.accentText,
  },
""",
    "",
)

open(p, 'w').write(s)

# ------------------------------------------------- InlineAddMaterialRow
p = 'src/components/InlineAddMaterialRow.tsx'
s = open(p).read()

sub(
    """      <View style={styles.kindRow}>
        {(['material', 'work'] as const).map((k) => {
          const active = entryKind === k;
          return (
            <TouchableOpacity
              key={k}
              style={[styles.kindChip, active && styles.kindChipActive]}
              onPress={() => {
                setEntryKind(k);
                // Drop any supplier results and any picked result — they
                // belong to the other mode, and a stale one reappearing on the
                // way back would attach a product to a scope line.
                selectedResultRef.current = null;
                search.clearResults();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={k === 'work' ? 'Work item' : 'Material'}
            >
              <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>
                {k === 'work' ? 'Work item' : 'Material'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
""",
    """      <PillToggle
        value={entryKind}
        onChange={(k) => {
          setEntryKind(k);
          // Drop any supplier results and any picked result — they belong to
          // the other mode, and a stale one reappearing on the way back would
          // attach a product to a scope line.
          selectedResultRef.current = null;
          search.clearResults();
        }}
        options={ENTRY_KIND_OPTIONS}
      />
""",
)

sub(
    """  kindRow: {
    flexDirection: 'row',
    gap: 6,
  },
  kindChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.bg,
  },
  kindChipActive: {
    borderColor: t.colors.accent,
    backgroundColor: t.colors.accentSubtle,
  },
  kindChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  kindChipTextActive: {
    color: t.colors.accentText,
  },
""",
    "",
)

sub(
    "const UNITS: Material['unit'][] = ['each', 'm', 'm²', 'm³', 'L', 'kg', 'box', 'pack'];",
    "const UNITS: Material['unit'][] = ['each', 'm', 'm²', 'm³', 'L', 'kg', 'box', 'pack'];\n"
    "\n"
    "/** Is this row a product, or a lump-sum scope line? */\n"
    "const ENTRY_KIND_OPTIONS: PillToggleOption<'material' | 'work'>[] = [\n"
    "  { value: 'material', label: 'Material' },\n"
    "  { value: 'work', label: 'Work item' },\n"
    "];",
)

sub(
    "import { ActionSheet, ActionSheetOption } from './ActionSheet';",
    "import { ActionSheet, ActionSheetOption } from './ActionSheet';\n"
    "import { PillToggle, type PillToggleOption } from './PillToggle';",
)

open(p, 'w').write(s)
print('ok')
