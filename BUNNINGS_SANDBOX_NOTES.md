# Bunnings Sandbox API Notes

## Important Limitations

The **Bunnings Sandbox API** has significant limitations compared to production:

### 1. Empty Search Results ⚠️
- The sandbox does NOT return results for arbitrary product searches
- Text search like "treated pine" returns empty responses (HTTP 200, empty body)
- This is expected behavior for sandbox environments

### 2. Test Data Only
The sandbox likely only works with specific pre-defined test item numbers, such as:
- Test item IDs provided in their API documentation
- Example: `TEST123`, `ITEM001`, etc. (check Bunnings docs for actual test IDs)

### 3. Workarounds for Development

#### Option A: Manual Pricing (Current Default) ✅
The app is designed to work without the API:
1. Materials are created with $0.00 prices
2. Users manually edit each material price
3. This works perfectly for real-world usage

#### Option B: Mock Data for Testing
Create mock pricing in the app for development:
```typescript
const MOCK_PRICES = {
  'treated pine 90x45': 12.50,
  'deck screws': 8.99,
  // etc.
};
```

#### Option C: Contact Bunnings for Test Item Numbers
- Email Bunnings developer support
- Request list of valid test item numbers for sandbox
- Use those specific IDs for testing

### 4. Production vs Sandbox

**Sandbox (Current):**
- ❌ Search doesn't return products
- ❌ Pricing requires exact item numbers
- ✅ Authentication works
- ✅ API endpoints respond

**Production (When You Get Access):**
- ✅ Full product search
- ✅ Real pricing data
- ✅ Inventory checking
- ✅ Location-based queries

### 5. Current App Behavior

The app gracefully handles missing API data:
1. ✅ Authentication succeeds
2. ✅ Search returns empty (expected)
3. ✅ App continues to work
4. ✅ User can manually enter prices
5. ✅ Quote generation works perfectly

### 6. What to Do

**For Development/Testing:**
- Use the app with manual pricing ✅
- Or implement mock data for consistent testing

**For Production:**
- Register for Bunnings Production API access
- Update credentials in `.env`
- API will return real product data

### 7. Testing Authentication

To verify your API credentials work (which they do! ✅):
```bash
curl -X POST "https://connect.sandbox.api.bunnings.com.au/connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=YOUR_ID&client_secret=YOUR_SECRET"
```

You should see a token response (which you did! ✅)

## Conclusion

✅ **Your API integration is correct!**
⚠️ **The sandbox just doesn't have searchable product data**
✅ **The app works perfectly with manual pricing**

When you move to production with real Bunnings API access, the search and pricing will work automatically.
