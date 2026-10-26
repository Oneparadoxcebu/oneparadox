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

5. Create an Authentication user for each person and an enabled profile at `users/{uid}`. Each profile should include `username`, `name`, `email`, `role`, `permissions`, `inventoryAccess`, `office`, and `disabled`. The app applies these role policies: IT Admin has Developer-equivalent access; IT Manager can manage Cebu and Thermal inventory and user profiles; IT Support can manage Cebu inventory and user profiles; Management, Accounting, and HR have read-only access to Cebu and Thermal inventory.

The sign-in form accepts email addresses and uses Firebase Email/Password Authentication. Username-based sign-in and administrative password changes or deletion of other users' Authentication accounts require privileged server functionality and are not available in this Spark-plan configuration. Developer and IT Admin accounts can disable profiles; IT Manager and IT Support can disable profiles only within the lower-privilege roles they are allowed to manage. Users can change their own password after signing in.

Rizal inventory has been decommissioned from the application. Its existing Firestore data is retained and is not cleared, but Firestore rules no longer permit access to it. Reassign users previously assigned to Rizal to Cebu or Thermal as appropriate.

Requests are stored in the Firestore `workspaceRequests` collection. Submitters can read their own requests; Developer, IT Admin, and IT Manager accounts can review and manage all requests. Firestore rules enforce these permissions.

Thermal records are also synchronized into `stationThermalInventory/{station}` documents and their `chunks` subcollections. Station accounts can read only the projection matching their assigned `office`; Collector accounts can read only the `Collector` category projection. Neither role can read the shared Thermal inventory. Station-created Thermal records are stored separately under `stationThermalRecords/{station}/records/{recordId}`; the assigned Station and Thermal inventory managers can read them, while only the assigned Station can create them. Thermal inventory loads merge these records into the shared record list, and Thermal inventory managers' edits/deletions are synchronized back to the station records. After deploying the updated rules, a Thermal Inventory manager should open the Thermal Inventory page once while online to backfill the existing records. New Thermal inventory saves update the station and Collector projections automatically. If a station or Collector Requests page reports that its inventory has not been synced, have a Thermal Inventory manager open that page and verify the sync succeeds.

Firebase Spark has usage limits. Review Firebase's current quota and pricing information before storing production data or enabling additional services.
