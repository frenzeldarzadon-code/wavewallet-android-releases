/**
 * Voucher calibration is derived from the controller's own API description, so
 * these tests pin the derivation and validation rules rather than any guessed
 * Omada field list.
 */
import { describe, expect, it } from "vitest";
import { resolvePath, voucherCapabilities, validateAgainstSpec } from "./omada-vouchers.server";

const spec = {
  paths: {
    "/openapi/v1/{omadacId}/sites/{siteId}/hotspot/voucher-groups": {
      get: {},
      post: {
        requestBody: {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/VoucherGroup" } },
          },
        },
      },
    },
    "/openapi/v1/{omadacId}/sites/{siteId}/hotspot/voucher-groups/{groupId}": {
      get: {},
      delete: {},
    },
    "/openapi/v1/{omadacId}/sites/{siteId}/hotspot/voucher-groups/{groupId}/vouchers": { get: {} },
  },
  components: {
    schemas: {
      VoucherGroup: {
        type: "object",
        required: ["name", "amount"],
        properties: {
          name: { type: "string" },
          amount: { type: "integer", minimum: 1, maximum: 500 },
          durationType: { type: "integer", enum: [0, 1] },
          rateLimit: {
            type: "object",
            properties: { mode: { type: "integer" }, downLimit: { type: "integer" } },
          },
        },
      },
    },
  },
};

describe("omada voucher calibration", () => {
  it("derives endpoints and fields from the controller's own document", () => {
    const caps = voucherCapabilities(spec as never);
    expect(caps.supported).toBe(true);
    expect(caps.createPath).toContain("/hotspot/voucher-groups");
    expect(caps.voucherListPath).toContain("/vouchers");
    expect(caps.deletePath).toContain("{groupId}");
    expect(caps.fields.map((f) => f.name)).toEqual([
      "name",
      "amount",
      "durationType",
      "rateLimit",
    ]);
    expect(caps.fields[1]).toMatchObject({ required: true, minimum: 1, maximum: 500 });
    expect(caps.fields[3]?.fields?.map((f) => f.name)).toEqual(["mode", "downLimit"]);
  });

  it("refuses to generate when the controller does not describe vouchers", () => {
    const caps = voucherCapabilities(null);
    expect(caps.supported).toBe(false);
    expect(caps.listPath).toContain("/hotspot/voucher-groups");
    expect(caps.voucherListPath).toContain("/vouchers");
    expect(caps.limitation).toBeTruthy();
  });

  it("resolves the official read-only voucher status route without a Swagger document", () => {
    const caps = voucherCapabilities(null);
    const path = resolvePath(
      { ecosystemId: "shop", base: "https://controller", omadacId: "controller-id", siteId: "site-id", token: "secret" },
      caps.voucherListPath ?? "",
      { groupId: "group-id" },
    );
    expect(path).toBe(
      "/openapi/v1/controller-id/sites/site-id/hotspot/voucher-groups/group-id/vouchers",
    );
  });

  it("validates a payload against the controller's declared rules", () => {
    const caps = voucherCapabilities(spec as never);
    expect(validateAgainstSpec(caps.fields, { name: "Batch", amount: 10 })).toEqual([]);
    expect(validateAgainstSpec(caps.fields, { amount: 10 })).toContain(
      "name is required by this controller.",
    );
    expect(validateAgainstSpec(caps.fields, { name: "x", amount: 900 })).toContain(
      "amount must be at most 500.",
    );
    expect(validateAgainstSpec(caps.fields, { name: "x", amount: 1, durationType: 7 })).toContain(
      "durationType must be one of 0, 1.",
    );
  });
});
