# Fix Admin portal download

## Goal
Make the generated Omada portal download reliably from the Admin workflow while preserving the exact generated HTML, preview, canonical master, themes, features, manual voucher entry, and Voucher Shop routing.

## Root cause found
- Generation successfully persists a non-empty single-file HTML artifact (`147,989` bytes in the latest production record).
- The Admin wizard stores that HTML in client state, then immediately calls its template refresh helper.
- That helper clears the generated state after the refresh completes, removing the only download payload and disabling the Download action.
- The existing Blob helper is not the primary failure; it never gets a stable generated payload to download.

## Implementation
1. Separate “refresh saved template metadata” from “invalidate generated artifact” so generation can refresh status without deleting its result.
2. Keep explicit invalidation when the selected portal, features, or theme changes, preventing stale artifacts from being downloaded.
3. Retain the single self-contained `.html` format because the canonical workflow inlines required archive scripts and intentionally removes image/style assets; no ZIP is required for the current generated artifact.
4. Add regression coverage for the generate → metadata refresh → enabled Download state and preserve the existing Blob/download utility tests.
5. Verify the Admin flow in a browser, including downloaded filename, MIME/content, byte size, and unchanged iframe preview.

## Validation and release
- Run targeted tests, typecheck, lint/build checks, and the full test suite.
- Publish the frontend fix to production and confirm deployment status.
- No live Omada controller configuration will be read or changed beyond the app’s existing generation workflow.

## Testing limitation
The managed browser currently has no signed-in session, and minting a specific Admin session requires unavailable approval. I will still validate the state transition with regression coverage and browser-level download behavior locally; if a session becomes available, I will also rerun the authenticated published flow.