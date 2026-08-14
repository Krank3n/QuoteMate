/**
 * PDF Template Settings Screen
 * Choose document style for quotes and invoices
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Platform,
  Switch,
} from 'react-native';
import {
  Text,
  Surface,
  Title,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Print from 'expo-print';

import { useNavigation } from '@react-navigation/native';
import { useStore } from '../../store/useStore';
import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { ProBadge } from '../../components/ProBadge';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import {
  PDF_TEMPLATES,
  PdfTemplateId,
  buildQuotePdfHtml,
  toPdfMaterials,
  type QuotePdfData,
} from '../../../shared/pdf';
import { resolveGstMode, GstMode, NO_GST_NOTE } from '../../../shared/document';
import { resolvePriceDetail, type PriceDetail } from '../../../shared/document/priceDetail';
import { calculateDocumentTotals } from '../../utils/documentCalculator';
import { prepareLogoHtml } from '../../utils/pdfGenerator';
import { Material, QuoteSection } from '../../types';
import { GridBackground } from '../../components/GridBackground';

/**
 * The one thing this screen still owns about the sample document: its data.
 * Every figure below is run through the real calculator and the real HTML
 * builder, so the preview cannot drift from the document a customer receives
 * — which is exactly what the hand-written copy of the markup did.
 */
const SAMPLE_MATERIALS: Material[] = [
  { id: 'm1', name: 'Treated Pine Joists 90x45mm', quantity: 18, unit: 'each', price: 28, totalPrice: 504, manualPriceOverride: true, section: 'Framing' },
  { id: 'm2', name: 'Concrete Pier Blocks', quantity: 12, unit: 'each', price: 14.95, totalPrice: 179.4, manualPriceOverride: true, section: 'Framing' },
  { id: 'm3', name: 'Merbau Decking 90x19mm', quantity: 48, unit: 'm', price: 12.5, totalPrice: 600, manualPriceOverride: true, section: 'Decking' },
  { id: 'm4', name: 'Stainless Steel Deck Screws', quantity: 3, unit: 'box', price: 24.95, totalPrice: 74.85, manualPriceOverride: true, section: 'Decking' },
  { id: 'm5', name: 'Deck Stain - Natural', quantity: 4, unit: 'L', price: 42, totalPrice: 168, manualPriceOverride: true, section: 'Finishing' },
];

const SAMPLE_RATE = 85;

function sampleSection(name: string, hours: number, sortOrder: number): QuoteSection {
  return {
    id: `sample-${sortOrder}`,
    name,
    multiplier: 1,
    laborHours: hours,
    laborHoursTotal: hours,
    laborRate: SAMPLE_RATE,
    laborUnit: 'hours',
    laborTotal: hours * SAMPLE_RATE,
    sortOrder,
  };
}

const SAMPLE_SECTIONS: QuoteSection[] = [
  sampleSection('Framing', 6, 0),
  sampleSection('Decking', 7, 1),
  sampleSection('Finishing', 3, 2),
];

const SAMPLE_MARKUP_PCT = 15;

