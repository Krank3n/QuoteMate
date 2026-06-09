/**
 * Manual entry form for AddMaterialScreen. Extracted from a 337-line
 * `renderManualEntrySection` inside the parent screen so the parent can stay
 * focused on orchestration. Controlled-component shape: parent owns all state,
 * passes value+setter for each field.
 */

import React from 'react';
import { View, TouchableOpacity, TextInput as RNTextInput } from 'react-native';
import { Text, TextInput, SegmentedButtons, Switch } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../../../theme';
import { Material } from '../../../types';
import { styles } from './styles';

type CoverageUnit = 'm²' | 'm³' | 'm' | 'none';

export interface ManualEntrySectionProps {
  // Refs
  materialNameRef: React.RefObject<RNTextInput | null>;
  // Flags
  linkedToSupplierBook: boolean;
  isEditMode: boolean;
  isSavedItemMode: boolean;
  isPro: boolean;
  // Existing data
  existingSections: string[];
  savedItemSupplierOptions: string[];
  // Form state
  manualName: string;
  setManualName: (v: string) => void;
  manualPrice: string;
  setManualPrice: (v: string) => void;
  manualQuantity: string;
  setManualQuantity: (v: string) => void;
  manualUnit: Material['unit'];
  setManualUnit: (v: Material['unit']) => void;
  selectedSection: string;
  setSelectedSection: (v: string) => void;
  showSectionPicker: boolean;
  setShowSectionPicker: (v: boolean) => void;
  isPersonalRate: boolean;
  setIsPersonalRate: (v: boolean) => void;
  supplierName: string;
  setSupplierName: (v: string) => void;
  supplierPickerOpen: boolean;
  setSupplierPickerOpen: (v: boolean) => void;
  rateKeywords: string;
  setRateKeywords: (v: string) => void;
  showCoverageOptions: boolean;
  setShowCoverageOptions: (v: boolean) => void;
  coveragePerUnit: string;
  setCoveragePerUnit: (v: string) => void;
  coverageUnit: CoverageUnit;
  setCoverageUnit: (v: CoverageUnit) => void;
  // Optional pack rounding for area-based reorder (e.g. bags delivered in 10s).
  roundingIncrement?: string;
  setRoundingIncrement?: (v: string) => void;
}

