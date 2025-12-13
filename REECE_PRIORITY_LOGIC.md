# Reece API Priority Logic

## Overview

When Reece API is enabled, it becomes the **PRIORITY** pricing source and **Bunnings scraper is completely bypassed**.

## Priority Order

### When Reece API is Enabled (`useReeceApi = true`)

```
1. ⭐ REECE API (Priority)
   ├─ Success → Return Reece results
   └─ No results/Error → Skip to step 4

2. 🚫 BUNNINGS SCRAPER (SKIPPED)
   └─ Completely bypassed when Reece is enabled

3. 🚫 WEB SCRAPING (SKIPPED)
   └─ Skipped to avoid duplicate/conflicting data

4. 🤖 AI ESTIMATION (Last resort)
   └─ Only if Reece returns no results
```

### When Reece API is Disabled (`useReeceApi = false`)

```
1. 🔧 BUNNINGS SCRAPER (If Bunnings selected)
   ├─ Success → Return Bunnings results
   └─ No results/Error → Go to step 2

2. 🌐 WEB SCRAPING
   ├─ Success → Return scraped results
   └─ No results/Error → Go to step 3

3. 🤖 AI ESTIMATION (Last resort)
   └─ Estimated pricing
```

## Implementation

### New File: `unifiedPricingService.ts`

Created a unified pricing service that handles all pricing logic in one place:

```typescript
export async function searchMaterialPricing(
  searchQuery: string,
  options: UnifiedPricingOptions
): Promise<UnifiedProductResult[]>
```

### Priority Logic

```typescript
// PRIORITY 1: Reece API (if enabled)
if (useReeceApi || selectedStore === 'reece') {
  // Use Reece API
  // Skip Bunnings entirely
  return reeceResults;
}

// PRIORITY 2: Bunnings (only if Reece NOT enabled)
if (isBunnings && !useReeceApi) {
  return bunningsResults;
}

// PRIORITY 3: Web scraping
return webScrapingResults;

// PRIORITY 4: AI estimation
return aiEstimation;
```

## Key Changes

### File Modified

**`src/screens/NewQuote/AddMaterialScreen.tsx`**

#### Old Logic
```typescript
// Old: Complex nested if statements
// - Checked Bunnings first
// - Multiple fallbacks
// - No Reece integration
if (isBunnings && useScraperApi) {
  // Bunnings logic
} else if (isBunnings) {
  // Bunnings API
} else {
  // Other stores
}
```

#### New Logic
```typescript
// New: Simple unified call
const results = await searchMaterialPricing(searchQuery, {
  useReeceApi,        // Automatically prioritized
  selectedStore,
  hardwareStores,
  quantity: 1,
  unit: 'each',
});
```

### File Created

**`src/services/unifiedPricingService.ts`** (350+ lines)

Features:
- ✅ Centralized pricing logic
- ✅ Reece API priority
- ✅ Bunnings bypassed when Reece enabled
- ✅ Automatic fallbacks
- ✅ Source tracking
- ✅ Confidence scoring
- ✅ Best result selection

## Behavior Examples

### Example 1: Reece Enabled

```
User Settings:
- useReeceApi: true
- selectedStore: 'reece'

Search for: "copper pipe 15mm"

Flow:
1. ⭐ Search Reece API
   → Found 15 products
   → Return Reece results

2. 🚫 Bunnings scraper NOT called
3. 🚫 Web scraping NOT called
4. 🚫 AI estimation NOT called

Result: User sees Reece products only
```

### Example 2: Reece Enabled but No Results

```
User Settings:
- useReeceApi: true
- selectedStore: 'reece'

Search for: "obscure specialty item"

Flow:
1. ⭐ Search Reece API
   → No results found

2. 🚫 Bunnings scraper NOT called
3. 🚫 Web scraping NOT called

4. 🤖 AI estimation
   → Estimate: $45.00
   → Return AI estimate

Result: User sees AI estimated price
```

### Example 3: Bunnings Only (Reece Disabled)

```
User Settings:
- useReeceApi: false
- selectedStore: 'bunnings'

Search for: "timber 90x45"

Flow:
1. 🚫 Reece API NOT called (disabled)

2. 🔧 Search Bunnings scraper
   → Found 8 products
   → Return Bunnings results

3. 🚫 Web scraping NOT called (Bunnings succeeded)
4. 🚫 AI estimation NOT called

Result: User sees Bunnings products
```

### Example 4: Both Enabled (Reece Takes Priority)

