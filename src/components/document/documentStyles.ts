import { StyleSheet, Platform } from 'react-native';
import { colors } from '../../theme';

export const documentStyles = StyleSheet.create({
  section: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 0,
    lineHeight: 20,
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 14,
    marginBottom: 4,
    color: colors.text,
  },
  subtext: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 2,
  },
  input: {
    marginBottom: 8,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingVertical: 4,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
    color: colors.text,
  },
  itemDetails: {
    fontSize: 12,
    color: colors.textMuted,
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  divider: {
    marginVertical: 12,
    backgroundColor: colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: colors.onSurface,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  totalSection: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    overflow: 'hidden',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: 1,
  },
  totalValue: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.primary,
  },
});
