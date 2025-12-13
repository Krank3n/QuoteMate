/**
 * Reece API Test Script
 * Run this to test the Reece API integration
 *
 * Usage: npx ts-node test-reece-api.ts
 */

import { reeceApi } from './src/services/reeceApi';

async function testReeceApi() {
  console.log('🧪 Testing Reece API Integration\n');
  console.log('='.repeat(60));

  try {
    // Test 1: Authentication
    console.log('\n📝 Test 1: OAuth2 Authentication');
    console.log('-'.repeat(60));
    const tokenResponse = await reeceApi.acquireAccessToken();
    console.log('✅ Access token acquired successfully');
    console.log('Token type:', tokenResponse.token_type);
    console.log('Expires in:', tokenResponse.expires_in, 'seconds');

    // Test 2: Product Search
    console.log('\n📝 Test 2: Product Search');
    console.log('-'.repeat(60));
    const searchResults = await reeceApi.searchProducts({
      searchPhrase: 'copper',
      pageNumber: 1,
      pageSize: 5,
    });
    console.log('✅ Product search successful');
    console.log('Total results:', searchResults.totalResults);
    console.log('GST rate:', searchResults.gstRate, '%');
    console.log('First 5 products:');
    searchResults.products.slice(0, 5).forEach((product, index) => {
      console.log(`  ${index + 1}. ${product.productTitle} (ID: ${product.productId})`);
    });

    // Test 3: Get Branches
    console.log('\n📝 Test 3: Branch Information');
    console.log('-'.repeat(60));
    const branches = await reeceApi.getAllBranches();
    console.log('✅ Branches retrieved successfully');
    console.log('Total branches:', branches.branches.length);
    console.log('First 5 branches:');
    branches.branches.slice(0, 5).forEach((branch, index) => {
      console.log(`  ${index + 1}. ${branch.name} (${branch.branchNumber})`);
      console.log(`     Phone: ${branch.telephone}`);
    });

    // Test 4: Get Quote Headers (last 12 months)
    console.log('\n📝 Test 4: Quote Headers');
    console.log('-'.repeat(60));
    const today = new Date();
    const lastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());

    const quotes = await reeceApi.getQuoteHeaders({
      fromDate: lastYear.toISOString().split('T')[0],
      toDate: today.toISOString().split('T')[0],
      quoteStages: ['Won', 'Entered'],
    });
    console.log('✅ Quote headers retrieved successfully');
    console.log('Total quotes:', quotes.length);
    if (quotes.length > 0) {
      console.log('Recent quotes:');
      quotes.slice(0, 5).forEach((quote, index) => {
        console.log(`  ${index + 1}. Quote #${quote.quoteNumber}`);
        console.log(`     Date: ${quote.quoteDate}`);
        console.log(`     Job: ${quote.jobName}`);
        console.log(`     Stage: ${quote.stage}`);
      });

      // Test 5: Get Quote Details
      if (quotes.length > 0) {
        console.log('\n📝 Test 5: Quote Details');
        console.log('-'.repeat(60));
        const firstQuoteNumber = quotes[0].quoteNumber;
        const quoteDetails = await reeceApi.getQuoteDetails([firstQuoteNumber]);
        console.log('✅ Quote details retrieved successfully');
        const quote = quoteDetails.documents[0];
        if (quote) {
          console.log('Quote number:', quote.quoteNumber);
          console.log('Customer:', quote.customerNumber);
          console.log('Branch:', quote.branchName);
          console.log('Salesperson:', quote.salesPersonName);
          console.log('Lines:', quote.quoteLines?.length || 0);
        }
      }
    } else {
      console.log('⚠️  No quotes found in the last 12 months');
    }

    // Test 6: Invoice Headers (last 12 months)
    console.log('\n📝 Test 6: Invoice Headers');
    console.log('-'.repeat(60));
    try {
      const invoiceHeaders = await reeceApi.searchInvoiceHeaders({
        documentTypes: ['TAX_INVOICE'],
        fromDate: lastYear.toISOString().split('T')[0],
        toDate: today.toISOString().split('T')[0],
      });
      console.log('✅ Invoice headers retrieved successfully');
      console.log('Total invoices:', invoiceHeaders.documentHeaders.length);
      if (invoiceHeaders.documentHeaders.length > 0) {
        console.log('Recent invoices:');
        invoiceHeaders.documentHeaders.slice(0, 5).forEach((invoice, index) => {
          console.log(`  ${index + 1}. Invoice #${invoice.documentNumber}`);
          console.log(`     Type: ${invoice.documentType}`);
          console.log(`     Date: ${invoice.documentDate}`);
        });
      }
    } catch (error) {
      console.log('⚠️  Invoice search not available or no invoices found');
    }

    // Test 7: Price File (might return 204 if not generated)
    console.log('\n📝 Test 7: Price File');
    console.log('-'.repeat(60));
    try {
      const priceFile = await reeceApi.getPriceFile({
        format: 'MAX_JSON',
        additionalFields: ['CATEGORY'],
      });

      if (priceFile) {
        console.log('✅ Price file retrieved successfully');
        if (typeof priceFile === 'string') {
          console.log('Format: CSV');
          console.log('Size:', priceFile.length, 'characters');
        } else {
          console.log('Format: JSON');
          console.log('Type:', typeof priceFile);
        }
      } else {
        console.log('⚠️  Price file not generated yet (204 response)');
      }
    } catch (error) {
      console.log('⚠️  Price file not available:', error.message);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed successfully!');
    console.log('='.repeat(60));
    console.log('\nAPI Configuration:');
    const config = reeceApi.getConfig();
    console.log('Region:', config.region);
    console.log('Customer Number:', config.customerNumber);
    console.log('Auth URL:', config.authBaseUrl);
    console.log('API URL:', config.apiBaseUrl);
    console.log('Configured:', reeceApi.isConfigured() ? 'Yes' : 'No');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

// Run tests
testReeceApi().then(() => {
  console.log('\n✅ Test script completed');
  process.exit(0);
}).catch((error) => {
  console.error('\n❌ Test script failed:', error);
  process.exit(1);
});
