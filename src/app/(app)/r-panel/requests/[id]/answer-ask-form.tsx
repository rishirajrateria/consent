"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { answerAskAction } from "../actions";

const fileInputCls =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

/** The file types storage accepts (lib/storage.ts mimeAllowed), so a refused file is caught before sending. */
const ALLOWED_PREFIXES = ["image/", "video/", "audio/", "application/pdf", "text/plain"];
const ALLOWED_EXACT = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
];
const ACCEPT = [
  "image/*",
  "video/*",
  "audio/*",
  "application/pdf",
  "text/plain",
  ...ALLOWED_EXACT,
  ".pdf",
  ".txt",
  ".doc",
  ".docx",
  ".zip",
].join(",");

function typeAllowed(mime: string) {
  return ALLOWED_PREFIXES.some((p) => mime.startsWith(p)) || ALLOWED_EXACT.includes(mime);
}

const PREFIX = "answer-ask:";
const draftKey = (requestId: string, askedAt: string) => `${PREFIX}${requestId}:${askedAt}`;

type Draft = { answer: string; creativePlan: string };

function readDraft(key: string): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return { answer: String(d.answer ?? ""), creativePlan: String(d.creativePlan ?? "") };
  } catch {
    return null;
  }
}

/** Drops drafts kept for this request: all of them, or all but the one for the open question. */
function dropDrafts(requestId: string, keep?: string) {
  try {
    const store = window.sessionStorage;
    const mine = Array.from({ length: store.length }, (_, i) => store.key(i)).filter(
      (k): k is string => !!k && k.startsWith(`${PREFIX}${requestId}:`) && k !== keep,
    );
    for (const k of mine) store.removeItem(k);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/**
 * The written answer to the owner's Ask, with an optional plan update and new
 * final file. What is typed is kept in this tab until the answer is sent, so a
 * refused file or a failed send never loses it.
 */
export function AnswerAskForm({
  requestId,
  askedAt,
  creativePlan,
  minPlanChars,
  maxUploadMb,
  hasRaw,
}: {
  requestId: string;
  /** ISO time of the open question: a new question starts a fresh draft. */
  askedAt: string;
  creativePlan: string;
  minPlanChars: number;
  maxUploadMb: number;
  hasRaw: boolean;
}) {
  const key = draftKey(requestId, askedAt);
  const [answer, setAnswer] = useState("");
  const [plan, setPlan] = useState(creativePlan);
  const [planOpen, setPlanOpen] = useState(false);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const restored = useRef(false);

  // Bring back what was typed before a failed send or a reload.
  useEffect(() => {
    dropDrafts(requestId, key);
    const d = readDraft(key);
    restored.current = true;
    if (!d) return;
    /* eslint-disable react-hooks/set-state-in-effect -- sessionStorage is only readable after mount */
    if (d.answer) setAnswer(d.answer);
    if (d.creativePlan && d.creativePlan !== creativePlan) {
      setPlan(d.creativePlan);
      setPlanOpen(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [requestId, key, creativePlan]);

  function save(next: Draft) {
    if (!restored.current) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage blocked: the answer still sends, it just isn't kept.
    }
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    let problem: string | null = null;
    if (file && file.size > maxUploadMb * 1024 * 1024) {
      problem = `This file is over ${maxUploadMb} MB. Choose a smaller one.`;
    } else if (file && file.size > 0 && !typeAllowed(file.type || "application/octet-stream")) {
      problem = "This file type can't be uploaded. Use an image, video, audio, PDF, text, Word or zip file.";
    }
    if (problem) input.value = "";
    setFileProblem(problem);
  }

  return (
    <form action={answerAskAction} className="space-y-4">
      <input type="hidden" name="id" value={requestId} />
      <Field label="Your answer" required>
        <Textarea
          name="answer"
          required
          maxLength={4000}
          className="min-h-28"
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value);
            save({ answer: e.target.value, creativePlan: plan });
          }}
        />
      </Field>
      <details className="group space-y-3" open={planOpen} onToggle={(e) => setPlanOpen(e.currentTarget.open)}>
        <summary className="flex min-h-10 cursor-pointer list-none items-center text-sm font-medium underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
          Update your plan (optional)
        </summary>
        <Field
          label="Creative plan & intent"
          hint={`Change it only if their question needs it. At least ${minPlanChars} characters.`}
        >
          <Textarea
            name="creativePlan"
            minLength={minPlanChars}
            className="min-h-32"
            value={plan}
            onChange={(e) => {
              setPlan(e.target.value);
              save({ answer, creativePlan: e.target.value });
            }}
          />
        </Field>
      </details>
      <Field
        label="New final file (optional)"
        hint={`${hasRaw ? "Replaces your current final file as a new version." : "The raw final content, exactly as it will be published."} Up to ${maxUploadMb} MB.`}
      >
        <Input
          name="file"
          type="file"
          accept={ACCEPT}
          className={fileInputCls}
          onChange={onFile}
          aria-invalid={fileProblem ? true : undefined}
          aria-describedby={fileProblem ? "answer-file-problem" : undefined}
        />
      </Field>
      {fileProblem && (
        <p id="answer-file-problem" role="alert" className="text-sm font-medium text-ink">
          {fileProblem}
        </p>
      )}
      <SubmitButton>Send answer</SubmitButton>
    </form>
  );
}

/** Clears the kept answer once it has been sent. */
export function ClearAnswerDraft({ requestId }: { requestId: string }) {
  useEffect(() => dropDrafts(requestId), [requestId]);
  return null;
}
