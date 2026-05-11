/**
 * AddressSearchInput
 *
 * Debounced AU-address search via Google Places. Two modes:
 *  - Uncontrolled (Reece): pass `onAddressSelect` to receive the structured
 *    address; the parent renders its own "selected" state.
 *  - Controlled (Customer / Business): pass `value` + `onChangeText`. The
 *    component flips between a search input and a "selected" map-marker
 *    card, mirroring the Reece pattern. A non-empty starting `value` is
 *    treated as a previously-saved selection.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator, TouchableOpacity } from 'react-native';
import { TextInput, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
import {
  fetchAddressDetails,
  newPlacesSessionToken,
  searchAddresses,
  type PlacesAddressDetails,
  type PlacesAddressPrediction,
} from '../services/placesApi';

interface AddressSearchInputProps {
  label?: string;
  placeholder?: string;
  /** Fires on prediction tap with the structured AU address. Optional —
   *  parents that only need a single formatted string can rely on the
   *  controlled `onChangeText` instead. */
  onAddressSelect?: (address: PlacesAddressDetails) => void;
  /** Controlled value. When provided alongside `onChangeText`, the parent
   *  owns the input text and the component renders the selected card once
   *  an address is in place. */
  value?: string;
  onChangeText?: (text: string) => void;
  style?: any;
}

const DEBOUNCE_MS = 220;
const MIN_QUERY_LENGTH = 3;

export function AddressSearchInput({
  label = 'Search address',
  placeholder = 'Start typing an Australian address',
  onAddressSelect,
  value,
  onChangeText,
  style,
}: AddressSearchInputProps) {
  const isControlled = value !== undefined && typeof onChangeText === 'function';
  const [internalQuery, setInternalQuery] = useState('');
  const query = isControlled ? (value ?? '') : internalQuery;
  const setQuery = (next: string) => {
    if (isControlled) onChangeText!(next);
    else setInternalQuery(next);
  };

  // Card vs search-input toggle for controlled mode. Initialised true when
  // the parent already has a stored address — assume any pre-existing
  // string came from a previous Google selection.
  const [selected, setSelected] = useState<boolean>(
    isControlled && (value ?? '').length > 0,
  );

  const [predictions, setPredictions] = useState<PlacesAddressPrediction[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [open, setOpen] = useState(false);

  // Single session token per typing session — billed as one autocomplete +
  // one details lookup by Google. Rotate after each successful selection.
  const sessionTokenRef = useRef<string>(newPlacesSessionToken());
  const queryVersionRef = useRef(0);
  // After we set the field to a picked address, suppress the next search —
  // otherwise we'd burn another autocomplete call against the formatted
  // string the user just confirmed.
  const skipNextSearchRef = useRef(false);
  // Distinguishes a user keystroke (stay in search) from an external value
  // update like "customer auto-filled from contacts" (flip to card).
  const userTypingRef = useRef(false);

  useEffect(() => {
    // External (non-typed) value update in controlled mode → flip to card.
    if (
      isControlled &&
      !userTypingRef.current &&
      (value ?? '').length > 0 &&
      !selected
    ) {
      setSelected(true);
      return;
    }
    userTypingRef.current = false;

    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (selected) return;

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setPredictions([]);
      setSearching(false);
      return;
    }
    const myVersion = ++queryVersionRef.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchAddresses(trimmed, sessionTokenRef.current);
      if (myVersion !== queryVersionRef.current) return; // stale
      setPredictions(results);
      setSearching(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selected, isControlled, value]);

  const handleSelect = async (prediction: PlacesAddressPrediction) => {
    setResolving(true);
    setOpen(false);
    const details = await fetchAddressDetails(prediction.placeId, sessionTokenRef.current);
    setResolving(false);
    if (details) {
      if (onAddressSelect) onAddressSelect(details);
      skipNextSearchRef.current = true;
      setQuery(details.formattedAddress || prediction.description);
      setPredictions([]);
      if (isControlled) setSelected(true);
      sessionTokenRef.current = newPlacesSessionToken();
    }
  };

  const handleChangeAddress = () => {
    setSelected(false);
    setPredictions([]);
    setQuery('');
    sessionTokenRef.current = newPlacesSessionToken();
  };

  const showDropdown = useMemo(
    () => open && (predictions.length > 0 || searching),
    [open, predictions.length, searching],
  );

  if (isControlled && selected) {
    return (
      <View style={[styles.wrapper, style]}>
        {label ? <Text style={styles.cardLabel}>{label}</Text> : null}
        <View style={styles.selectedCard}>
          <MaterialCommunityIcons name="map-marker-check" size={20} color={colors.success} />
          <Text style={styles.selectedText} numberOfLines={2}>
            {value}
          </Text>
          <TouchableOpacity onPress={handleChangeAddress} hitSlop={8}>
            <Text style={styles.changeLink}>Change</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrapper, style]}>
      <TextInput
        label={label}
        placeholder={placeholder}
        value={query}
        onChangeText={(t) => {
          userTypingRef.current = true;
          setQuery(t);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        mode="outlined"
        right={
          resolving ? (
            <TextInput.Icon icon={() => <ActivityIndicator size={16} color={colors.primary} />} />
          ) : query.length > 0 ? (
            <TextInput.Icon
              icon="close"
              onPress={() => {
                setQuery('');
                setPredictions([]);
                setOpen(false);
              }}
            />
          ) : (
            <TextInput.Icon icon="magnify" />
          )
        }
        autoCapitalize="words"
        autoCorrect={false}
      />
      {showDropdown ? (
        <View style={styles.dropdown}>
          {searching && predictions.length === 0 ? (
            <View style={styles.dropdownItem}>
              <ActivityIndicator size={14} color={colors.primary} />
              <Text style={styles.dropdownEmpty}>Searching…</Text>
            </View>
          ) : (
            predictions.map((p) => (
              <Pressable
                key={p.placeId}
                onPress={() => handleSelect(p)}
                style={({ pressed }) => [styles.dropdownItem, pressed && styles.dropdownItemPressed]}
              >
                <MaterialCommunityIcons name="map-marker-outline" size={18} color={colors.textMuted} />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.dropdownMain} numberOfLines={1}>
                    {p.mainText}
                  </Text>
                  {p.secondaryText ? (
                    <Text style={styles.dropdownSecondary} numberOfLines={1}>
                      {p.secondaryText}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  cardLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 6,
    fontWeight: '600',
  },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceGray3,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  selectedText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  changeLink: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  dropdown: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginTop: 4,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dropdownItemPressed: {
    backgroundColor: colors.surfaceGray3,
  },
  dropdownMain: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  dropdownSecondary: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  dropdownEmpty: {
    fontSize: 13,
    color: colors.textMuted,
    marginLeft: 8,
  },
});
