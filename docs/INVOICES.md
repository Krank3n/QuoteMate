# Invoice System

QuoteMate now includes a full-featured invoice management system that allows you to create, track, and manage invoices for your jobs.

## Overview

The Invoice System is designed to seamlessly integrate with the existing quote workflow. You can:

- Create invoices from scratch
- Convert accepted or sent quotes into invoices
- Track payment status and record payments
- Generate professional PDF invoices
- Share invoices via email, SMS, or WhatsApp

## Invoice Statuses

Invoices can have the following statuses:

| Status | Description |
|--------|-------------|
| `draft` | Invoice is being prepared, not yet sent to customer |
| `sent` | Invoice has been sent to the customer |
| `paid` | Invoice has been fully paid |
| `partial` | Customer has made a partial payment |
| `overdue` | Invoice is past the due date and unpaid |
| `cancelled` | Invoice has been cancelled |

## Creating an Invoice

### From Scratch

1. Navigate to the **Invoices** tab in the bottom navigation
2. Tap the **+ New Invoice** button
3. Follow the invoice creation flow:
   - Enter customer details
   - Add job details and description
   - Add materials (with automatic pricing)
   - Set labor hours and markup
   - Preview and save the invoice

### From a Quote

1. Open an existing quote with status `sent` or `accepted`
2. Tap the **Convert to Invoice** button
3. The quote details will be pre-filled into a new invoice
4. Review and adjust any details as needed
5. Set payment terms and save

## Payment Terms

Configure how long customers have to pay:

| Term | Description |
|------|-------------|
| Due on Receipt | Payment required immediately |
| Net 7 | Payment due within 7 days |
| Net 14 | Payment due within 14 days |
| Net 30 | Payment due within 30 days |
| Custom | Set a specific number of days |

The due date is automatically calculated based on the invoice date and selected payment terms.

## Invoice Fields

Each invoice includes:

- **Invoice Number**: Auto-generated, sequential number
- **Invoice Date**: Date the invoice was created
- **Due Date**: Calculated from payment terms
- **Customer Details**: Name, email, phone, address
- **Job Description**: Description of work performed
- **Materials**: List of materials with quantities and prices
- **Labor**: Hours worked and hourly rate
- **Markup**: Percentage markup on materials
- **Subtotal**: Total before GST
- **GST**: 10% Goods and Services Tax
- **Total**: Final amount including GST
- **Amount Paid**: Total payments received
- **Amount Due**: Remaining balance

## Invoice Numbering

Invoice numbers are automatically generated and increment sequentially. The format is a simple numeric sequence (e.g., 1, 2, 3...).

Invoice numbers are synced across devices via cloud storage to ensure consistency.

## Viewing Invoices

The Invoices List screen displays all your invoices with:

- Customer name
- Invoice number
- Total amount
- Status badge (color-coded)
- Due date or days overdue

### Filtering and Searching

- **Search**: Filter invoices by customer name or invoice number
- **Status Filter**: View all, or filter by specific status

## Invoice Actions

From the View Invoice screen, you can:

- **Edit**: Modify invoice details (draft invoices only)
- **Send**: Share via email, SMS, or WhatsApp
- **Record Payment**: Log a payment received
- **Duplicate**: Create a copy of the invoice
- **Delete**: Remove the invoice (with confirmation)
- **Download PDF**: Generate and save a PDF copy

## PDF Generation

Invoice PDFs include:

- Your business logo and details
- Customer information
- Itemized materials list
- Labor charges
- GST breakdown
- Payment terms and due date
- Payment method information (if configured)
- Payment status and amount due

## Overdue Tracking

The system automatically tracks overdue invoices:

- Invoices past their due date are marked as `overdue`
- The invoice list shows days overdue
- Overdue invoices are highlighted for attention

## Cloud Synchronization

All invoices are automatically synced to the cloud:

- Create an invoice on one device, access it on another
- Real-time updates across all logged-in devices
- Offline support with automatic sync when reconnected

## Best Practices

1. **Set appropriate payment terms** based on your industry standard
2. **Convert quotes promptly** once work is accepted
3. **Record payments immediately** to keep records accurate
4. **Follow up on overdue invoices** using the status filter
5. **Include payment details** in your business settings for easier customer payments