```
User Settings:
- useReeceApi: true
- selectedStore: 'bunnings' (ignored)

Search for: "PVC pipe"

Flow:
1. ⭐ Search Reece API (Priority)
   → Found 20 products
   → Return Reece results

2. 🚫 Bunnings scraper NOT called
   (Even though selectedStore is 'bunnings')

Result: Reece products shown, not Bunnings
```

## User Experience

### Settings Screen

When user enables Reece:
- ✅ Reece becomes priority
- ✅ Bunnings is automatically bypassed
- ✅ Info box explains this clearly

### Search Results

Users will see:
- 🔵 "Reece API" badge for Reece products
- 🟢 "Bunnings (Real-time)" badge for Bunnings (only if Reece disabled)
- 🟡 "Web Search" for scraped results
- 🤖 "AI Estimate" for AI pricing

### Console Logs

Clear logging shows priority:
```
🔍 Search settings: { useReeceApi: true, selectedStore: 'bunnings' }
⭐ PRIORITY: Using Reece API (Bunnings scraper disabled)
✅ Reece API returned 15 results
✅ Search complete: 15 results
```

## Benefits

### For Users

1. **Accurate Plumbing Prices**
   - Real Reece pricing
   - No Bunnings confusion
   - Clear source indication

2. **No Conflicts**
   - One source at a time
   - No mixed results
   - Clear priority

3. **Performance**
   - Skip unnecessary searches
   - Faster results
   - Less API calls

### For Developers

1. **Clean Code**
   - Single function call
   - No nested ifs
   - Easy to maintain

2. **Centralized Logic**
   - All pricing in one place
   - Easy to modify
   - Clear priority rules

3. **Type Safety**
   - Unified result type
   - Source tracking
   - Full TypeScript support

## Testing

### Test Scenarios

1. ✅ **Enable Reece → Search → Verify Reece results**
   - No Bunnings results
   - Reece badge shown
   - Correct prices

2. ✅ **Disable Reece → Search → Verify Bunnings results**
   - Bunnings works normally
   - No Reece results
   - Bunnings badge shown

3. ✅ **Enable Reece → Reece fails → Verify fallback**
   - Falls to AI estimation
   - No Bunnings attempted
   - AI badge shown

4. ✅ **Settings persist → Reload → Verify priority**
   - Reece setting remembered
   - Priority maintained
   - Correct source used

### Console Output

Expected logs when Reece is enabled:
```
🔍 Unified pricing search: { searchQuery: 'copper', useReeceApi: true }
⭐ PRIORITY: Using Reece API (Bunnings scraper disabled)
🔍 Searching Reece API for: copper
✅ Found 15 Reece products
✅ Reece API returned 15 results
✅ Search complete: 15 results
```

## Migration Notes

### Old Code
- Complex nested if/else
- Multiple service calls
- Hard to maintain
- No Reece support

### New Code
- Single function call
- Centralized logic
- Easy to extend
- Reece priority built-in

### Backwards Compatible
- ✅ Bunnings still works (when Reece disabled)
- ✅ Web scraping still works
- ✅ AI estimation still works
- ✅ No breaking changes

## Configuration

### Enable Reece Priority

1. **In Settings**
   ```typescript
   businessSettings.useReeceApi = true;
   ```

2. **In Code**
   ```typescript
   const results = await searchMaterialPricing(searchQuery, {
     useReeceApi: true,  // This enables priority
     selectedStore: 'reece',
     // other options...
   });
   ```

3. **Environment**
   ```env
   REECE_CLIENT_ID=your_client_id
   REECE_CLIENT_SECRET=your_secret
   REECE_USE_TEST_ENV=true
   ```

## Summary

✅ **Reece API Priority**: When enabled, Reece is always used first
✅ **Bunnings Bypassed**: Bunnings scraper is skipped when Reece is on
✅ **Clean Logic**: Centralized in `unifiedPricingService.ts`
✅ **Type Safe**: Full TypeScript support
✅ **Backwards Compatible**: Old functionality preserved
✅ **User Friendly**: Clear indicators and badges
✅ **Developer Friendly**: Simple API, easy to maintain

The pricing system now intelligently prioritizes Reece API when enabled, providing accurate plumbing supply pricing without conflicts from Bunnings!

---

**Status**: ✅ Complete and Tested
**Files Modified**: 1
**Files Created**: 1
**Priority Logic**: Implemented
**Backwards Compatible**: Yes
**Last Updated**: 2024-11-24
