# Clean up Admin Omada portal configuration

## Scope
- Remove the obsolete External Portal Server status, URL, pre-authentication value, setup instructions, test action, and raw test output from the normal Admin UI.
- Preserve portal mapping data and backend integration code; no controller writes, schema changes, or deletion of existing records.
- Keep each connected portal concise: portal name, shop, Omada site/SSID, mapping status, and Edit / Switch on-off / Disconnect actions.
- Make the customized-page builder the clear workflow: choose exact portal, choose design, choose features, generate, preview/download, then manually import into Omada.
- Remove the unverified “Imported into Omada” progress state and replace stale progress language with verifiable generation/download guidance.
- Move canonical-master checksums, preserved-mechanics notes, and generated checksums/summaries into collapsed Advanced details sections.

## Technical details
- Update `PortalMappingPanel` presentation only; retain mapping save/toggle/delete calls and all fields required by the generator.
- Update `PortalTemplateWizard` hierarchy and status labels without changing generation, preview, persistence, or authenticated download behavior.
- Add focused UI regression coverage for the absence of obsolete external-server text and the presence of the current custom-page workflow.
- Run focused tests and the project validation/build, inspect the rendered Admin Omada page at desktop/mobile widths where authentication permits, then publish production.