export function ManualEntrySection({
  materialNameRef,
  linkedToSupplierBook,
  isEditMode,
  isSavedItemMode,
  isPro,
  existingSections,
  savedItemSupplierOptions,
  manualName,
  setManualName,
  manualPrice,
  setManualPrice,
  manualQuantity,
  setManualQuantity,
  manualUnit,
  setManualUnit,
  selectedSection,
  setSelectedSection,
  showSectionPicker,
  setShowSectionPicker,
  isPersonalRate,
  setIsPersonalRate,
  supplierName,
  setSupplierName,
  supplierPickerOpen,
  setSupplierPickerOpen,
  rateKeywords,
  setRateKeywords,
  showCoverageOptions,
  setShowCoverageOptions,
  coveragePerUnit,
  setCoveragePerUnit,
  coverageUnit,
  setCoverageUnit,
  roundingIncrement,
  setRoundingIncrement,
}: ManualEntrySectionProps) {
  return (
    <View style={styles.section}>
      {linkedToSupplierBook && (
        <View style={styles.linkedBanner}>
          <MaterialCommunityIcons name="link-variant" size={16} color={colors.primary} />
          <Text style={styles.linkedBannerText}>
            Linked to your supplier book — changes save to both
          </Text>
        </View>
      )}
      {!isEditMode && !isSavedItemMode && (
        <View style={styles.manualEntryHeader}>
          <View style={styles.manualEntryDividerLine} />
          <Text style={styles.manualEntryHeaderText}>
            {isPro ? 'add manually' : 'Add Material'}
          </Text>
          <View style={styles.manualEntryDividerLine} />
        </View>
      )}

      <TextInput
        ref={materialNameRef}
        label={isSavedItemMode ? 'Item name *' : 'Material Name *'}
        value={manualName}
        onChangeText={setManualName}
        mode="outlined"
        style={styles.input}
        placeholder="e.g., Custom timber piece"
      />

      {isSavedItemMode ? (
        <TextInput
          label="Price per unit"
          value={manualPrice}
          onChangeText={setManualPrice}
          mode="outlined"
          keyboardType="decimal-pad"
          placeholder="Optional"
          left={<TextInput.Affix text="$" />}
          style={styles.input}
        />
      ) : (
        <View style={styles.row}>
          <View style={[styles.halfWidth, styles.quantityStepperContainer]}>
            <Text style={styles.quantityLabel}>Quantity *</Text>
            <View style={styles.quantityStepper}>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => {
                  const current = parseFloat(manualQuantity) || 1;
                  if (current > 1) setManualQuantity((current - 1).toString());
                }}
              >
                <MaterialCommunityIcons name="minus" size={20} color={colors.primary} />
              </TouchableOpacity>
              <TextInput
                value={manualQuantity}
                onChangeText={setManualQuantity}
                mode="flat"
                keyboardType="decimal-pad"
                style={styles.quantityInput}
                contentStyle={styles.quantityInputContent}
                underlineStyle={{ display: 'none' }}
              />
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => {
                  const current = parseFloat(manualQuantity) || 0;
                  setManualQuantity((current + 1).toString());
                }}
              >
                <MaterialCommunityIcons name="plus" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <TextInput
            label="Price per Unit"
            value={manualPrice}
            onChangeText={setManualPrice}
            mode="outlined"
            keyboardType="decimal-pad"
            placeholder="Optional"
            left={<TextInput.Affix text="$" />}
            style={[styles.input, styles.halfWidth]}
          />
        </View>
      )}

      <View style={styles.unitSelector}>
        <Text style={styles.unitLabel}>Unit</Text>
        <View style={styles.unitButtons}>
          <SegmentedButtons
            value={manualUnit}
            onValueChange={(value) => setManualUnit(value as Material['unit'])}
            buttons={[
              { value: 'each', label: 'Each' },
              { value: 'm', label: 'M' },
              { value: 'm²', label: 'm²' },
              { value: 'm³', label: 'm³' },
            ]}
            style={styles.unitRow}
          />
          <SegmentedButtons
            value={manualUnit}
            onValueChange={(value) => setManualUnit(value as Material['unit'])}
            buttons={[
              { value: 'L', label: 'L' },
              { value: 'kg', label: 'Kg' },
              { value: 'box', label: 'Box' },
              { value: 'pack', label: 'Pack' },
            ]}
            style={styles.unitRow}
          />
        </View>
      </View>

      {/* Section Picker */}
      {!isSavedItemMode && existingSections.length > 0 && (
        <View style={styles.categorySelector}>
          <Text style={styles.unitLabel}>Section (for grouping)</Text>
          <TouchableOpacity
            style={styles.categoryButton}
            onPress={() => setShowSectionPicker(!showSectionPicker)}
          >
            <MaterialCommunityIcons name="folder-outline" size={20} color={colors.primary} />
            <Text style={styles.categoryButtonText}>
              {selectedSection || 'No Section'}
            </Text>
            <MaterialCommunityIcons
              name={showSectionPicker ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.onSurface}
            />
          </TouchableOpacity>
          {showSectionPicker && (
            <View style={styles.categoryList}>
              <TouchableOpacity
                style={[styles.categoryItem, !selectedSection && styles.categoryItemSelected]}
                onPress={() => { setSelectedSection(''); setShowSectionPicker(false); }}
              >
                <Text style={[styles.categoryItemText, !selectedSection && styles.categoryItemTextSelected]}>No Section</Text>
              </TouchableOpacity>
              {existingSections.map((name) => (
                <TouchableOpacity
                  key={name}
                  style={[styles.categoryItem, selectedSection === name && styles.categoryItemSelected]}
                  onPress={() => { setSelectedSection(name); setShowSectionPicker(false); }}
                >
                  <Text style={[styles.categoryItemText, selectedSection === name && styles.categoryItemTextSelected]}>{name}</Text>
                  {selectedSection === name && (
                    <MaterialCommunityIcons name="check" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {/* "Save to supplier book" toggle — only in normal add-to-quote mode.
          In supplier-book edit/create mode the form IS the supplier-book editor,
          so the toggle is redundant. */}
      {!isSavedItemMode && (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Save to supplier book</Text>
          <Switch
            value={isPersonalRate}
            onValueChange={setIsPersonalRate}
            color={colors.primary}
          />
        </View>
      )}

      {(isPersonalRate || isSavedItemMode) && (
        <View style={isSavedItemMode ? undefined : styles.personalRateFields}>
          {!isSavedItemMode && (
            <Text style={styles.personalRateHelper}>
              When auto-generate sees a matching job, it will use this rate instead of searching retail.
            </Text>
          )}

          {/* Supplier picker — dropdown of existing suppliers, with free-text fallback */}
          <View style={styles.categorySelector}>
            <Text style={styles.unitLabel}>Supplier</Text>
            <TouchableOpacity
              style={styles.categoryButton}
              onPress={() => setSupplierPickerOpen(!supplierPickerOpen)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="store-outline" size={20} color={colors.primary} />
              <Text style={styles.categoryButtonText}>
                {supplierName || 'Choose or type a supplier'}
              </Text>
              <MaterialCommunityIcons
                name={supplierPickerOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.onSurface}
              />
            </TouchableOpacity>
            {supplierPickerOpen && (
              <View style={styles.categoryList}>
                {savedItemSupplierOptions.length === 0 && (
                  <View style={styles.categoryItem}>
                    <Text style={[styles.categoryItemText, { color: colors.textMuted }]}>
                      No saved suppliers yet — type a name below
                    </Text>
                  </View>
                )}
                {savedItemSupplierOptions.map((name) => (
                  <TouchableOpacity
                    key={name}
                    style={[styles.categoryItem, supplierName === name && styles.categoryItemSelected]}
                    onPress={() => {
                      setSupplierName(name);
                      setSupplierPickerOpen(false);
                    }}
                  >
                    <Text style={[styles.categoryItemText, supplierName === name && styles.categoryItemTextSelected]}>
                      {name}
                    </Text>
                    {supplierName === name && (
                      <MaterialCommunityIcons name="check" size={18} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TextInput
              value={supplierName}
              onChangeText={setSupplierName}
              mode="outlined"
              dense
              placeholder="Or type a new supplier name"
              style={[styles.input, { marginTop: 8 }]}
            />
          </View>

          <TextInput
            label="Match keywords (comma-separated)"
            value={rateKeywords}
            onChangeText={setRateKeywords}
            mode="outlined"
            placeholder="e.g. concrete, slab, footing"
            style={styles.input}
          />

          {/* Coverage is an advanced concept — only relevant when one purchasable
              unit contains a fixed amount of work-volume (e.g. a half-cube mulch
              bag, a 13 m² FC sheet). Hidden behind a disclosure to keep the form
              clean for the common case. */}
          <TouchableOpacity
            style={styles.advancedToggle}
            onPress={() => setShowCoverageOptions(!showCoverageOptions)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={showCoverageOptions ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.primary}
            />
            <Text style={styles.advancedToggleText}>
              {showCoverageOptions ? 'Hide' : 'Show'} coverage settings
            </Text>
          </TouchableOpacity>

          {showCoverageOptions && (
            <View>
              <Text style={styles.coverageHelper}>
                Use this only when one purchasable unit covers a fixed amount of work
                — e.g. a sheet that covers 13 m², or a bag that contains ½ m³ of mulch.
              </Text>
              <TextInput
                label="Coverage per unit"
                value={coveragePerUnit}
                onChangeText={setCoveragePerUnit}
                mode="outlined"
                keyboardType="decimal-pad"
                placeholder="e.g. 13"
                style={styles.input}
              />
              <Text style={styles.unitLabel}>Coverage unit</Text>
              <SegmentedButtons
                value={coverageUnit}
                onValueChange={(value) => setCoverageUnit(value as CoverageUnit)}
                buttons={[
                  { value: 'm²', label: 'm²' },
                  { value: 'm³', label: 'm³' },
                  { value: 'm', label: 'm' },
                  { value: 'none', label: 'None' },
                ]}
                style={styles.unitRow}
              />
              {setRoundingIncrement && (
                <TextInput
                  label="Order in packs of (optional)"
                  value={roundingIncrement || ''}
                  onChangeText={setRoundingIncrement}
                  mode="outlined"
                  keyboardType="number-pad"
                  placeholder="e.g. 10 for bags delivered in 10s"
                  style={styles.input}
                />
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
