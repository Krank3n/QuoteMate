/**
 * PDF Template Settings Screen
 * Choose document style for quotes and invoices
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { ProBadge } from '../../components/ProBadge';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { PDF_TEMPLATES, printMediaCSS, getTemplateCSS, PdfTemplateId, buildTermsHTML } from '../../../shared/pdf';
import { prepareLogoHtml } from '../../utils/pdfGenerator';

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
  return <View style={[{ width: width as any, height, backgroundColor: color, borderRadius: 1 }, style]} />;
}

/** Full-width detailed native document preview */
function TemplatePreview({ templateId, businessName, groupBySection, brandColor, pricesIncludeGst }: { templateId: PdfTemplateId; businessName: string; groupBySection: boolean; brandColor?: string; pricesIncludeGst: boolean }) {
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
          {(pricesIncludeGst
            ? [
                { label: 'Subtotal', value: '$1,217.90' },
                { label: 'Includes GST', value: '$110.72' },
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
            <Text style={{ color: c.accentColor, fontSize: 7 * scale, fontWeight: '800', ...font }}>$1,217.90</Text>
          </View>
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
  const navigation = useNavigation<any>();
  const { businessSettings, setBusinessSettings, subscriptionStatus } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplateId>('professional');
  const [showLaborHours, setShowLaborHours] = useState(false);
  const [showMarkup, setShowMarkup] = useState(true);
  const [groupMaterialsBySection, setGroupMaterialsBySection] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState<PdfTemplateId | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const initialSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    if (businessSettings) {
      const tpl = businessSettings.pdfTemplate || 'professional';
      const slh = businessSettings.showLaborHours === true;
      const sm = businessSettings.showMarkup !== false;
      const gm = businessSettings.groupMaterialsBySection === true;
      if (businessSettings.pdfTemplate) {
        setSelectedTemplate(businessSettings.pdfTemplate);
      }
      setShowLaborHours(slh);
      setShowMarkup(sm);
      setGroupMaterialsBySection(gm);
      initialSnapshotRef.current = JSON.stringify({ tpl, slh, sm, gm });
    }
  }, [businessSettings]);

  const isDirty = useMemo(() => {
    if (!initialSnapshotRef.current) return false;
    return JSON.stringify({
      tpl: selectedTemplate,
      slh: showLaborHours,
      sm: showMarkup,
      gm: groupMaterialsBySection,
    }) !== initialSnapshotRef.current;
  }, [selectedTemplate, showLaborHours, showMarkup, groupMaterialsBySection]);

  const handleSave = async (opts?: { silent?: boolean }): Promise<boolean> => {
    try {
      setIsLoading(true);
      await setBusinessSettings({
        ...businessSettings!,
        pdfTemplate: selectedTemplate,
        showLaborHours,
        showMarkup,
        groupMaterialsBySection,
      });
      initialSnapshotRef.current = JSON.stringify({
        tpl: selectedTemplate,
        slh: showLaborHours,
        sm: showMarkup,
        gm: groupMaterialsBySection,
      });
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

  /** Generate a real sample PDF and show it via the system print preview */
  const handlePreviewPDF = useCallback(async (templateId: PdfTemplateId) => {
    setPreviewLoading(templateId);
    try {
      const business = businessSettings || {
        businessName: 'Your Business',
        email: 'info@example.com',
        phone: '0400 000 000',
        abn: '12 345 678 901',
      };

      const css = getTemplateCSS(templateId, businessSettings?.brandColor);
      const logoHtml = await prepareLogoHtml(businessSettings, isPro);
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>${printMediaCSS} ${css}</style>
        </head>
        <body>
          <div class="content-wrapper">
          <div class="header">
            <div class="header-content">
              ${logoHtml}
              <div class="header-text">
                <h1>${business.businessName || 'Your Business'}</h1>
                <p>
                  ${business.abn ? `ABN: ${business.abn}<br>` : ''}
                  ${business.email ? `Email: ${business.email}<br>` : ''}
                  ${business.phone ? `Phone: ${business.phone}` : ''}
                </p>
              </div>
            </div>
          </div>

          <div class="info-section">
            <h2>QUOTATION</h2>
            <p><strong>Quote #:</strong> Q-001</p>
            <p><strong>Quote Date:</strong> 10 March 2026</p>
            <p><strong>Customer:</strong> Sarah Johnson</p>
            <p><strong>Email:</strong> sarah@example.com</p>
            <p><strong>Job Address:</strong> 42 Banksia Drive, Melbourne VIC 3000</p>
          </div>

          <div class="info-section">
            <h3>Job Details</h3>
            <p><strong>Rear Deck Build</strong></p>
            <p>Build a 6m x 4m hardwood deck with steps and railing to the rear of property.</p>
          </div>

          <div class="section-wrapper">
            <h3>Materials</h3>
            ${groupMaterialsBySection ? `
            <table>
              <thead>
                <tr><th colspan="4" class="section-label">Framing</th></tr>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Treated Pine Joists 90x45mm</td><td>18 each</td><td>$28.00</td><td>$504.00</td></tr>
                <tr><td>Concrete Pier Blocks</td><td>12 each</td><td>$14.95</td><td>$179.40</td></tr>
                <tr class="total-row"><td colspan="3">Framing Subtotal</td><td>$683.40</td></tr>
              </tbody>
            </table>
            <table>
              <thead>
                <tr><th colspan="4" class="section-label">Decking</th></tr>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Merbau Decking 90x19mm</td><td>48 m</td><td>$12.50</td><td>$600.00</td></tr>
                <tr><td>Stainless Steel Deck Screws</td><td>3 box</td><td>$24.95</td><td>$74.85</td></tr>
                <tr class="total-row"><td colspan="3">Decking Subtotal</td><td>$674.85</td></tr>
              </tbody>
            </table>
            <table>
              <thead>
                <tr><th colspan="4" class="section-label">Finishing</th></tr>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Deck Stain - Natural</td><td>4 L</td><td>$42.00</td><td>$168.00</td></tr>
                <tr class="total-row"><td colspan="3">Finishing Subtotal</td><td>$168.00</td></tr>
              </tbody>
            </table>
            <table>
              <tbody>
                <tr class="total-row"><td colspan="3"><strong>All Materials Subtotal</strong></td><td><strong>$1,526.25</strong></td></tr>
              </tbody>
            </table>
            ` : `
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Merbau Decking 90x19mm</td><td>48 m</td><td>$12.50</td><td>$600.00</td></tr>
                <tr><td>Treated Pine Joists 90x45mm</td><td>18 each</td><td>$28.00</td><td>$504.00</td></tr>
                <tr><td>Concrete Pier Blocks</td><td>12 each</td><td>$14.95</td><td>$179.40</td></tr>
                <tr><td>Stainless Steel Deck Screws</td><td>3 box</td><td>$24.95</td><td>$74.85</td></tr>
                <tr><td>Deck Stain - Natural</td><td>4 L</td><td>$42.00</td><td>$168.00</td></tr>
                <tr class="total-row"><td colspan="3">Materials Subtotal</td><td>$1,526.25</td></tr>
              </tbody>
            </table>
            `}
          </div>

          <div class="section-wrapper">
            <h3>Labor</h3>
            <table>
              <tbody>
                <tr>
                  <td>${showLaborHours ? 'Labor (16 hours @ $85.00/hr)' : 'Labor'}</td>
                  <td style="text-align: right;">$1,360.00</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="summary">
            <div class="summary-row"><span>Materials Subtotal</span><span>$1,526.25</span></div>
            <div class="summary-row"><span>Labor</span><span>$1,360.00</span></div>
            ${businessSettings?.pricesIncludeGst === true
              ? `<div class="summary-row"><span>Subtotal</span><span>$2,886.25</span></div>
                ${showMarkup ? `<div class="summary-row"><span>Markup (15%)</span><span>$432.94</span></div>` : ''}
                <div class="summary-row"><span>Includes GST</span><span>$301.74</span></div>
                <hr>
                <div class="summary-row grand-total"><span>TOTAL</span><span>$3,319.19</span></div>`
              : `<div class="summary-row"><span>Subtotal (ex GST)</span><span>$2,886.25</span></div>
                ${showMarkup ? `<div class="summary-row"><span>Markup (15%)</span><span>$432.94</span></div>` : ''}
                <div class="summary-row"><span>GST (10%)</span><span>$331.92</span></div>
                <hr>
                <div class="summary-row grand-total"><span>TOTAL</span><span>$3,651.11</span></div>`
            }
          </div>

          <div class="info-section"><h3>Notes</h3><p>All timber will be treated and stained. Work includes cleanup and disposal of waste materials. Deck will comply with local council regulations.</p></div>

          <div style="margin-top: 40px; font-size: 12px; color: #666666;">
            <p>This quote is valid for 30 days from the date of issue.</p>
          </div>

          ${buildTermsHTML(businessSettings?.termsAndConditions)}
          </div>

          <div class="pdf-footer">
            <p>Powered by QuoteMate | quotemateapp.au</p>
          </div>
        </body>
        </html>
      `;

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
  }, [businessSettings, showLaborHours, showMarkup, groupMaterialsBySection, isPro]);

  const businessName = businessSettings?.businessName || 'Your Business';

  return (
    <View style={styles.container}>
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
                    navigation.navigate('Paywall' as never);
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
                        <MaterialCommunityIcons name="lock-outline" size={24} color={colors.textMuted} />
                      ) : isSelected ? (
                        <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
                      ) : (
                        <MaterialCommunityIcons name="circle-outline" size={24} color={colors.onSurface + '60'} />
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
                    <TemplatePreview templateId={template.id} businessName={businessName} groupBySection={groupMaterialsBySection} brandColor={businessSettings?.brandColor} pricesIncludeGst={businessSettings?.pricesIncludeGst === true} />
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
                      color={colors.primary}
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
                trackColor={{ false: '#D1D5DB', true: colors.primary + '60' }}
                thumbColor={showLaborHours ? colors.primary : '#F3F4F6'}
              />
            </View>

            <View style={styles.toggleDivider} />

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={styles.toggleTitle}>Show Markup on Documents</Text>
                <Text style={styles.toggleSubtitle}>Display markup percentage and amount on quotes and invoices</Text>
              </View>
              <Switch
                value={showMarkup}
                onValueChange={setShowMarkup}
                trackColor={{ false: '#D1D5DB', true: colors.primary + '60' }}
                thumbColor={showMarkup ? colors.primary : '#F3F4F6'}
              />
            </View>

            <View style={styles.toggleDivider} />

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={styles.toggleTitle}>Group Materials by Section</Text>
                <Text style={styles.toggleSubtitle}>Organise materials under work section headings</Text>
              </View>
              <Switch
                value={groupMaterialsBySection}
                onValueChange={setGroupMaterialsBySection}
                trackColor={{ false: '#D1D5DB', true: colors.primary + '60' }}
                thumbColor={groupMaterialsBySection ? colors.primary : '#F3F4F6'}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  helperText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 16,
  },
  card: {
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  cardSelected: {
    borderColor: colors.primary,
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
    color: colors.text,
    marginBottom: 2,
  },
  templateDescription: {
    fontSize: 13,
    color: colors.onSurface,
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
    borderTopColor: colors.outline + '25',
    gap: 6,
  },
  previewButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  toggleCard: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
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
    color: colors.text,
    marginBottom: 2,
  },
  toggleSubtitle: {
    fontSize: 13,
    color: colors.onSurface,
  },
  toggleDivider: {
    height: 1,
    backgroundColor: colors.outline + '30',
    marginVertical: 14,
  },
});
