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

## Authors

Lei Librora and Dave Cando
