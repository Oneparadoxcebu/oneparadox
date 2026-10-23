# Firebase setup and deployment

The site is deployed separately through GitHub Pages. The Firebase Functions API stores requests in `workspaceRequests`; browser clients cannot access that collection or the `accounts` collection directly.

## One-time Firebase setup

1. Enable Firebase Authentication for the project. The app signs in through Firebase custom tokens; the account records are maintained in Firestore.
2. Create or select a Firebase project matching the project ID in `js/firebase-auth.js` and `js/firebase-shared.js`.
3. Install the Firebase CLI and authenticate locally with an account that can deploy Functions and Firestore rules.
   Set the active Google Cloud project so the account seeder uses the same project:

   ```powershell
   gcloud config set project nineteenaces-8ba08
   ```

4. Put the account map in the ignored local file `data/accounts.json`. Do not commit this file or service-account credentials.
5. Seed the accounts using Application Default Credentials:

   ```powershell
   cd functions
   npm install
   npm run seed:accounts
   ```

   The seed command hashes plaintext passwords before writing them. Station accounts are normalized to Requests-only inventory access. To use a different seed file, set `ACCOUNTS_FILE` to its path before running the command.
6. Deploy the backend and rules:

   ```powershell
   firebase deploy --only functions,firestore:rules --project nineteenaces-8ba08
   ```

## GitHub deployment

Add these repository Actions secrets before pushing to `main`:

- `FIREBASE_PROJECT_ID`: the Firebase project ID.
- `FIREBASE_SERVICE_ACCOUNT`: JSON for a Google service account with Firebase Functions deployment and Firestore rules deployment permissions.

The Firebase workflow deploys only Functions and Firestore rules. The Pages workflow stages only public HTML, CSS, JavaScript, images, and fonts; it does not publish local seed data or credentials. Requests, password updates, and direct-chat messages use authenticated Functions endpoints; `workspaceRequests`, `accounts`, and `onlineChats` deny direct browser access.

## Verification

After deployment, sign in through the site and submit a request. Confirm that its document appears in Firestore under `workspaceRequests`, then verify the request list, status update, rejection note, and delete actions using accounts with the appropriate role. Do not use unauthenticated Firestore rules or commit credentials to make this test pass.
