# Authentication

QuoteMate uses Firebase Authentication to provide secure sign-in options and protect your business data.

## Overview

Authentication enables:

- Secure access to your data
- Cloud synchronization across devices
- Subscription and billing management
- Account recovery options

## Sign-In Methods

### Email and Password

The traditional sign-in method:

**Sign Up:**
1. Enter your email address
2. Create a password (minimum 6 characters)
3. Confirm your password
4. Tap **Sign Up**

**Sign In:**
1. Enter your registered email
2. Enter your password
3. Tap **Sign In**

**Password Requirements:**
- Minimum 6 characters
- Recommended: Mix of letters, numbers, and symbols

### Google Sign-In

Quick authentication using your Google account:

1. Tap **Continue with Google**
2. Select your Google account (or sign in to Google)
3. Grant permission to QuoteMate
4. You're signed in!

**Benefits:**
- No new password to remember
- Secure OAuth 2.0 authentication
- Quick one-tap sign-in

**Supported Platforms:**
- iOS
- Android
- Web

### Apple Sign-In

Sign in with your Apple ID (iOS only):

1. Tap **Sign in with Apple**
2. Authenticate with Face ID, Touch ID, or passcode
3. Choose to share or hide your email
4. You're signed in!

**Benefits:**
- Privacy-focused (hide your email option)
- Secure authentication
- Native iOS integration

**Hide My Email:**
Apple can generate a random email address that forwards to your real email, keeping your personal email private.

**Supported Platforms:**
- iOS only

## Account Management

### Viewing Account Info

1. Go to **Settings**
2. Scroll to **Account** section
3. View your signed-in email and method

### Signing Out

1. Go to **Settings**
2. Scroll to **Account** section
3. Tap **Sign Out**
4. Confirm your choice

**Note:** Signing out:
- Stops cloud synchronization
- Keeps local data on the device
- Requires sign-in to access cloud features again

### Deleting Your Account

1. Go to **Settings**
2. Scroll to **Account** section
3. Tap **Delete Account**
4. Read the warning carefully
5. Confirm deletion

**Warning:** Account deletion:
- Permanently removes all cloud data
- Cannot be undone
- Does not provide refunds for subscriptions
- Local data remains until app is uninstalled

## Password Recovery

### Forgot Password (Email/Password Users)

1. On the sign-in screen, tap **Forgot Password**
2. Enter your registered email address
3. Check your email for reset instructions
4. Click the link and create a new password
5. Sign in with your new password

**Note:** Password reset links expire after a set time.

### Account Recovery (Social Sign-In)

If you used Google or Apple Sign-In:
- Recover access through Google or Apple account recovery
- QuoteMate cannot reset passwords for social accounts

## Security Features

### Session Management

- Sessions persist across app restarts
- Automatic token refresh
- Secure token storage

### Data Protection

- All authentication uses HTTPS
- Passwords are never stored locally
- Firebase handles credential security

## Switching Accounts

To use a different account:

1. Sign out of current account
2. Sign in with the new account

**Note:** Each account has separate data. Switching accounts means switching to different quotes, invoices, and settings.

## Linking Accounts

Currently, QuoteMate does not support linking multiple sign-in methods to one account. Use the same sign-in method consistently.

## Troubleshooting

### Can't Sign In

1. **Check email spelling** - Typos are common
2. **Reset password** - Use forgot password feature
3. **Check internet** - Authentication requires connection
4. **Try different method** - If you originally used Google, use Google

### Google Sign-In Fails

1. **Check Google account** - Ensure it's working
2. **Update Google Play Services** - Android only
3. **Clear app cache** - May resolve issues
4. **Reinstall app** - Last resort

### Apple Sign-In Fails

1. **Check iOS version** - Requires iOS 13+
2. **Verify Apple ID** - Ensure it's active
3. **Check device settings** - Apple ID must be signed in

### "Account Already Exists"

This error means an account with that email already exists:
- Use the existing sign-in method for that email
- Different sign-in methods create separate accounts

### Authentication Token Expired

If you see this error:
1. Sign out
2. Sign back in
3. If it persists, reinstall the app

## Best Practices

### Choosing a Sign-In Method

| Method | Best For |
|--------|----------|
| Email/Password | Users who want control |
| Google | Quick access, Android users |
| Apple | Privacy-conscious iOS users |

### Security Recommendations

1. **Use a strong password** (if using email/password)
2. **Enable 2FA on Google/Apple** for extra security
3. **Don't share login credentials**
4. **Sign out on shared devices**
5. **Use unique passwords** for important accounts

### Consistency

- Use the same sign-in method on all devices
- Remember which method you used
- Don't create multiple accounts accidentally
