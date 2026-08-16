import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type GuideSection = Database["public"]["Tables"]["guide_sections"]["Row"];
export type GuideFaq = Database["public"]["Tables"]["guide_faqs"]["Row"];
export type GuidePlan = Database["public"]["Tables"]["subscription_plans"]["Row"];
export type GuideAnsweredQuestion = { id: string; question: string; answer: string | null };

export type GuideContent = {
  sections: GuideSection[];
  faqs: GuideFaq[];
  plans: GuidePlan[];
  questions: GuideAnsweredQuestion[];
};

/** Anonymous, SSR-safe read of the public guide (no session required). */
export const loadGuide = createServerFn({ method: "GET" }).handler(async (): Promise<GuideContent> => {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return { sections: [], faqs: [], plans: [], questions: [] };

  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });

  try {
    const [sections, faqs, plans, questions] = await Promise.all([
      client.from("guide_sections").select("*").eq("published", true).order("display_order"),
      client.from("guide_faqs").select("*").eq("published", true).order("display_order"),
      client.from("subscription_plans").select("*").eq("active", true).order("display_order"),
      client
        .from("guide_questions")
        .select("id, question, answer")
        .eq("status", "published")
        .order("answered_at", { ascending: false })
        .limit(20),
    ]);
    return {
      sections: sections.data ?? [],
      faqs: faqs.data ?? [],
      plans: plans.data ?? [],
      questions: (questions.data as GuideAnsweredQuestion[] | null) ?? [],
    };
  } catch {
    return { sections: [], faqs: [], plans: [], questions: [] };
  }
});
