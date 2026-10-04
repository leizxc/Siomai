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

## Deploy the API on Railway and the frontend on Firebase Hosting

Deploy the repository root as a Railway Node service. Railway detects the root
`package.json` and starts the API with `npm start`. In the Railway service's
Variables tab, set `NODE_ENV=production`, `FIREBASE_PROJECT_ID=siomai-b3afe`,
and `ALLOWED_ORIGINS=https://siomai-b3afe.web.app`. Set
`FIREBASE_SERVICE_ACCOUNT` to the full service-account JSON as a Railway
secret variable; never commit that JSON file or paste it into frontend code.

Generate a public Railway domain and set it as `API_BASE_URL` in
`BackEnd/public/js/apiConfig.js` (origin only, without a trailing slash). Then
deploy the frontend with `firebase deploy --only hosting`. The Express API is
separate from Firebase Hosting, so the Railway service must stay deployed and
its domain must be reachable for manager account actions to work.

## Authors

Lei Librora and Dave Cando
