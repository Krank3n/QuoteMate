/**
 * Travel Calculator Utility
 * Geocoding, distance calculation, and travel adjustment suggestions
 */

export const DEFAULT_FUEL_PRICE = 1.85; // AUD per litre
export const DEFAULT_FUEL_CONSUMPTION = 12; // L per 100km (typical ute/van)

interface GeoLocation {
  lat: number;
  lng: number;
}

export interface TravelAdjustmentResult {
  distance: number; // km
  suggestedMarkup: number; // percentage
  estimatedFuelCost: number; // AUD
}

/**
 * Geocode an address using Nominatim (OpenStreetMap) free API
 */
export async function geocodeAddress(address: string): Promise<GeoLocation | null> {
  try {
    const query = `${address}, Australia`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'QuoteMate/1.0 (thomas.andrew.hansen@gmail.com)',
      },
    });

    if (!response.ok) {
      console.warn('[travel] Nominatim HTTP error', response.status, response.statusText, 'for', address);
      return null;
    }

    const results = await response.json();
    if (!results || results.length === 0) {
      console.warn('[travel] Nominatim returned no results for', address);
      return null;
    }

    return {
      lat: parseFloat(results[0].lat),
      lng: parseFloat(results[0].lon),
    };
  } catch (err) {
    console.warn('[travel] geocodeAddress threw for', address, err);
    return null;
  }
}

/**
 * Calculate straight-line distance between two points using haversine formula
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Get suggested markup percentage based on distance bracket
 */
export function getDistanceBracketMarkup(km: number): number {
  if (km < 15) return 0;
  if (km < 30) return 2;
  if (km < 50) return 3;
  if (km < 80) return 5;
  return 7;
}

/**
 * Estimate round-trip fuel cost
 */
export function estimateFuelCost(
  distanceKm: number,
  fuelConsumption: number = DEFAULT_FUEL_CONSUMPTION,
  fuelPrice: number = DEFAULT_FUEL_PRICE
): number {
  return Math.round(((distanceKm * 2) / 100) * fuelConsumption * fuelPrice * 100) / 100;
}

/**
 * Calculate travel adjustment by geocoding both addresses and computing distance
 */
export async function calculateTravelAdjustment(
  businessAddress: string,
  jobAddress: string
): Promise<TravelAdjustmentResult | null> {
  const businessLocation = await geocodeAddress(businessAddress);
  if (!businessLocation) {
    console.warn('[travel] business address could not be geocoded:', businessAddress);
    return null;
  }

  await new Promise((resolve) => setTimeout(resolve, 1100));

  const jobLocation = await geocodeAddress(jobAddress);
  if (!jobLocation) {
    console.warn('[travel] job address could not be geocoded:', jobAddress);
    return null;
  }

  const distance = haversineDistance(
    businessLocation.lat,
    businessLocation.lng,
    jobLocation.lat,
    jobLocation.lng
  );

  const roundedDistance = Math.round(distance);
  const suggestedMarkup = getDistanceBracketMarkup(roundedDistance);
  const estimatedFuel = estimateFuelCost(roundedDistance);

  return {
    distance: roundedDistance,
    suggestedMarkup,
    estimatedFuelCost: estimatedFuel,
  };
}
