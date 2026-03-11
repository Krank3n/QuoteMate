import { StyleSheet } from 'react-native';
import { colors } from '../../theme';

export const documentStyles = StyleSheet.create({
  section: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  text: {
    fontSize: 14,
    marginBottom: 4,
  },
  subtext: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 2,
  },
  input: {
    marginBottom: 8,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  itemDetails: {
    fontSize: 12,
    color: colors.onSurface,
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    marginVertical: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalSection: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
});
