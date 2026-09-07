/**
 * "How you quote" — the rules and rates every quote follows.
 *
 * Mate saves these from chat through a confirm card, and asks once on a
 * tradie's first job while nothing is saved. This is the other door: see
 * what's saved, remove what's wrong, add a rule or a rate by hand. Every
 * change saves straight away — deliberately outside the Trade pricing
 * screen's draft/Save cycle, because a wrong rule left in place is applied
 * to the very next quote.
 *
 * The add forms open in a BottomSheet, which lifts itself clear of the
 * keyboard on both platforms (the screen scrolls in a NestableScrollContainer
 * that can't be made keyboard-aware). The sheet renders through a Portal, so
 * it can sit here inside the card.
 *
 * Saves are optimistic: the store updates local state first and only then
 * awaits Firestore, whose write never settles while the phone is offline. So
 * nothing here waits on the save — the sheet closes, the row appears, and a
 * rejected write comes back through onError.
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Chip, Switch, Text, TextInput, Surface, Title, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { makeStyles, useThemeColors } from '../../theme';
import { BottomSheet } from '../../components/BottomSheet';
import { FooterButton } from '../../components/FooterButton';
import type { BusinessSettings, RateCardUnit } from '../../types';
import {
  RATE_CARD_UNITS,
  addPreference,
  normalisePreference,
  parseRateAmount,
  rateGstBasis,
  rateSummary,
  rateUnitLabel,
  removePreference,
  removeRate,
  upsertRate,
} from '../../services/quotingProfile';

interface Props {
  settings: BusinessSettings | null | undefined;
  /** Persists the whole settings object, the way the store's apply path does. */
  save: (next: BusinessSettings) => Promise<void>;
  onError: () => void;
}

type Adding = 'rule' | 'rate';
type RateDraft = { label: string; rate: number; unit: RateCardUnit; includesMaterials: boolean };

export function HowYouQuoteCard({ settings, save, onError }: Props) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [adding, setAdding] = useState<Adding | null>(null);
  // The sheet animates out after `adding` goes null, so the form it was
  // opened with stays mounted until it has gone; a fresh key per open is
  // what makes the next one start blank.
  const [shown, setShown] = useState<Adding>('rule');
  const [openId, setOpenId] = useState(0);
  useEffect(() => {
    if (adding) setShown(adding);
  }, [adding]);
  const open = (kind: Adding) => {
    setAdding(kind);
    setOpenId((n) => n + 1);
  };

  const preferences = settings?.quotingPreferences ?? [];
  const rateCard = settings?.rateCard ?? [];
  const hasAny = preferences.length > 0 || rateCard.length > 0;

  const persist = (next: BusinessSettings) => {
    setAdding(null);
    save(next).catch(onError);
  };

  const handleRemovePreference = (text: string) => {
    if (!settings) return;
    const next = removePreference(settings.quotingPreferences, text);
    persist({ ...settings, quotingPreferences: next.length ? next : undefined });
  };

  const handleRemoveRate = (id: string) => {
    if (!settings) return;
    const next = removeRate(settings.rateCard, id);
    persist({ ...settings, rateCard: next.length ? next : undefined });
  };

  const handleAddRule = (rule: string) => {
    if (!settings) return;
    persist({ ...settings, quotingPreferences: addPreference(settings.quotingPreferences, rule) });
  };

  const handleAddRate = (draft: RateDraft) => {
    if (!settings) return;
    // Typed in the business's usual basis — the hint under the field says which.
    persist({ ...settings, rateCard: upsertRate(settings.rateCard, { ...draft, pricesIncludeGst: rateGstBasis(settings) }) });
  };

  return (
    <Surface style={styles.card}>
      <Title style={styles.sectionTitle}>How you quote</Title>
      <Text style={styles.helperText}>
        {hasAny
          ? "Every quote follows these — remove anything that's off."
          : 'Tell Mate how you price and every quote follows it. Mate asks on your first job, or add a rule or a rate here.'}
      </Text>

      {preferences.map((pref) => (
        <View key={pref} style={styles.profileRow}>
          <Text style={styles.profileText}>{pref}</Text>
          <TouchableRipple
            style={styles.profileRemove}
            onPress={() => handleRemovePreference(pref)}
            accessibilityLabel={`Remove preference: ${pref}`}
            borderless
          >
            <MaterialCommunityIcons name="close-circle-outline" size={20} color={themeColors.textMuted} />
          </TouchableRipple>
        </View>
      ))}
      {rateCard.map((entry) => (
        <View key={entry.id} style={styles.profileRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rateLabel}>{entry.label}</Text>
            <Text style={styles.rateSummary}>{rateSummary(entry)}</Text>
          </View>
          <TouchableRipple
            style={styles.profileRemove}
            onPress={() => handleRemoveRate(entry.id)}
            accessibilityLabel={`Remove rate: ${entry.label}`}
            borderless
          >
            <MaterialCommunityIcons name="close-circle-outline" size={20} color={themeColors.textMuted} />
          </TouchableRipple>
        </View>
      ))}

      {/* Nowhere to keep a rule until the business settings have loaded. */}
      <View style={styles.addRow}>
        <Chip mode="outlined" icon="plus" onPress={() => open('rule')} disabled={!settings} accessibilityLabel="Add a rule">
          Add a rule
        </Chip>
        <Chip mode="outlined" icon="plus" onPress={() => open('rate')} disabled={!settings} accessibilityLabel="Add a rate">
          Add a rate
        </Chip>
      </View>

      <BottomSheet
        visible={adding !== null}
        onDismiss={() => setAdding(null)}
        title={shown === 'rule' ? 'Add a rule' : 'Add a rate'}
      >
        {shown === 'rule' ? (
          <RuleForm key={openId} onSave={handleAddRule} />
        ) : (
          <RateForm key={openId} gstBasis={settings ? rateGstBasis(settings) : undefined} onSave={handleAddRate} />
        )}
      </BottomSheet>
    </Surface>
  );
}

