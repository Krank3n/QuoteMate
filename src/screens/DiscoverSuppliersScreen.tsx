import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { makeStyles, useThemeColors } from '../theme';
import type { SupplierPartner } from '../types';
import {
  fetchActiveSuppliers,
  fetchSubscribedSupplierIds,
  subscribeToSupplier,
  unsubscribeFromSupplier,
} from '../services/supplierDiscoveryService';
import { haversineDistance } from '../utils/travelCalculator';
import { useStore } from '../store/useStore';
import { GridBackground } from '../components/GridBackground';

export function DiscoverSuppliersScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const route = useRoute();
  const navigation = useNavigation();
  const [suppliers, setSuppliers] = useState<SupplierPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [subscribedIds, setSubscribedIds] = useState<Set<string>>(new Set());
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Get user location from business settings for distance sorting
  const businessSettings = useStore((s) => s.businessSettings);
  const userLocation = (businessSettings as any)?.location as
    | { lat: number; lng: number }
    | undefined;

  // Pre-select supplier from deep link
  const deepLinkSupplierId = (route.params as any)?.supplier;

  useEffect(() => {
    loadSuppliers();
  }, []);

  useEffect(() => {
    if (deepLinkSupplierId && suppliers.length > 0 && !subscribedIds.has(deepLinkSupplierId)) {
      const supplier = suppliers.find((s) => s.id === deepLinkSupplierId);
      if (supplier) {
        handleSubscribe(supplier);
      }
    }
  }, [deepLinkSupplierId, suppliers]);

  const loadSuppliers = async () => {
    setLoading(true);
    try {
      const [active, subIds] = await Promise.all([
        fetchActiveSuppliers(),
        fetchSubscribedSupplierIds(),
      ]);
      setSuppliers(active);
      setSubscribedIds(subIds);
    } catch (err) {
      console.warn('Failed to load suppliers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = useCallback(
    async (supplier: SupplierPartner) => {
      setTogglingId(supplier.id);
      try {
        await subscribeToSupplier(supplier.id, supplier.name);
        setSubscribedIds((prev) => new Set(prev).add(supplier.id));
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Could not subscribe');
      } finally {
        setTogglingId(null);
      }
    },
    []
  );

  const handleUnsubscribe = useCallback(
    async (supplier: SupplierPartner) => {
      Alert.alert(
        'Unsubscribe',
        `Remove ${supplier.name}'s prices from your saved items?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unsubscribe',
            style: 'destructive',
            onPress: async () => {
              setTogglingId(supplier.id);
              try {
                await unsubscribeFromSupplier(supplier.id, supplier.name);
                setSubscribedIds((prev) => {
                  const next = new Set(prev);
                  next.delete(supplier.id);
                  return next;
                });
              } catch (err: any) {
                Alert.alert('Error', err.message || 'Could not unsubscribe');
              } finally {
                setTogglingId(null);
              }
            },
          },
        ]
      );
    },
    []
  );

  const sortedSuppliers = useMemo(() => {
    let filtered = suppliers;

    // Filter by search
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.address?.toLowerCase().includes(q)
      );
    }

    // Sort by distance if user has location
    if (userLocation) {
      return [...filtered].sort((a, b) => {
        const distA = a.location
          ? haversineDistance(userLocation.lat, userLocation.lng, a.location.lat, a.location.lng)
          : Infinity;
        const distB = b.location
          ? haversineDistance(userLocation.lat, userLocation.lng, b.location.lat, b.location.lng)
          : Infinity;
        return distA - distB;
      });
    }

    // Default: sort by subscriber count descending
    return [...filtered].sort((a, b) => b.subscriberCount - a.subscriberCount);
  }, [suppliers, search, userLocation]);

  const getDistanceLabel = useCallback(
    (supplier: SupplierPartner) => {
      if (!userLocation || !supplier.location) return null;
      const km = haversineDistance(
        userLocation.lat,
        userLocation.lng,
        supplier.location.lat,
        supplier.location.lng
      );
      return km < 1 ? '<1 km' : `${Math.round(km)} km`;
    },
    [userLocation]
  );

  const renderSupplier = useCallback(
    ({ item }: { item: SupplierPartner }) => {
      const isSubscribed = subscribedIds.has(item.id);
      const isToggling = togglingId === item.id;
      const distance = getDistanceLabel(item);

      return (
        <View style={styles.card}>
          <View style={styles.cardBody}>
            <View style={styles.cardInfo}>
              <Text style={styles.supplierName}>{item.name}</Text>
              {item.address && (
                <Text style={styles.supplierAddress} numberOfLines={1}>
                  {item.address}
                </Text>
              )}
              <View style={styles.meta}>
                <View style={styles.metaBadge}>
                  <MaterialCommunityIcons name="package-variant" size={13} color={themeColors.textMuted} />
                  <Text style={styles.metaText}>{item.itemCount} items</Text>
                </View>
                {distance && (
                  <View style={styles.metaBadge}>
                    <MaterialCommunityIcons name="map-marker-distance" size={13} color={themeColors.textMuted} />
                    <Text style={styles.metaText}>{distance}</Text>
                  </View>
                )}
              </View>
            </View>

            <TouchableOpacity
              onPress={() => (isSubscribed ? handleUnsubscribe(item) : handleSubscribe(item))}
              disabled={isToggling}
              style={[
                styles.subButton,
                isSubscribed ? styles.subButtonActive : styles.subButtonInactive,
              ]}
            >
              {isToggling ? (
                <ActivityIndicator size="small" color={isSubscribed ? themeColors.accent : '#fff'} />
              ) : (
                <Text
                  style={[
                    styles.subButtonText,
                    isSubscribed ? styles.subButtonTextActive : {},
                  ]}
                >
                  {isSubscribed ? 'Subscribed' : 'Subscribe'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [subscribedIds, togglingId, handleSubscribe, handleUnsubscribe, getDistanceLabel]
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={themeColors.accentText} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GridBackground />
      <View style={styles.searchContainer}>
        <MaterialCommunityIcons name="magnify" size={20} color={themeColors.textDisabled} style={styles.searchIcon} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search suppliers..."
          placeholderTextColor={themeColors.textDisabled}
          style={styles.searchInput}
        />
      </View>

      <FlatList
        data={sortedSuppliers}
        keyExtractor={(item) => item.id}
        renderItem={renderSupplier}
        contentContainerStyle={styles.list}
        removeClippedSubviews
        initialNumToRender={10}
        maxToRenderPerBatch={6}
        windowSize={7}
        ListEmptyComponent={
          <View style={styles.centered}>
            <MaterialCommunityIcons name="store-search-outline" size={48} color={themeColors.textDisabled} />
            <Text style={styles.emptyText}>
              {search ? 'No suppliers match your search' : 'No supplier partners yet'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 12,
    margin: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: t.colors.text,
    fontSize: 15,
    paddingVertical: 12,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 12,
    marginBottom: 10,
    padding: 16,
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    marginRight: 12,
  },
  supplierName: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.text,
    marginBottom: 3,
  },
  supplierAddress: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginBottom: 6,
  },
  meta: {
    flexDirection: 'row',
    gap: 12,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  subButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  subButtonInactive: {
    backgroundColor: t.colors.accent,
  },
  subButtonActive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: t.colors.accent,
  },
  subButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.onAccent,
  },
  subButtonTextActive: {
    color: t.colors.accentText,
  },
  emptyText: {
    color: t.colors.textMuted,
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
}));
