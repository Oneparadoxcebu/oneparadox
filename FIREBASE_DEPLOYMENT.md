# Firebase setup (Spark/free plan)

The app uses Firebase Authentication and Cloud Firestore directly. It does not require Cloud Functions or Cloudflare Workers, so its frontend data operations can run on Firebase's Spark plan within the plan's quotas.

## Configure Firebase

1. In the Firebase Console, select project `oneparadox-c5c48`.
2. Enable **Email/Password** in Authentication.
3. Create the default Cloud Firestore database.
4. Publish the rules in `firestore.rules`:

   ```powershell
   firebase deploy --only firestore:rules --project oneparadox-c5c48
   ```

5. Create an Authentication user for each person and an enabled profile at `users/{uid}`. Each profile should include `username`, `name`, `email`, `role`, `permissions`, `inventoryAccess`, `office`, and `disabled`. Grant only the page and office access required for that account.

The login form accepts email addresses. Username-based login and administrative password changes or deletion of other users' Authentication accounts require privileged server functionality and are not available in this Spark-plan configuration. Developers can disable profiles, and users can change their own password after signing in.

Requests are stored in the Firestore `workspaceRequests` collection. Submitters can read their own requests; Developer accounts and users with Thermal inventory access can review and manage all requests. Firestore rules enforce these permissions.

Thermal records are also synchronized into `stationThermalInventory/{station}` documents and their `chunks` subcollections. Station accounts can read only the projection matching their assigned `office`; they cannot read the shared Thermal inventory. After deploying the updated rules, a Thermal Inventory manager should open the Thermal Inventory page once while online to backfill the existing records. New Thermal inventory saves update the station projections automatically. If a station Requests page reports that its inventory has not been synced, have a Thermal Inventory manager open that page and verify the sync succeeds.

Firebase Spark has usage limits. Review Firebase's current quota and pricing information before storing production data or enabling additional services.
