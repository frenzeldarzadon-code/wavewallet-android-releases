import { describe, expect, it, beforeEach, afterEach } from "vitest";
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

/** Minimal DOM stand-in: the suite runs in node, with no jsdom. */
interface FakeAnchor {
  href: string;
  download: string;
  rel: string;
  style: { display: string };
  click: () => void;
  remove: () => void;
}

function installDom(clickImpl?: () => void) {
  const state = {
    appended: [] as FakeAnchor[],
    clicked: [] as { name: string; attached: boolean }[],
    revoked: [] as string[],
    created: [] as string[],
  };
  const body = {
    children: [] as FakeAnchor[],
    appendChild(el: FakeAnchor) {
      this.children.push(el);
      state.appended.push(el);
    },
  };
  (globalThis as unknown as { document: unknown }).document = {
    body,
    createElement: (): FakeAnchor => {
      const el: FakeAnchor = {
        href: "",
        download: "",
        rel: "",
        style: { display: "" },
        click() {
          state.clicked.push({ name: el.download, attached: body.children.includes(el) });
          clickImpl?.();
        },
        remove() {
          body.children = body.children.filter((c) => c !== el);
        },
      };
      return el;
    },
  };
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => {
    const u = `blob:test-${state.created.length}`;
    state.created.push(u);
    return u;
  };
  URL.revokeObjectURL = (u: string) => void state.revoked.push(u);
  return {
    state,
    restore() {
      delete (globalThis as unknown as { document?: unknown }).document;
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    },
  };
}

describe("downloadTextFile", () => {
  let dom: ReturnType<typeof installDom> | null = null;
  beforeEach(() => {
    dom = null;
  });
  afterEach(() => dom?.restore());

  it("clicks an anchor that is attached to the document and keeps the url alive", () => {
    dom = installDom();
    const res = downloadTextFile("<html>portal</html>", "portal-page.html");
    expect(res.ok).toBe(true);
    expect(res.fileName).toBe("portal-page.html");
    expect(res.url).toBe("blob:test-0");
    expect(dom.state.clicked).toEqual([{ name: "portal-page.html", attached: true }]);
    // Revoking in the same tick cancels the download on some mobile browsers.
    expect(dom.state.revoked).toEqual([]);
    // The temporary anchor is cleaned up again.
    expect(dom.state.appended[0]).toBeDefined();
  });

  it("sanitizes the generated file name before saving", () => {
    dom = installDom();
    const res = downloadTextFile("<html>x</html>", "sub/dir/wave*portal?.html");
    expect(res.ok).toBe(true);
    expect(dom.state.clicked[0]!.name).toBe("waveportal.html");
  });

  it("refuses empty content", () => {
    dom = installDom();
    const res = downloadTextFile("", "portal.html");
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(dom.state.clicked).toEqual([]);
  });

  it("reports an error and returns a fallback url when the click is blocked", () => {
    dom = installDom(() => {
      throw new Error("blocked by browser");
    });
    const res = downloadTextFile("<html>x</html>", "portal.html");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("blocked");
    expect(res.url).toBe("blob:test-0");
  });
});
