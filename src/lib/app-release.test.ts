import { describe, expect, it } from "vitest";
import {
  formatFileSize,
  isDownloadable,
  normalizeSha256,
  validateRelease,
  type AppRelease,
  type AppReleaseInput,
} from "@/lib/app-release";

const base: AppReleaseInput = {
  enabled: false,
  downloadUrl: "",
  version: "1.0.0",
  releaseDate: "",
  sizeBytes: 0,
  minOs: "Android 7.0+",
  sha256: "",
  notes: "",
};

const row = (patch: Partial<AppRelease>): AppRelease =>
  ({
    id: 1,
    android_enabled: true,
    android_download_url: "https://example.com/app-release.apk",
    android_version: "1.0.0",
    android_release_date: null,
    android_size_bytes: 0,
    android_min_os: "Android 7.0+",
    android_sha256: "",
    android_release_notes: "",
    android_download_count: 0,
    updated_by: null,
    created_at: "",
    updated_at: "",
    ...patch,
  }) as AppRelease;

describe("formatFileSize", () => {
  it("hides an unknown size", () => {
    expect(formatFileSize(0)).toBe("");
    expect(formatFileSize(null)).toBe("");
  });
  it("shows MB for app-sized files", () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("shows KB for small files", () => {
    expect(formatFileSize(120 * 1024)).toBe("120 KB");
  });
});

describe("normalizeSha256", () => {
  it("strips spacing and lowercases", () => {
    expect(normalizeSha256(" AB cd:ef ")).toBe("abcdef");
  });
});

describe("validateRelease", () => {
  it("requires https", () => {
    expect(validateRelease({ ...base, downloadUrl: "http://x/app.apk" })).toMatch(/https/);
  });
  it("refuses to publish without a link", () => {
    expect(validateRelease({ ...base, enabled: true })).toMatch(/official APK link/);
  });
  it("rejects a short checksum", () => {
    expect(validateRelease({ ...base, sha256: "abc123" })).toMatch(/64 hexadecimal/);
  });
  it("accepts a complete release", () => {
    expect(
      validateRelease({
        ...base,
        enabled: true,
        downloadUrl: "https://example.com/app-release.apk",
        sha256: "e".repeat(64),
        sizeBytes: 1024,
      }),
    ).toBeNull();
  });
});

describe("isDownloadable", () => {
  it("is false with no release, disabled, or a blank url", () => {
    expect(isDownloadable(null)).toBe(false);
    expect(isDownloadable(row({ android_enabled: false }))).toBe(false);
    expect(isDownloadable(row({ android_download_url: "  " }))).toBe(false);
  });
  it("is true once the owner publishes a link", () => {
    expect(isDownloadable(row({}))).toBe(true);
  });
});
