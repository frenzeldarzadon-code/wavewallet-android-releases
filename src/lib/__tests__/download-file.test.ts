import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { downloadTextFile, sanitizeFileName } from "../download-file";

describe("sanitizeFileName", () => {
  it("keeps a normal generated name", () => {
    expect(sanitizeFileName("wavewallet-portal-sagada.html")).toBe("wavewallet-portal-sagada.html");
  });
  it("strips paths and unsafe characters", () => {
    expect(sanitizeFileName("../../etc/por*tal?.html")).toBe("portal.html");
  });
  it("falls back when empty", () => {
    expect(sanitizeFileName("   ")).toBe("portal.html");
  });
});

describe("downloadTextFile", () => {
  const created: string[] = [];
  beforeEach(() => {
    created.length = 0;
    // @ts-expect-error test shim
    URL.createObjectURL = vi.fn(() => {
      const u = `blob:test-${created.length}`;
      created.push(u);
      return u;
    });
    // @ts-expect-error test shim
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("triggers a click on an anchor attached to the document", () => {
    let clickedName: string | null = null;
    let wasInDocument = false;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clickedName = (this as HTMLAnchorElement).download;
      wasInDocument = document.body.contains(this as HTMLAnchorElement);
    };
    const res = downloadTextFile("<html>portal</html>", "portal-page.html");
    HTMLAnchorElement.prototype.click = orig;

    expect(res.ok).toBe(true);
    expect(res.fileName).toBe("portal-page.html");
    expect(clickedName).toBe("portal-page.html");
    expect(wasInDocument).toBe(true);
    expect(res.url).toBe("blob:test-0");
    // URL must still be alive right after the click for a fallback link.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("refuses empty content", () => {
    const res = downloadTextFile("", "portal.html");
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("reports an error when the browser blocks the click", () => {
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => {
      throw new Error("blocked");
    };
    const res = downloadTextFile("<html>x</html>", "portal.html");
    HTMLAnchorElement.prototype.click = orig;
    expect(res.ok).toBe(false);
    expect(res.error).toContain("blocked");
    expect(res.url).toBe("blob:test-0");
  });
});
