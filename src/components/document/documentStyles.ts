import { StyleSheet, Platform } from 'react-native';
import { makeStyles } from '../../theme';

export const useDocumentStyles = makeStyles((t) => ({
  section: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
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
  // Archivo tokens deliberately carry NO fontWeight — Android ignores it when
  // a custom fontFamily is set and silently renders Regular.
  sectionTitle: {
    fontSize: 15,
    fontFamily: 'Archivo-Bold',
    marginBottom: 0,
    lineHeight: 20,
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 14,
    marginBottom: 4,
    color: t.colors.text,
  },
  subtext: {
    fontSize: 13,
    color: t.colors.textMuted,
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
    fontFamily: 'Archivo-SemiBold',
    marginBottom: 2,
    color: t.colors.text,
  },
  itemDetails: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  itemTotal: {
    fontSize: 14,
    fontFamily: 'Archivo-Bold',
    color: t.colors.text,
    fontVariant: ['tabular-nums'],
  },
  divider: {
    marginVertical: 12,
    backgroundColor: t.colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: t.colors.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    fontFamily: 'Archivo-SemiBold',
    color: t.colors.text,
    fontVariant: ['tabular-nums'],
  },
  totalSection: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
    borderLeftWidth: 3,
    borderLeftColor: t.colors.money,
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
    fontFamily: 'Archivo-Bold',
    color: t.colors.text,
    letterSpacing: 1,
  },
  totalValue: {
    fontSize: 26,
    fontFamily: 'Archivo-ExtraBold',
    color: t.colors.money,
    fontVariant: ['tabular-nums'],
  },
}));