function RuleForm({ onSave }: { onSave: (rule: string) => void }) {
  const styles = useStyles();
  const [rule, setRule] = useState('');
  const ready = normalisePreference(rule) !== null;
  return (
    <View style={styles.form}>
      <TextInput
        label="Rule"
        value={rule}
        onChangeText={setRule}
        mode="outlined"
        style={styles.input}
        placeholder="e.g. Labour only — the customer buys the materials"
        maxLength={160}
        autoFocus
      />
      <Text style={styles.formHint}>One plain sentence, the way you'd say it. Mate follows it on every quote.</Text>
      <View style={styles.buttonRow}>
        <FooterButton label="Save rule" disabled={!ready} onPress={() => onSave(rule)} />
      </View>
    </View>
  );
}

function RateForm({ gstBasis, onSave }: { gstBasis: boolean | undefined; onSave: (draft: RateDraft) => void }) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<RateCardUnit>('hour');
  const [includesMaterials, setIncludesMaterials] = useState(false);
  const rate = parseRateAmount(amount);
  const ready = label.trim().length > 0 && rate !== null;
  return (
    <View style={styles.form}>
      <TextInput
        label="What the rate is for"
        value={label}
        onChangeText={setLabel}
        mode="outlined"
        style={styles.input}
        placeholder="e.g. End of lease clean"
        maxLength={120}
        autoFocus
      />
      <TextInput
        label="Rate"
        value={amount}
        onChangeText={setAmount}
        mode="outlined"
        style={styles.input}
        keyboardType="decimal-pad"
        left={<TextInput.Affix text="$" />}
        right={<TextInput.Affix text={unit === 'each' ? 'each' : `/${unit}`} />}
      />
      {gstBasis !== undefined && (
        <Text style={styles.formHint}>
          {gstBasis ? 'Inc GST, the way your quotes show prices.' : 'Ex GST, the way your quotes show prices.'}
        </Text>
      )}
      <View style={styles.pillContainer}>
        {RATE_CARD_UNITS.map((u) => {
          const isSelected = unit === u;
          return (
            <Chip
              key={u}
              selected={isSelected}
              onPress={() => setUnit(u)}
              mode={isSelected ? 'flat' : 'outlined'}
              style={isSelected && styles.pillSelected}
              textStyle={isSelected && { color: themeColors.onAccent, fontWeight: '600' }}
            >
              {rateUnitLabel(u)}
            </Chip>
          );
        })}
      </View>
      <View style={styles.toggleRow}>
        <View style={styles.toggleLabel}>
          <Text style={styles.toggleTitle}>Rate includes materials</Text>
          <Text style={styles.toggleDescription}>
            {includesMaterials ? 'The rate is the whole price.' : 'Labour only — materials get listed separately.'}
          </Text>
        </View>
        <Switch
          value={includesMaterials}
          onValueChange={setIncludesMaterials}
          color={themeColors.accentText}
          accessibilityLabel="Rate includes materials"
        />
      </View>
      <View style={styles.buttonRow}>
        <FooterButton
          label="Save rate"
          disabled={!ready}
          onPress={() => {
            if (rate !== null) onSave({ label, rate, unit, includesMaterials });
          }}
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  helperText: {
    fontSize: 14,
    color: t.colors.textSecondary,
    marginBottom: 16,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  profileText: {
    flex: 1,
    fontSize: 14,
    color: t.colors.text,
    lineHeight: 20,
  },
  profileRemove: {
    marginLeft: 12,
    padding: 4,
    borderRadius: 14,
  },
  rateLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  rateSummary: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  form: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  // FooterButton carries flex:1 for the footers it was built for, so it needs
  // a row to stretch across. In a plain column it collapses to no height at
  // all — the button rendered nowhere, and not into the a11y tree either.
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
  },
  input: {
    marginBottom: 12,
    backgroundColor: t.colors.surfaceRaised,
  },
  formHint: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginBottom: 12,
    lineHeight: 16,
  },
  pillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  pillSelected: {
    backgroundColor: t.colors.accent,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 8,
  },
  toggleLabel: { flex: 1, marginRight: 12 },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
  },
  toggleDescription: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
}));
