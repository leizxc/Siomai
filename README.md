# Queen Cassy

An Executive Information System for managing Queen Cassy's daily business operations.

## Features

- Sales orders and income monitoring
- Product and inventory management
- Expense and capital tracking
- Employee accounts and management
- Attendance and payroll
- Manager dashboard, alerts, and reports
- Role-based access using Firebase Authentication and Cloud Firestore

## Server configuration

The Express API accepts owner-only manager account actions when the verified
Firebase token has the `owner` custom claim or the matching Firestore `users`
record has `role: "owner"`. For an additional explicit allowlist, set
`OWNER_EMAILS` to comma-separated Firebase Authentication email addresses.
Keep that list limited to trusted owner accounts. `ADMIN_EMAILS` remains the
separate administrator allowlist.

## Deploy on Vercel and Firebase Hosting

Import this repository into Vercel and set its Root Directory to `BackEnd`.
The Vercel function serves both the Express API and the `public` frontend.
Configure these Vercel environment variables for Production:

- `NODE_ENV=production`
- `FIREBASE_SERVICE_ACCOUNT`: the full Firebase service-account JSON, stored as
  a secret environment variable. Never commit the service-account file.
- `ALLOWED_ORIGINS=https://siomai-b3afe.web.app,https://siomai-b3afe.firebaseapp.com`

`BackEnd/public/js/apiConfig.js` must contain the Vercel deployment's origin
only (no trailing slash). It currently points to `https://siomai.vercel.app`.
The Firebase Hosting project is `siomai-b3afe`; deploy its frontend with
`firebase deploy --only hosting` from the repository root. If using the
Firebase Hosting domain, add it to Firebase Authentication's Authorized domains.

## Authors

Lei Librora and Dave Cando
