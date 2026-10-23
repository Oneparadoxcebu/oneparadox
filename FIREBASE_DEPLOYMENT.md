# Firebase setup and deployment

The site is deployed separately through GitHub Pages. The Firebase Functions API stores requests in `workspaceRequests`; browser clients cannot access that collection or the `accounts` collection directly.

## One-time Firebase setup

1. In the Firebase Console, open project `oneparadox-c5c48`, create the default Firestore database if needed, and enable Firebase Authentication. Cloud Functions deployment requires the project to be on the Firebase **Blaze** plan.
2. Install [Node.js](https://nodejs.org/), the [Firebase CLI](https://firebase.google.com/docs/cli), and the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install).
3. Keep the account map in the ignored local file `data/accounts.json`. Do not commit this file or any service-account credentials. The setup script does not print or upload its contents.
4. From the repository root, run the single setup command:

   ```powershell
   .\setup-firebase.ps1
   ```

   The script signs in to Firebase CLI and Google Cloud if needed, selects the configured project, installs Functions dependencies, runs tests, seeds account hashes, deploys Functions and Firestore rules, and verifies the login endpoint.

   If PowerShell blocks local scripts, run `Set-ExecutionPolicy -Scope Process Bypass` in that PowerShell window, then run the setup command again.

## GitHub deployment

Add this repository Actions secret before running the backend workflow:

- `FIREBASE_SERVICE_ACCOUNT`: JSON for a Google service account with Firebase Functions deployment and Firestore rules deployment permissions.

The Firebase workflow is optional automation. It explicitly targets `oneparadox-c5c48`; `.firebaserc` also sets it as the default project. To use it, add the `FIREBASE_SERVICE_ACCOUNT` GitHub Actions secret. It deploys Functions and Firestore rules on every push to `main`, runs Functions tests first, confirms the `api` function is listed, checks the login endpoint, and checks browser CORS. Alternatively, deploy directly with the local setup script above without creating a GitHub service-account secret. The Pages workflow stages only public HTML, CSS, JavaScript, images, and fonts; it does not publish local seed data or credentials. Requests, password updates, and direct-chat messages use authenticated Functions endpoints; `workspaceRequests`, `accounts`, and `onlineChats` deny direct browser access.

## Verification

After deployment, sign in through the site and submit a request. Confirm that its document appears in Firestore under `workspaceRequests`, then verify the request list, status update, rejection note, and delete actions using accounts with the appropriate role. Do not use unauthenticated Firestore rules or commit credentials to make this test pass.