function buildSampleQuote(opts: {
  showMarkup: boolean;
  priceDetail: PriceDetail;
  showLaborHours: boolean;
  pricesIncludeGst: boolean;
  gstRegistered: boolean;
  terms?: string;
}): QuotePdfData {
  const totals = calculateDocumentTotals(
    SAMPLE_MATERIALS,
    SAMPLE_RATE,
    0,
    SAMPLE_MARKUP_PCT,
    0,
    SAMPLE_SECTIONS,
    SAMPLE_MARKUP_PCT,
    0,
    opts.pricesIncludeGst,
    opts.gstRegistered,
  );
  return {
    customerName: 'Sarah Johnson',
    customerEmail: 'sarah@example.com',
    jobAddress: '42 Banksia Drive, Melbourne VIC 3000',
    quoteNumber: 'Q-001',
    quoteDate: '10 March 2026',
    job: {
      name: 'Rear Deck Build',
      description: 'Build a 6m x 4m hardwood deck with steps and railing to the rear of property.',
    },
    materials: toPdfMaterials(SAMPLE_MATERIALS),
    materialsSubtotal: totals.materialsSubtotal,
    laborRate: SAMPLE_RATE,
    laborHours: 16,
    laborTotal: totals.laborTotal,
    sections: SAMPLE_SECTIONS.map((s) => ({
      name: s.name,
      laborHours: s.laborHours,
      multiplier: s.multiplier,
      laborHoursTotal: s.laborHoursTotal,
      laborRate: s.laborRate,
      laborUnit: s.laborUnit,
      laborTotal: s.laborTotal,
    })),
    subtotal: totals.subtotal,
    markup: SAMPLE_MARKUP_PCT,
    markupAmount: totals.markupAmount,
    laborMarkup: SAMPLE_MARKUP_PCT,
    showMarkup: opts.showMarkup,
    priceDetail: opts.priceDetail,
    showLaborHours: opts.showLaborHours,
    gst: totals.gst,
    total: totals.total,
    pricesIncludeGst: opts.pricesIncludeGst,
    gstRegistered: opts.gstRegistered,
    notes: 'All timber will be treated and stained. Work includes cleanup and disposal of waste materials. Deck will comply with local council regulations.',
    terms: opts.terms,
  };
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const PREVIEW_WIDTH = Math.min(SCREEN_WIDTH - 64, 340);
const PREVIEW_HEIGHT = PREVIEW_WIDTH * 1.35; // Roughly A4 proportions

/** Text line placeholder for the document mockup */
function Line({ width, height = 3, color = '#D1D5DB', style }: {
  width: string | number;
  height?: number;
  color?: string;
  style?: object;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return <View style={[{ width: width as any, height, backgroundColor: color, borderRadius: 1 }, style]} />;
}

/**
 * Full-width detailed native document mockup. Materials always show under
 * section headings now — grouping is no longer a setting, so there is nothing
 * to preview both ways.
 */
function TemplatePreview({ templateId, businessName, brandColor, gstMode }: { templateId: PdfTemplateId; businessName: string; brandColor?: string; gstMode: GstMode }) {
  const groupBySection = true;
  const styles = useStyles();
  const themeColors = useThemeColors();
  const configs: Record<PdfTemplateId, {
    pageBg: string;
    headerBg: string;
    headerTextColor: string;
    accentColor: string;
    bodyTextColor: string;
    subtleTextColor: string;
    tableHeaderBg: string;
    tableHeaderText: string;
    alternateRowBg: string | null;
    summaryBg: string;
    summaryBorder: string | null;
    summaryRadius: number;
    borderStyle: 'accent-bottom' | 'none' | 'dark-band' | 'ruled';
    fontLabel: string;
    fontFamily: string | undefined;
    headerBorderColor: string;
    tableBorderStyle: 'filled' | 'ruled';
  }> = {
    professional: {
      pageBg: '#FFFFFF',
      headerBg: 'transparent',
      headerTextColor: '#059669',
      accentColor: '#059669',
      bodyTextColor: '#333333',
      subtleTextColor: '#666666',
      tableHeaderBg: '#059669',
      tableHeaderText: '#FFFFFF',
      alternateRowBg: null,
      summaryBg: '#F9F9F9',
      summaryBorder: '#E0E0E0',
      summaryRadius: 6,
      borderStyle: 'accent-bottom',
      fontLabel: 'Helvetica Neue',
      fontFamily: undefined,
      headerBorderColor: '#059669',
      tableBorderStyle: 'filled',
    },
    accredited: {
      pageBg: '#FFFFFF',
      headerBg: 'transparent',
      headerTextColor: '#059669',
      accentColor: '#059669',
      bodyTextColor: '#333333',
      subtleTextColor: '#666666',
      tableHeaderBg: '#059669',
      tableHeaderText: '#FFFFFF',
      alternateRowBg: null,
      summaryBg: '#F9F9F9',
      summaryBorder: '#E0E0E0',
      summaryRadius: 6,
      borderStyle: 'accent-bottom',
      fontLabel: 'Helvetica Neue',
      fontFamily: undefined,
      headerBorderColor: '#059669',
      tableBorderStyle: 'filled',
    },
    clean: {
      pageBg: '#FFFFFF',
      headerBg: 'transparent',
      headerTextColor: '#111827',
      accentColor: '#6B7280',
      bodyTextColor: '#1F2937',
      subtleTextColor: '#9CA3AF',
      tableHeaderBg: 'transparent',
      tableHeaderText: '#9CA3AF',
      alternateRowBg: null,
      summaryBg: 'transparent',
      summaryBorder: null,
      summaryRadius: 0,
      borderStyle: 'none',
      fontLabel: 'System Sans',
      fontFamily: undefined,
      headerBorderColor: '#E5E7EB',
      tableBorderStyle: 'ruled',
    },
    bold: {
      pageBg: '#FFFFFF',
      headerBg: '#1F2937',
      headerTextColor: '#FFFFFF',
      accentColor: '#1F2937',
      bodyTextColor: '#1F2937',
      subtleTextColor: '#6B7280',
      tableHeaderBg: '#1F2937',
      tableHeaderText: '#FFFFFF',
      alternateRowBg: '#F9FAFB',
      summaryBg: '#FFFFFF',
      summaryBorder: '#1F2937',
      summaryRadius: 0,
      borderStyle: 'dark-band',
      fontLabel: 'Helvetica Bold',
      fontFamily: undefined,
      headerBorderColor: '#1F2937',
      tableBorderStyle: 'filled',
    },
    tradesman: {
      pageBg: '#FDFCF8',
      headerBg: 'transparent',
      headerTextColor: '#1C1917',
      accentColor: '#374151',
      bodyTextColor: '#1C1917',
      subtleTextColor: '#44403C',
      tableHeaderBg: 'transparent',
      tableHeaderText: '#1C1917',
      alternateRowBg: null,
      summaryBg: '#FAF7EE',
      summaryBorder: null,
      summaryRadius: 0,
      borderStyle: 'ruled',
      fontLabel: 'Georgia (Serif)',
      fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
      headerBorderColor: '#374151',
      tableBorderStyle: 'ruled',
    },
  };

  const c = { ...configs[templateId] };
  // Apply brand color override
  if (brandColor) {
    c.accentColor = brandColor;
    c.headerTextColor = templateId === 'bold' ? c.headerTextColor : brandColor;
    c.tableHeaderBg = templateId === 'clean' ? c.tableHeaderBg : brandColor;
    if (templateId === 'professional') {
      c.headerBorderColor = brandColor;
    }
  }
  const scale = PREVIEW_WIDTH / 420; // Scale factor relative to a ~420pt "page"
  const font = c.fontFamily ? { fontFamily: c.fontFamily } : {};

  const sampleSections = [
    {
      label: 'Framing',
      items: [
        { name: 'Treated Pine Joists', qty: '12 each', price: '$32.00', total: '$384.00' },
      ],
    },
    {
      label: 'Decking',
      items: [
        { name: 'Hardwood Decking Boards', qty: '24 m', price: '$18.50', total: '$444.00' },
        { name: 'Stainless Steel Screws', qty: '2 box', price: '$24.95', total: '$49.90' },
      ],
    },
  ];

  const allItems = sampleSections.flatMap(s => s.items);

  return (
    <View style={[styles.previewContainer, { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }]}>
      <View style={[styles.previewPage, { backgroundColor: c.pageBg }]}>
        {/* === HEADER === */}
        {c.borderStyle === 'dark-band' ? (
          // Bold: dark background band
          <View style={[styles.prevHeader, { backgroundColor: c.headerBg, paddingHorizontal: 14 * scale, paddingVertical: 10 * scale }]}>
            <Text style={[styles.prevBusinessName, { color: c.headerTextColor, fontSize: 14 * scale, fontWeight: '800', ...font }]} numberOfLines={1}>
              {businessName}
            </Text>
            <Line width="45%" height={2.5 * scale} color={c.headerTextColor + '60'} style={{ marginTop: 3 * scale }} />
          </View>
        ) : (
          // Others: accent border bottom or no border
          <View style={[
            styles.prevHeader,
            { paddingHorizontal: 14 * scale, paddingVertical: 8 * scale },
            c.borderStyle === 'accent-bottom' && { borderBottomWidth: 2.5 * scale, borderBottomColor: c.headerBorderColor },
            c.borderStyle === 'ruled' && { borderBottomWidth: 1.5 * scale, borderBottomColor: c.headerBorderColor },
          ]}>
            <Text style={[styles.prevBusinessName, {
              color: c.headerTextColor,
              fontSize: 13 * scale,
              fontWeight: templateId === 'clean' ? '300' : '700',
              letterSpacing: templateId === 'clean' ? 0.5 : 0,
              ...font,
            }]} numberOfLines={1}>
              {businessName}
            </Text>
            <Line width="40%" height={2 * scale} color={c.subtleTextColor} style={{ marginTop: 3 * scale }} />
          </View>
        )}

        {/* === QUOTATION HEADING === */}
        <View style={{ paddingHorizontal: 14 * scale, marginTop: 8 * scale }}>
          <Text style={[styles.prevSectionHeading, {
            color: templateId === 'clean' ? c.accentColor : c.bodyTextColor,
            fontSize: templateId === 'bold' ? 12 * scale : 10 * scale,
            fontWeight: templateId === 'bold' ? '800' : '600',
            letterSpacing: templateId === 'clean' ? 1.5 : 0,
            textTransform: templateId === 'clean' || templateId === 'tradesman' ? 'uppercase' : 'none',
            ...font,
          }]}>
            QUOTATION
          </Text>
          {templateId === 'tradesman' && (
            <View style={{ borderBottomWidth: 0.5 * scale, borderBottomColor: c.subtleTextColor, marginTop: 2 * scale, width: '100%' }} />
          )}

          {/* Customer & date info */}
          <View style={{ marginTop: 4 * scale }}>
            <Line width="55%" height={2.5 * scale} color={c.bodyTextColor + '50'} style={{ marginBottom: 2.5 * scale }} />
            <Line width="40%" height={2.5 * scale} color={c.bodyTextColor + '40'} />
          </View>
        </View>

        {/* === JOB DETAILS === */}
        <View style={{ paddingHorizontal: 14 * scale, marginTop: 7 * scale }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {templateId === 'clean' && (
              <View style={{ width: 2.5 * scale, height: 8 * scale, backgroundColor: c.accentColor, marginRight: 5 * scale, borderRadius: 1 }} />
            )}
            <Text style={{
              color: c.accentColor,
              fontSize: 7.5 * scale,
              fontWeight: '600',
              ...font,
            }}>
              Job Details
            </Text>
          </View>
          <Line width="65%" height={2 * scale} color={c.bodyTextColor + '35'} style={{ marginTop: 3 * scale }} />
        </View>

        {/* === MATERIALS TABLE === */}
        <View style={{ paddingHorizontal: 14 * scale, marginTop: 8 * scale }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 * scale }}>
            {templateId === 'clean' && (
              <View style={{ width: 2.5 * scale, height: 8 * scale, backgroundColor: c.accentColor, marginRight: 5 * scale, borderRadius: 1 }} />
            )}
            <Text style={{
              color: c.accentColor,
              fontSize: 7.5 * scale,
              fontWeight: '600',
              ...font,
            }}>
              Materials
            </Text>
          </View>

          {/* Table content - grouped or flat */}
          {groupBySection ? (
            <>
              {sampleSections.map((section, si) => (
                <View key={si} style={{ marginBottom: 4 * scale }}>
                  {/* Section label */}
                  <View style={[
                    styles.prevTableRow,
                    c.tableBorderStyle === 'filled'
                      ? { backgroundColor: c.tableHeaderBg + 'CC', borderRadius: templateId === 'professional' ? 2 * scale : 0 }
                      : { borderTopWidth: 1.5 * scale, borderBottomWidth: 0.5 * scale, borderColor: c.accentColor },
                    { paddingVertical: 2.5 * scale, paddingHorizontal: 4 * scale },
                  ]}>
                    <Text style={{ color: c.tableBorderStyle === 'filled' ? '#FFFFFF' : c.accentColor, fontSize: 5.5 * scale, fontWeight: '700', ...font }}>{section.label}</Text>
                  </View>
                  {/* Section rows */}
                  {section.items.map((item, i) => (
                    <View key={i} style={[
                      styles.prevTableRow,
                      {
                        paddingVertical: 2.5 * scale,
                        paddingHorizontal: 4 * scale,
                        borderBottomWidth: 0.5 * scale,
                        borderBottomColor: c.bodyTextColor + '20',
                      },
                      c.alternateRowBg && i % 2 === 1 && { backgroundColor: c.alternateRowBg },
                    ]}>
                      <Text style={{ flex: 3, color: c.bodyTextColor, fontSize: 5 * scale, ...font }} numberOfLines={1}>{item.name}</Text>
                      <Text style={{ flex: 1, color: c.bodyTextColor, fontSize: 5 * scale, textAlign: 'right', ...font }}>{item.total}</Text>
                    </View>
                  ))}
                </View>
              ))}
              {/* Total row */}
              <View style={[styles.prevTableRow, {
                paddingVertical: 2.5 * scale,
                paddingHorizontal: 4 * scale,
                borderTopWidth: c.tableBorderStyle === 'ruled' ? 1.5 * scale : 0,
                borderTopColor: c.accentColor,
                backgroundColor: templateId === 'professional' ? '#F5F5F5' : 'transparent',
              }]}>
                <Text style={{ flex: 5, color: c.bodyTextColor, fontSize: 5.5 * scale, fontWeight: '700', ...font }}>Materials Subtotal</Text>
                <Text style={{ flex: 1, color: c.bodyTextColor, fontSize: 5.5 * scale, fontWeight: '700', textAlign: 'right', ...font }}>$877.90</Text>
              </View>
            </>
          ) : (
            <>
              {/* Table header */}
              <View style={[
                styles.prevTableRow,
                c.tableBorderStyle === 'filled' && { backgroundColor: c.tableHeaderBg, borderRadius: templateId === 'professional' ? 2 * scale : 0 },
                c.tableBorderStyle === 'ruled' && { borderTopWidth: 1.5 * scale, borderBottomWidth: 1.5 * scale, borderColor: c.accentColor },
                { paddingVertical: 3 * scale, paddingHorizontal: 4 * scale },
              ]}>
                <Text style={{ flex: 3, color: c.tableHeaderText, fontSize: 5.5 * scale, fontWeight: '600', ...font }}>Item</Text>
                <Text style={{ flex: 1, color: c.tableHeaderText, fontSize: 5.5 * scale, fontWeight: '600', textAlign: 'center', ...font }}>Qty</Text>
                <Text style={{ flex: 1, color: c.tableHeaderText, fontSize: 5.5 * scale, fontWeight: '600', textAlign: 'right', ...font }}>Price</Text>
                <Text style={{ flex: 1, color: c.tableHeaderText, fontSize: 5.5 * scale, fontWeight: '600', textAlign: 'right', ...font }}>Total</Text>
              </View>

              {/* Table rows */}
              {allItems.map((item, i) => (
                <View key={i} style={[
                  styles.prevTableRow,
                  {
                    paddingVertical: 2.5 * scale,
                    paddingHorizontal: 4 * scale,
                    borderBottomWidth: 0.5 * scale,
                    borderBottomColor: c.bodyTextColor + '20',
                  },
                  c.alternateRowBg && i % 2 === 1 && { backgroundColor: c.alternateRowBg },
                ]}>
                  <Text style={{ flex: 3, color: c.bodyTextColor, fontSize: 5 * scale, ...font }} numberOfLines={1}>{item.name}</Text>
                  <Text style={{ flex: 1, color: c.bodyTextColor, fontSize: 5 * scale, textAlign: 'center', ...font }}>{item.qty}</Text>
                  <Text style={{ flex: 1, color: c.bodyTextColor, fontSize: 5 * scale, textAlign: 'right', ...font }}>{item.price}</Text>
                  <Text style={{ flex: 1, color: c.bodyTextColor, fontSize: 5 * scale, textAlign: 'right', ...font }}>{item.total}</Text>
                </View>
              ))}

              {/* Subtotal row */}
              <View style={[styles.prevTableRow, {
                paddingVertical: 2.5 * scale,
                paddingHorizontal: 4 * scale,
                borderTopWidth: c.tableBorderStyle === 'ruled' ? 1.5 * scale : 0,
                borderTopColor: c.accentColor,
                backgroundColor: templateId === 'professional' ? '#F5F5F5' : 'transparent',
              }]}>
                <Text style={{ flex: 5, color: c.bodyTextColor, fontSize: 5.5 * scale, fontWeight: '700', ...font }}>Materials Subtotal</Text>
                <Text style={{ flex: 1, color: c.bodyTextColor, fontSize: 5.5 * scale, fontWeight: '700', textAlign: 'right', ...font }}>$877.90</Text>
              </View>
            </>
          )}
        </View>

        {/* === SUMMARY === */}
        <View style={[
          styles.prevSummary,
          {
            marginHorizontal: 14 * scale,
            marginTop: 7 * scale,
            padding: 7 * scale,
            backgroundColor: c.summaryBg,
            borderRadius: c.summaryRadius * scale,
          },
          c.summaryBorder && { borderWidth: 1 * scale, borderColor: c.summaryBorder },
          !c.summaryBorder && templateId === 'clean' && { borderTopWidth: 0.5 * scale, borderTopColor: '#E5E7EB', paddingHorizontal: 0 },
          !c.summaryBorder && templateId === 'tradesman' && { borderTopWidth: 1.5 * scale, borderBottomWidth: 1.5 * scale, borderColor: c.accentColor, paddingHorizontal: 0 },
        ]}>
          {(gstMode === 'inclusive'
            ? [
                { label: 'Subtotal', value: '$1,217.90' },
                { label: 'Includes GST', value: '$110.72' },
              ]
            : gstMode === 'none'
              ? [
                  { label: 'Subtotal', value: '$1,107.18' },
                ]
              : [
                  { label: 'Subtotal (ex GST)', value: '$1,107.18' },
                  { label: 'GST (10%)', value: '$110.72' },
                ]
          ).map((row, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 * scale }}>
              <Text style={{ color: c.bodyTextColor, fontSize: 5 * scale, ...font }}>{row.label}</Text>
              <Text style={{ color: c.bodyTextColor, fontSize: 5 * scale, ...font }}>{row.value}</Text>
            </View>
          ))}
          <View style={{ borderTopWidth: 0.5 * scale, borderTopColor: c.bodyTextColor + '30', marginVertical: 2 * scale }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.accentColor, fontSize: 7 * scale, fontWeight: '800', ...font }}>TOTAL</Text>
            <Text style={{ color: c.accentColor, fontSize: 7 * scale, fontWeight: '800', ...font }}>{gstMode === 'none' ? '$1,107.18' : '$1,217.90'}</Text>
          </View>
          {gstMode === 'none' && (
            <Text style={{ color: c.bodyTextColor, fontSize: 4.5 * scale, marginTop: 2 * scale, ...font }}>{NO_GST_NOTE}</Text>
          )}
        </View>

        {/* === FOOTER === */}
        <View style={{ paddingHorizontal: 14 * scale, marginTop: 6 * scale }}>
          <Line width="70%" height={1.5 * scale} color={c.bodyTextColor + '15'} />
          <Line width="50%" height={1.5 * scale} color={c.bodyTextColor + '10'} style={{ marginTop: 2 * scale }} />
        </View>

        {/* Font label badge */}
        <View style={[styles.fontBadge, { backgroundColor: c.accentColor + '15' }]}>
          <Text style={[styles.fontBadgeText, { color: c.accentColor }]}>{c.fontLabel}</Text>
        </View>
      </View>
    </View>
  );
}

