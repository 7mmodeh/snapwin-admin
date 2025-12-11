// app/(admin)/raffles/[id]/questions/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type CorrectAnswer = "a" | "b" | "c";

type QuestionRow = {
  id: string;
  raffle_id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  correct_answer: string; // DB is text, we normalize to "a" | "b" | "c" in UI
  order: number;
  created_at?: string | null;
};

type RaffleSummary = {
  id: string;
  item_name: string;
};

export default function RaffleQuestionsPage() {
  const params = useParams();
  const router = useRouter();

  const rawId = (params as { id?: string | string[] }).id;
  const raffleId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [raffle, setRaffle] = useState<RaffleSummary | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New question draft
  const [newQuestionText, setNewQuestionText] = useState("");
  const [newOptionA, setNewOptionA] = useState("");
  const [newOptionB, setNewOptionB] = useState("");
  const [newOptionC, setNewOptionC] = useState("");
  const [newCorrect, setNewCorrect] = useState<CorrectAnswer>("a");
  const [savingNew, setSavingNew] = useState(false);

  // Edit question draft
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestionText, setEditQuestionText] = useState("");
  const [editOptionA, setEditOptionA] = useState("");
  const [editOptionB, setEditOptionB] = useState("");
  const [editOptionC, setEditOptionC] = useState("");
  const [editCorrect, setEditCorrect] = useState<CorrectAnswer>("a");
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!raffleId) return;

      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const [raffleRes, questionsRes] = await Promise.all([
          supabase
            .from("raffles")
            .select("id, item_name")
            .eq("id", raffleId)
            .maybeSingle<RaffleSummary>(),
          supabase
            .from("questions")
            .select(
              'id, raffle_id, question_text, option_a, option_b, option_c, correct_answer, "order", created_at'
            )
            .eq("raffle_id", raffleId)
            .order("order", { ascending: true }),
        ]);

        if (raffleRes.error) throw raffleRes.error;
        if (!raffleRes.data) {
          setError("Raffle not found.");
          setLoading(false);
          return;
        }
        if (questionsRes.error) throw questionsRes.error;

        setRaffle(raffleRes.data);
        setQuestions((questionsRes.data ?? []) as QuestionRow[]);
      } catch (err: unknown) {
        console.error("Error loading questions:", err);
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load questions.");
        }
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [raffleId]);

  const resetNewForm = () => {
    setNewQuestionText("");
    setNewOptionA("");
    setNewOptionB("");
    setNewOptionC("");
    setNewCorrect("a");
  };

  const handleAddQuestion = async () => {
    if (!raffleId) return;

    const trimmedQuestion = newQuestionText.trim();
    if (!trimmedQuestion) {
      setError("Question text is required.");
      return;
    }
    if (!newOptionA.trim() || !newOptionB.trim() || !newOptionC.trim()) {
      setError("All options (A, B, C) are required.");
      return;
    }

    try {
      setSavingNew(true);
      setError(null);
      setSuccess(null);

      // Determine next "order" (NOT NULL, > 0)
      const maxOrder = questions.reduce(
        (max, q) => (q.order && q.order > max ? q.order : max),
        0
      );
      const nextOrder = maxOrder + 1;

      const { data, error } = await supabase
        .from("questions")
        .insert({
          raffle_id: raffleId,
          question_text: trimmedQuestion,
          option_a: newOptionA.trim(),
          option_b: newOptionB.trim(),
          option_c: newOptionC.trim(),
          correct_answer: newCorrect,
          order: nextOrder,
        })
        .select(
          'id, raffle_id, question_text, option_a, option_b, option_c, correct_answer, "order", created_at'
        )
        .single<QuestionRow>();

      if (error) throw error;

      setQuestions((prev) => [...prev, data]);
      resetNewForm();
      setSuccess("Question added.");
    } catch (err: unknown) {
      console.error("Error adding question:", err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to add question.");
      }
    } finally {
      setSavingNew(false);
    }
  };

  const startEdit = (q: QuestionRow) => {
    setEditingId(q.id);
    setEditQuestionText(q.question_text);
    setEditOptionA(q.option_a);
    setEditOptionB(q.option_b);
    setEditOptionC(q.option_c);

    const normalizedCorrect: CorrectAnswer =
      q.correct_answer === "b" ? "b" : q.correct_answer === "c" ? "c" : "a";

    setEditCorrect(normalizedCorrect);
    setError(null);
    setSuccess(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditQuestionText("");
    setEditOptionA("");
    setEditOptionB("");
    setEditOptionC("");
    setEditCorrect("a");
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    const trimmedQuestion = editQuestionText.trim();
    if (!trimmedQuestion) {
      setError("Question text is required.");
      return;
    }
    if (!editOptionA.trim() || !editOptionB.trim() || !editOptionC.trim()) {
      setError("All options (A, B, C) are required.");
      return;
    }

    try {
      setSavingEdit(true);
      setError(null);
      setSuccess(null);

      const { error } = await supabase
        .from("questions")
        .update({
          question_text: trimmedQuestion,
          option_a: editOptionA.trim(),
          option_b: editOptionB.trim(),
          option_c: editOptionC.trim(),
          correct_answer: editCorrect,
        })
        .eq("id", editingId);

      if (error) throw error;

      setQuestions((prev) =>
        prev.map((q) =>
          q.id === editingId
            ? {
                ...q,
                question_text: trimmedQuestion,
                option_a: editOptionA.trim(),
                option_b: editOptionB.trim(),
                option_c: editOptionC.trim(),
                correct_answer: editCorrect,
              }
            : q
        )
      );

      setSuccess("Question updated.");
      cancelEdit();
    } catch (err: unknown) {
      console.error("Error updating question:", err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to update question.");
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this question?"
    );
    if (!confirmed) return;

    try {
      setError(null);
      setSuccess(null);

      const { error } = await supabase.from("questions").delete().eq("id", id);

      if (error) throw error;

      setQuestions((prev) => prev.filter((q) => q.id !== id));
      if (editingId === id) {
        cancelEdit();
      }
      setSuccess("Question deleted.");
    } catch (err: unknown) {
      console.error("Error deleting question:", err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to delete question.");
      }
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: COLORS.textSecondary }}
      >
        Loading questions...
      </div>
    );
  }

  if (error && !raffle) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm underline"
          style={{ color: COLORS.primary }}
        >
          ← Back
        </button>
        <div
          className="rounded px-4 py-3 text-sm"
          style={{ backgroundColor: "#FEE2E2", color: COLORS.error }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (!raffle) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="text-sm underline mb-2"
            style={{ color: COLORS.primary }}
          >
            ← Back to raffle
          </button>
          <h1
            className="text-2xl md:text-3xl font-bold tracking-tight mb-1"
            style={{ color: COLORS.primary }}
          >
            Questions
          </h1>
          <p className="text-sm" style={{ color: COLORS.textSecondary }}>
            Configure eligibility / skill questions for{" "}
            <span className="font-medium" style={{ color: COLORS.textPrimary }}>
              {raffle.item_name}
            </span>
            .
          </p>
        </div>
      </div>

      {/* Alerts */}
      {success && (
        <div
          className="rounded px-4 py-3 text-sm"
          style={{ backgroundColor: "#DCFCE7", color: COLORS.success }}
        >
          {success}
        </div>
      )}
      {error && (
        <div
          className="rounded px-4 py-3 text-sm"
          style={{ backgroundColor: "#FEE2E2", color: COLORS.error }}
        >
          {error}
        </div>
      )}

      {/* Existing questions */}
      <div
        className="rounded-2xl border"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 12px 32px ${COLORS.cardShadow}`,
        }}
      >
        <div
          className="px-4 py-3 border-b flex items-center justify-between gap-2"
          style={{ borderColor: COLORS.cardBorder }}
        >
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: COLORS.textPrimary }}
            >
              Current questions
            </h2>
            <p className="text-xs mt-1" style={{ color: COLORS.textSecondary }}>
              These questions appear in the app when users join this raffle.
            </p>
          </div>
        </div>

        {questions.length === 0 ? (
          <div className="p-4 text-sm" style={{ color: COLORS.textMuted }}>
            No questions yet. Use the form below to add the first question.
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: COLORS.cardBorder }}>
            {questions
              .slice()
              .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
              .map((q, idx) => {
                const isEditing = editingId === q.id;
                const correct =
                  q.correct_answer === "b"
                    ? "B"
                    : q.correct_answer === "c"
                    ? "C"
                    : "A";

                return (
                  <li
                    key={q.id}
                    className="p-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                  >
                    {/* Left: content */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold"
                          style={{
                            backgroundColor: COLORS.raffleTicketBg,
                            color: COLORS.raffleTicketText,
                          }}
                        >
                          {idx + 1}
                        </span>
                        {!isEditing ? (
                          <span
                            className="font-medium"
                            style={{ color: COLORS.textPrimary }}
                          >
                            {q.question_text}
                          </span>
                        ) : (
                          <input
                            type="text"
                            value={editQuestionText}
                            onChange={(e) =>
                              setEditQuestionText(e.target.value)
                            }
                            className="w-full border rounded px-3 py-2 text-sm"
                            style={{
                              borderColor: COLORS.inputBorder,
                              backgroundColor: COLORS.inputBg,
                              color: COLORS.textPrimary,
                            }}
                          />
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        {!isEditing ? (
                          <>
                            <OptionP
                              label="A"
                              value={q.option_a}
                              isCorrect={q.correct_answer === "a"}
                            />
                            <OptionP
                              label="B"
                              value={q.option_b}
                              isCorrect={q.correct_answer === "b"}
                            />
                            <OptionP
                              label="C"
                              value={q.option_c}
                              isCorrect={q.correct_answer === "c"}
                            />
                          </>
                        ) : (
                          <>
                            <EditOptionInput
                              label="Option A"
                              value={editOptionA}
                              onChange={setEditOptionA}
                            />
                            <EditOptionInput
                              label="Option B"
                              value={editOptionB}
                              onChange={setEditOptionB}
                            />
                            <EditOptionInput
                              label="Option C"
                              value={editOptionC}
                              onChange={setEditOptionC}
                            />
                          </>
                        )}
                      </div>

                      <div className="text-xs">
                        {!isEditing ? (
                          <span style={{ color: COLORS.textSecondary }}>
                            Correct answer:{" "}
                            <span
                              className="font-semibold"
                              style={{ color: COLORS.primary }}
                            >
                              {correct}
                            </span>
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span
                              className="font-medium"
                              style={{ color: COLORS.textSecondary }}
                            >
                              Correct answer:
                            </span>
                            <select
                              value={editCorrect}
                              onChange={(e) =>
                                setEditCorrect(e.target.value as CorrectAnswer)
                              }
                              className="border rounded px-2 py-1 text-xs"
                              style={{
                                borderColor: COLORS.inputBorder,
                                backgroundColor: COLORS.inputBg,
                                color: COLORS.textPrimary,
                              }}
                            >
                              <option value="a">A</option>
                              <option value="b">B</option>
                              <option value="c">C</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: actions */}
                    <div className="flex items-center gap-2 mt-1 md:mt-0 md:flex-col md:items-end">
                      {!isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(q)}
                            className="px-3 py-1.5 rounded-full text-xs font-medium border"
                            style={{
                              borderColor: COLORS.cardBorder,
                              backgroundColor: COLORS.cardBg,
                              color: COLORS.textSecondary,
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(q.id)}
                            className="px-3 py-1.5 rounded-full text-xs font-medium"
                            style={{
                              backgroundColor: "#FEF2F2",
                              color: COLORS.error,
                            }}
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={handleSaveEdit}
                            disabled={savingEdit}
                            className="px-3 py-1.5 rounded-full text-xs font-medium"
                            style={{
                              backgroundColor: COLORS.primaryButtonBg,
                              color: COLORS.primaryButtonText,
                              opacity: savingEdit ? 0.7 : 1,
                            }}
                          >
                            {savingEdit ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-3 py-1.5 rounded-full text-xs font-medium border"
                            style={{
                              borderColor: COLORS.cardBorder,
                              backgroundColor: COLORS.cardBg,
                              color: COLORS.textSecondary,
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </div>

      {/* Add new question */}
      <div
        className="rounded-2xl border p-4 space-y-4"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 12px 32px ${COLORS.cardShadow}`,
        }}
      >
        <h2
          className="text-lg font-semibold"
          style={{ color: COLORS.textPrimary }}
        >
          Add new question
        </h2>

        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <label
              className="font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Question
            </label>
            <input
              type="text"
              value={newQuestionText}
              onChange={(e) => setNewQuestionText(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="Example: What is the capital of Ireland?"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label
                className="font-medium text-xs"
                style={{ color: COLORS.textSecondary }}
              >
                Option A
              </label>
              <input
                type="text"
                value={newOptionA}
                onChange={(e) => setNewOptionA(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
              />
            </div>
            <div className="space-y-1">
              <label
                className="font-medium text-xs"
                style={{ color: COLORS.textSecondary }}
              >
                Option B
              </label>
              <input
                type="text"
                value={newOptionB}
                onChange={(e) => setNewOptionB(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
              />
            </div>
            <div className="space-y-1">
              <label
                className="font-medium text-xs"
                style={{ color: COLORS.textSecondary }}
              >
                Option C
              </label>
              <input
                type="text"
                value={newOptionC}
                onChange={(e) => setNewOptionC(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
              />
            </div>
          </div>

          <div className="space-y-1 text-sm">
            <span
              className="font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Correct answer
            </span>
            <div className="flex items-center gap-3 text-xs">
              {(["a", "b", "c"] as CorrectAnswer[]).map((opt) => (
                <label
                  key={opt}
                  className="inline-flex items-center gap-1 cursor-pointer"
                  style={{ color: COLORS.textPrimary }}
                >
                  <input
                    type="radio"
                    name="newCorrect"
                    value={opt}
                    checked={newCorrect === opt}
                    onChange={() => setNewCorrect(opt)}
                  />
                  <span>{opt.toUpperCase()}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleAddQuestion}
            disabled={savingNew}
            className="px-4 py-2 rounded-full text-sm font-medium"
            style={{
              backgroundColor: COLORS.primaryButtonBg,
              color: COLORS.primaryButtonText,
              opacity: savingNew ? 0.7 : 1,
            }}
          >
            {savingNew ? "Adding..." : "Add question"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionP({
  label,
  value,
  isCorrect,
}: {
  label: string;
  value: string;
  isCorrect: boolean;
}) {
  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{
        backgroundColor: isCorrect ? COLORS.raffleTicketBg : COLORS.altScreenBg,
        borderColor: COLORS.cardBorder,
        borderWidth: 1,
      }}
    >
      <span
        className="text-[0.7rem] font-semibold mr-1"
        style={{ color: COLORS.textSecondary }}
      >
        {label}.
      </span>
      <span className="text-xs" style={{ color: COLORS.textPrimary }}>
        {value}
      </span>
      {isCorrect && (
        <span
          className="ml-2 text-[0.65rem] font-semibold px-1.5 py-0.5 rounded-full"
          style={{
            backgroundColor: COLORS.success,
            color: COLORS.textOnPrimary,
          }}
        >
          Correct
        </span>
      )}
    </div>
  );
}

function EditOptionInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label
        className="font-medium text-xs"
        style={{ color: COLORS.textSecondary }}
      >
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border rounded px-3 py-2 text-sm"
        style={{
          borderColor: COLORS.inputBorder,
          backgroundColor: COLORS.inputBg,
          color: COLORS.textPrimary,
        }}
      />
    </div>
  );
}
