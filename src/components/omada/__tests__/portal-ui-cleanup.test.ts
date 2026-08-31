import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mappingSource = readFileSync(
  new URL("../portal-mapping-panel.tsx", import.meta.url),
  "utf8",
);
const wizardSource = readFileSync(
  new URL("../portal-template-wizard.tsx", import.meta.url),
  "utf8",
);

describe("Admin custom portal workflow presentation", () => {
  it("does not present the obsolete external-server setup", () => {
    expect(mappingSource).not.toMatch(/External Portal URL/i);
    expect(mappingSource).not.toMatch(/Pre-Authentication Access/i);
    expect(mappingSource).not.toMatch(/One-time Omada setup/i);
    expect(mappingSource).not.toMatch(/Test configuration/i);
    expect(mappingSource).not.toMatch(/authorizePath/);
  });

  it("keeps the current mapping and generation controls", () => {
    expect(mappingSource).toMatch(/Choose the exact Omada portal/);
    expect(mappingSource).toMatch(/Edit/);
    expect(mappingSource).toMatch(/Switch off/);
    expect(mappingSource).toMatch(/Disconnect/);
    expect(wizardSource).toMatch(/Choose design/);
    expect(wizardSource).toMatch(/Choose features/);
    expect(wizardSource).toMatch(/Generate &amp; download/);
    expect(wizardSource).toMatch(/Manual voucher entry is always included/);
  });

  it("does not claim that a manual Omada import is complete", () => {
    expect(wizardSource).not.toMatch(/Imported into Omada/);
    expect(wizardSource).toMatch(/does not mark it complete/);
  });
});