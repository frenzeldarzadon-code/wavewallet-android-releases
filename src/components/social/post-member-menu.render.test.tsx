/**
 * Renders the post action area exactly as the feed does for ANOTHER member's
 * post and asserts the social actions are visible in the row (not hidden in
 * the overflow menu), and that the owner view keeps them off.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => children as never,
}));

import { PostMemberMenu } from "./post-member-menu";

const base = {
  authorId: "author-1",
  authorName: "Demo Reseller",
  authorHandle: "demoreseller",
  onMessage: () => {},
  onQuickMessage: () => {},
  onGiftSocialCredit: () => {},
  onToggleFollow: () => {},
  onReport: () => {},
  onBlock: () => {},
};

describe("PostMemberMenu action row", () => {
  it("shows Follow, Message and Gift for another member's post", () => {
    const html = renderToStaticMarkup(<PostMemberMenu {...base} isSelf={false} />);
    expect(html).toContain(">Follow<");
    expect(html).toContain(">Message<");
    expect(html).toContain(">Gift<");
    expect(html).not.toMatch(/Send coins|Gift social credit/i);
    expect(html).toContain("More actions for Demo Reseller");
  });

  it("shows Unfollow when already following", () => {
    const html = renderToStaticMarkup(<PostMemberMenu {...base} isSelf={false} following />);
    expect(html).toContain(">Unfollow<");
  });

  it("hides member actions on the viewer's own post but keeps the menu", () => {
    const html = renderToStaticMarkup(<PostMemberMenu {...base} isSelf onDelete={() => {}} />);
    expect(html).not.toContain(">Follow<");
    expect(html).not.toContain(">Gift<");
    expect(html).toContain("More actions");
  });
});