export function PDFTemplateScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const { businessSettings, setBusinessSettings, subscriptionStatus } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplateId>('professional');
  const [showLaborHours, setShowLaborHours] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState<PdfTemplateId | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);

  // Cost/markup visibility toggles live in BusinessDefaults → Document Display.
  // Here we read the current values to drive the live preview so the tradie
  // can see the effect without leaving this screen.
  const showMarkup = businessSettings?.showMarkup === true;
  // Preview the account's own default presentation, resolved the same way the
  // real document resolves it.
  const priceDetail = resolvePriceDetail(null, businessSettings);

  useEffect(() => {
    if (businessSettings) {
      const tpl = businessSettings.pdfTemplate || 'professional';
      const slh = businessSettings.showLaborHours === true;
      if (businessSettings.pdfTemplate) {
        setSelectedTemplate(businessSettings.pdfTemplate);
      }
      setShowLaborHours(slh);
      setInitialSnapshot(JSON.stringify({ tpl, slh }));
    }
  }, [businessSettings]);

  const isDirty = useMemo(() => {
    if (!initialSnapshot) return false;
    return JSON.stringify({
      tpl: selectedTemplate,
      slh: showLaborHours,
    }) !== initialSnapshot;
  }, [selectedTemplate, showLaborHours, initialSnapshot]);

  const handleSave = async (opts?: { silent?: boolean }): Promise<boolean> => {
    try {
      setIsLoading(true);
      await setBusinessSettings({
        ...businessSettings!,
        pdfTemplate: selectedTemplate,
        showLaborHours,
      });
      setInitialSnapshot(JSON.stringify({
        tpl: selectedTemplate,
        slh: showLaborHours,
      }));
      if (!opts?.silent) setShowSuccessModal(true);
      return true;
    } catch (error) {
      setShowErrorModal(true);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const { unsavedModalProps } = useUnsavedChangesGuard({
    isDirty,
    onSave: () => handleSave({ silent: true }),
  });

  /**
   * Preview a real sample quote through the REAL PDF builder.
   *
   * This used to be ~170 lines of hand-written HTML mirroring
   * buildQuotePdfHtml, and it had already drifted: "Labor" instead of
   * "Labour", a stale header layout, its own copy of the summary arithmetic.
   * A preview that lies is worse than no preview — the tradie picks a
   * template based on it. Now the only thing this screen owns is the sample
   * data; every byte of markup comes from the same function that renders the
   * document the customer receives.
   */
  const handlePreviewPDF = useCallback(async (templateId: PdfTemplateId) => {
    setPreviewLoading(templateId);
    try {
      const logoHtml = await prepareLogoHtml(businessSettings, isPro);
      const html = buildQuotePdfHtml(
        buildSampleQuote({
          showMarkup,
          priceDetail,
          showLaborHours,
          pricesIncludeGst: businessSettings?.pricesIncludeGst === true,
          gstRegistered: businessSettings?.gstRegistered !== false,
          terms: businessSettings?.termsAndConditions,
        }),
        {
          businessName: businessSettings?.businessName || 'Your Business',
          email: businessSettings?.email || 'info@example.com',
          phone: businessSettings?.phone || '0400 000 000',
          website: businessSettings?.website,
          abn: businessSettings?.abn || '12 345 678 901',
          address: businessSettings?.address,
          logoHtml,
          brandColor: businessSettings?.brandColor,
          pdfTemplate: templateId,
        },
      );

      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.document.title = 'PDF Preview';
          printWindow.onload = () => {
            printWindow.focus();
            printWindow.print();
          };
        }
      } else {
        await Print.printAsync({ html });
      }
    } catch (error) {
    } finally {
      setPreviewLoading(null);
    }
  }, [businessSettings, showLaborHours, showMarkup, priceDetail, isPro]);

  const businessName = businessSettings?.businessName || 'Your Business';

  return (
    <View style={styles.container}>
      <GridBackground />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WebContainer>
          <Text style={styles.helperText}>
            Choose a style for your PDF quotes and invoices
          </Text>

          {PDF_TEMPLATES.map((template) => {
            const isSelected = selectedTemplate === template.id;
            const isPreviewing = previewLoading === template.id;
            const isLocked = !isPro && template.id !== 'professional';
            return (
              <TouchableOpacity
                key={template.id}
                activeOpacity={0.9}
                onPress={() => {
                  if (isLocked) {
                    navigation.navigate('Paywall' as never, { source: 'pdf_template' } as never);
                    return;
                  }
                  setSelectedTemplate(template.id);
                }}
              >
                <Surface style={[
                  styles.card,
                  isSelected && styles.cardSelected,
                  isLocked && styles.cardLocked,
                ]}>
                  {/* Template name + radio at top */}
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderLeft}>
                      {isLocked ? (
                        <MaterialCommunityIcons name="lock-outline" size={24} color={themeColors.textMuted} />
                      ) : isSelected ? (
                        <MaterialCommunityIcons name="check-circle" size={24} color={themeColors.accentText} />
                      ) : (
                        <MaterialCommunityIcons name="circle-outline" size={24} color={themeColors.textMuted} />
                      )}
                      <View style={styles.cardHeaderText}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={styles.templateName}>{template.name}</Text>
                          {isLocked && <ProBadge size="small" />}
                        </View>
                        <Text style={styles.templateDescription}>{template.description}</Text>
                      </View>
                    </View>
                  </View>

                  {/* Large preview */}
                  <View style={styles.previewWrapper}>
                    <TemplatePreview templateId={template.id} businessName={businessName} brandColor={businessSettings?.brandColor} gstMode={resolveGstMode(businessSettings ?? {})} />
                  </View>

                  {/* Preview PDF button */}
                  <TouchableOpacity
                    style={styles.previewButton}
                    onPress={() => handlePreviewPDF(template.id)}
                    disabled={isPreviewing}
                    activeOpacity={0.6}
                  >
                    <MaterialCommunityIcons
                      name={isPreviewing ? 'loading' : 'eye-outline'}
                      size={16}
                      color={themeColors.accentText}
                    />
                    <Text style={styles.previewButtonText}>
                      {isPreviewing ? 'Generating...' : 'Preview Full PDF'}
                    </Text>
                  </TouchableOpacity>
                </Surface>
              </TouchableOpacity>
            );
          })}

          <Surface style={styles.toggleCard}>
            <Title style={styles.toggleSectionTitle}>Display Options</Title>

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={styles.toggleTitle}>Show Labor Hours</Text>
                <Text style={styles.toggleSubtitle}>Display hourly rate and hours breakdown on PDFs</Text>
              </View>
              <Switch
                value={showLaborHours}
                onValueChange={setShowLaborHours}
                trackColor={{ false: '#D1D5DB', true: themeColors.accentSubtle }}
                thumbColor={showLaborHours ? themeColors.accent : '#F3F4F6'}
              />
            </View>
          </Surface>
        </WebContainer>
      </ScrollView>

      <FixedBottomButton
        mode="contained"
        label="Save"
        onPress={() => handleSave()}
        disabled={isLoading}
        loading={isLoading}
      />

      <AlertModal
        visible={showSuccessModal}
        onDismiss={() => setShowSuccessModal(false)}
        type="success"
        title="Saved!"
        message="Your PDF template has been updated."
      />

      <AlertModal
        visible={showErrorModal}
        onDismiss={() => setShowErrorModal(false)}
        type="error"
        title="Save Failed"
        message="Failed to save template. Please try again."
      />

      <AlertModal {...unsavedModalProps} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  helperText: {
    fontSize: 14,
    color: t.colors.textSecondary,
    marginBottom: 16,
  },
  card: {
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  cardSelected: {
    borderColor: t.colors.accent,
  },
  cardLocked: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
  },
  cardHeaderText: {
    marginLeft: 12,
    flex: 1,
  },
  templateName: {
    fontSize: 17,
    fontWeight: '700',
    color: t.colors.text,
    marginBottom: 2,
  },
  templateDescription: {
    fontSize: 13,
    color: t.colors.textSecondary,
    lineHeight: 18,
  },
  previewWrapper: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  previewContainer: {
    borderRadius: 6,
    overflow: 'hidden',
    // Shadow for the "page"
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
      default: {},
    }),
  },
  previewPage: {
    flex: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  prevHeader: {},
  prevBusinessName: {
    fontWeight: '700',
  },
  prevSectionHeading: {
    marginBottom: 2,
  },
  prevTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  prevSummary: {},
  fontBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  fontBadgeText: {
    fontSize: 7,
    fontWeight: '600',
  },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    gap: 6,
  },
  previewButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.accentText,
  },
  toggleCard: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
  },
  toggleSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    flex: 1,
    marginRight: 16,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
    marginBottom: 2,
  },
  toggleSubtitle: {
    fontSize: 13,
    color: t.colors.textSecondary,
  },
  toggleDivider: {
    height: 1,
    backgroundColor: t.colors.border,
    marginVertical: 14,
  },
}));
