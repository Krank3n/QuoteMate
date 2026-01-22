# Cloud Synchronization

QuoteMate uses Firebase Firestore to keep your data synchronized across all your devices in real-time.

## Overview

Cloud sync ensures that:

- All quotes are available on every device
- All invoices are available on every device
- Business settings stay consistent
- Payment records are always up-to-date
- Changes appear instantly across devices

## How It Works

### Real-Time Listeners

QuoteMate uses Firestore real-time listeners to:

1. **Push changes** - When you create or edit data, it's immediately uploaded
2. **Receive updates** - Changes from other devices appear instantly
3. **Conflict resolution** - Latest changes always win

### Data Types Synced

| Data Type | Sync Enabled |
|-----------|--------------|
| Quotes | Yes |
| Invoices | Yes |
| Business Settings | Yes |
| Payment Records | Yes |
| Material Favorites | Yes |
| Subscription Status | Yes |

## Requirements

### Authentication

Cloud sync requires you to be signed in:

- **Email/Password** - Standard sign-in
- **Google Sign-In** - Quick authentication
- **Apple Sign-In** - iOS users (Sign in with Apple)

Anonymous users do not have cloud sync enabled.

### Internet Connection

- **Online**: Data syncs in real-time
- **Offline**: Data is stored locally and syncs when reconnected

## Offline Support

QuoteMate works offline using local storage:

### How Offline Mode Works

1. You create a quote while offline
2. Quote is saved to local AsyncStorage
3. When you reconnect, quote uploads to Firestore
4. Other devices receive the new quote

### Limitations

While offline, you can:
- Create and edit quotes
- Create and edit invoices
- Record payments
- Change settings

While offline, you cannot:
- See changes made on other devices
- Access data created only on other devices

## Data Storage Architecture

### Local Storage (AsyncStorage)

Primary storage for immediate access:
- Fast read/write operations
- Works without internet
- Persists across app restarts

### Cloud Storage (Firestore)

Secondary storage for synchronization:
- Cross-device access
- Real-time updates
- Backup and recovery

### Sync Flow

```
┌─────────────────────────────────────────────────────┐
│                    User Action                       │
│                  (Create Quote)                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│               Save to AsyncStorage                   │
│                 (Immediate)                          │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│               Upload to Firestore                    │
│              (When Online)                           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│          Firestore Broadcasts Update                 │
│            (To All Devices)                          │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│         Other Devices Receive Update                 │
│         Update Local AsyncStorage                    │
└─────────────────────────────────────────────────────┘
```

## Data Security

### User Isolation

- Each user's data is completely separate
- You can only access your own quotes and invoices
- Authentication is required for all cloud operations

### Firestore Security Rules

Data is protected by security rules that ensure:
- Users can only read/write their own documents
- Authentication is verified on every request
- Data structure is validated

### Encryption

- Data in transit is encrypted (HTTPS/TLS)
- Data at rest is encrypted by Firebase

## Sync Indicators

The app provides visual feedback about sync status:

| Indicator | Meaning |
|-----------|---------|
| Syncing | Data is being uploaded/downloaded |
| Synced | All data is up-to-date |
| Offline | No internet connection |
| Error | Sync failed (will retry) |

## Troubleshooting

### Data Not Syncing

1. **Check internet connection** - Ensure you're online
2. **Verify sign-in** - Make sure you're logged in
3. **Restart the app** - Force close and reopen
4. **Check Firestore status** - Firebase may have outages

### Missing Data on New Device

1. **Sign in with same account** - Data is tied to your account
2. **Wait for initial sync** - Large data sets take time
3. **Check internet connection** - Ensure stable connection

### Duplicate Data

This can occur if:
- You created data offline on multiple devices
- Network issues caused retry uploads

The app automatically handles most duplicates, but you can manually delete extras.

### Slow Sync

Large amounts of data may take time to sync:
- Initial sync after sign-in is slowest
- Subsequent syncs are incremental and faster
- Images/logos may take additional time

## Best Practices

### Regular Sign-In

- Stay signed in for automatic sync
- Don't sign out unless necessary
- Use the same account on all devices

### Network Considerations

- Use Wi-Fi for large initial syncs
- Cellular data works but uses your data plan
- Poor connections may delay sync

### Data Management

- Regularly delete old/unused quotes
- Archive completed invoices
- Keep data volume manageable

## Privacy

### What's Stored in the Cloud

- Business information (name, ABN, contact details)
- Customer information (name, email, phone, address)
- Quote and invoice content
- Payment records

### What's NOT Stored in the Cloud

- Payment credentials (credit card numbers)
- Login passwords (handled by Firebase Auth)
- Local app preferences

### Data Deletion

When you delete your account:
- All cloud data is permanently removed
- Local data remains until app is uninstalled
- Deletion is irreversible

## Multi-Device Usage

### Supported Devices

- iOS (iPhone and iPad)
- Android phones and tablets
- Web browsers

### Simultaneous Editing

If you edit the same document on multiple devices:
- The most recent change wins
- Changes are merged when possible
- Conflicts are rare in practice

### Device Limits

There's no limit to the number of devices you can use with one account.
