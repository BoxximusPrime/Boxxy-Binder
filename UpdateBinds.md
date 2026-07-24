# Updating the Master Bindings Database

The app can download a new `AllBinds.xml` without requiring a new application
build. The published XML and its manifest must both be committed to the
repository's `main` branch.

## Publish an update

1. Replace or edit `AllBinds.xml` with the latest master bindings.

2. Update the release information in `allbinds-manifest.json`:

   - `dataVersion`: Unique version for this bindings update, such as
     `alpha-4.9`.
   - `gameVersion`: Matching Star Citizen version, such as `4.9`.
   - `minAppVersion`: Oldest compatible Boxxy Binder version.
   - `notes`: Short description of the update.
   - Leave `downloadUrl` pointing to the raw `AllBinds.xml` on `main`.

3. Calculate and insert the correct SHA-256 hash:

   ```powershell
   npm.cmd run bindings-hash
   ```

   The command normalizes Windows CRLF line endings to the LF format served by
   GitHub, calculates the hash, and updates `sha256` in
   `allbinds-manifest.json`.

   The script can also be run directly:

   ```powershell
   node .\scripts\update-allbinds-hash.cjs
   ```

4. Confirm that the manifest contains the new hash, then commit and push both
   files:

   ```powershell
   git add AllBinds.xml allbinds-manifest.json
   git commit -m "Update base bindings for SC 4.9"
   git push origin main
   ```

5. In an installed build of Boxxy Binder, open Settings and select
   **Check for Updates**. The status should report that the base bindings were
   updated or are up to date.

## Troubleshooting

If the app reports `Downloaded XML did not match manifest hash`, first confirm
that the hash script was run after the final XML edit and that both files were
pushed to `main`.

GitHub or the app's WebView may briefly cache an earlier copy. Fully close
Boxxy Binder, wait a minute, reopen it, and check again.

Do not calculate the hash with PowerShell's `Get-FileHash` against the Windows
working copy. Its CRLF line endings produce a different hash from the LF file
served by GitHub.

## Binding file in SC
'defaultProfile.xml'