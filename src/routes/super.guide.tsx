import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { shortDate } from "@/lib/wavewallet";

type Section = Database["public"]["Tables"]["guide_sections"]["Row"];
type Faq = Database["public"]["Tables"]["guide_faqs"]["Row"];
type Question = Database["public"]["Tables"]["guide_questions"]["Row"];

const TITLE = "Guide content — ONE WAVE Super Admin";
const DESCRIPTION = "Edit the public ONE WAVE guide, manage FAQs and answer visitor questions.";

export const Route = createFileRoute("/super/guide")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperGuide,
});

function SuperGuide() {
  const [sections, setSections] = useState<Section[]>([]);
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [s, f, q] = await Promise.all([
      supabase.from("guide_sections").select("*").order("display_order"),
      supabase.from("guide_faqs").select("*").order("display_order"),
      supabase.rpc("guide_questions_admin"),
    ]);
    setSections(s.data ?? []);
    setFaqs(f.data ?? []);
    setQuestions(q.data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSection = async (row: Section) => {
    const { error } = await supabase
      .from("guide_sections")
      .update({
        heading: row.heading,
        subheading: row.subheading,
        body: row.body,
        display_order: row.display_order,
        published: row.published,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) toast.error(error.message);
    else toast.success("Section saved");
  };

  const addSection = async () => {
    const { error } = await supabase.from("guide_sections").insert({
      section_key: `section-${Date.now()}`,
      heading: "New section",
      body: "",
      display_order: (sections.at(-1)?.display_order ?? 0) + 10,
    });
    if (error) toast.error(error.message);
    else void load();
  };

  const removeSection = async (id: string) => {
    const { error } = await supabase.from("guide_sections").delete().eq("id", id);
    if (error) toast.error(error.message);
    else void load();
  };

  const saveFaq = async (row: Faq) => {
    const { error } = await supabase
      .from("guide_faqs")
      .update({
        question: row.question,
        answer: row.answer,
        display_order: row.display_order,
        published: row.published,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) toast.error(error.message);
    else toast.success("FAQ saved");
  };

  const addFaq = async () => {
    const { error } = await supabase.from("guide_faqs").insert({
      question: "New question",
      answer: "",
      display_order: (faqs.at(-1)?.display_order ?? 0) + 10,
    });
    if (error) toast.error(error.message);
    else void load();
  };

  const removeFaq = async (id: string) => {
    const { error } = await supabase.from("guide_faqs").delete().eq("id", id);
    if (error) toast.error(error.message);
    else void load();
  };

  const moderate = async (id: string, publish: boolean) => {
    const { error } = await supabase.rpc("answer_guide_question", {
      _id: id,
      _answer: answers[id] ?? "",
      _publish: publish,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(publish ? "Answer published" : "Question rejected");
      void load();
    }
  };

  return (
    <div>
      <PageSection devSlot="guide.public-guide-sections"
        title="Public guide sections"
        description="Shown on /guide to everyone, no sign-in required."
        action={
          <Button size="sm" variant="outline" onClick={addSection}>
            <Plus className="mr-1 size-4" /> Add section
          </Button>
        }
      >
        <div className="space-y-3">
          {sections.map((row, i) => (
            <Card key={row.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="space-y-3 px-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Heading</Label>
                    <Input
                      value={row.heading}
                      onChange={(e) =>
                        setSections((p) =>
                          p.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Subheading</Label>
                    <Input
                      value={row.subheading ?? ""}
                      onChange={(e) =>
                        setSections((p) =>
                          p.map((x, j) => (j === i ? { ...x, subheading: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Body</Label>
                  <Textarea
                    rows={4}
                    value={row.body}
                    onChange={(e) =>
                      setSections((p) =>
                        p.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={row.published}
                      onCheckedChange={(v) =>
                        setSections((p) => p.map((x, j) => (j === i ? { ...x, published: v } : x)))
                      }
                    />
                    <span className="text-xs text-muted-foreground">Published</span>
                  </div>
                  <Button size="sm" onClick={() => saveSection(sections[i]!)}>
                    <Save className="mr-1 size-4" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeSection(row.id)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageSection>

      <PageSection devSlot="guide.faqs"
        title="FAQs"
        description="Answers shown on the public guide."
        action={
          <Button size="sm" variant="outline" onClick={addFaq}>
            <Plus className="mr-1 size-4" /> Add FAQ
          </Button>
        }
      >
        <div className="space-y-3">
          {faqs.map((row, i) => (
            <Card key={row.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="space-y-3 px-4">
                <div className="space-y-1.5">
                  <Label>Question</Label>
                  <Input
                    value={row.question}
                    onChange={(e) =>
                      setFaqs((p) => p.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Answer</Label>
                  <Textarea
                    rows={3}
                    value={row.answer}
                    onChange={(e) =>
                      setFaqs((p) => p.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={row.published}
                      onCheckedChange={(v) =>
                        setFaqs((p) => p.map((x, j) => (j === i ? { ...x, published: v } : x)))
                      }
                    />
                    <span className="text-xs text-muted-foreground">Published</span>
                  </div>
                  <Button size="sm" onClick={() => saveFaq(faqs[i]!)}>
                    <Save className="mr-1 size-4" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeFaq(row.id)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageSection>

      <PageSection devSlot="guide.visitor-questions"
        title="Visitor questions"
        description="Nothing appears on the public guide until you answer and publish it."
      >
        <div className="space-y-3">
          {questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No questions yet.</p>
          ) : null}
          {questions.map((q) => (
            <Card key={q.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="space-y-2 px-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{q.question}</p>
                  <StatusBadge
                    tone={
                      q.status === "published" ? "success" : q.status === "rejected" ? "danger" : "warning"
                    }
                  >
                    {q.status}
                  </StatusBadge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {shortDate(q.created_at)}
                  {q.contact ? ` · ${q.contact}` : ""}
                </p>
                <Textarea
                  rows={3}
                  placeholder="Write the public answer…"
                  value={answers[q.id] ?? q.answer ?? ""}
                  onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => moderate(q.id, true)}>
                    <Check className="mr-1 size-4" /> Publish answer
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => moderate(q.id, false)}>
                    <X className="mr-1 size-4" /> Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageSection>
    </div>
  );
}
