"use client";
import { useRef, useState, useEffect } from "react";
export function useDialog() {
  const [question, setQuestion] = useState<{
    title: string;
    value: string;
    confirm: boolean;
  } | null>(null);
  const resolve = useRef<((value: string | null) => void) | null>(null),
    ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (question && !ref.current?.open) ref.current?.showModal();
  }, [question]);
  const ask = (title: string, value = "", confirm = false) =>
    new Promise<string | null>((done) => {
      resolve.current = done;
      setQuestion({ title, value, confirm });
    });
  const close = (value: string | null) => {
    ref.current?.close();
    setQuestion(null);
    resolve.current?.(value);
    resolve.current = null;
  };
  return {
    prompt: (title: string, value = "") => ask(title, value),
    confirm: async (title: string) => (await ask(title, "", true)) !== null,
    dialog: question ? (
      <dialog
        ref={ref}
        className="question-dialog"
        onCancel={(e) => {
          e.preventDefault();
          close(null);
        }}
        aria-labelledby="dialog-title"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close(question.value);
          }}
        >
          <h2 id="dialog-title">{question.title}</h2>
          {!question.confirm && (
            <textarea
              autoFocus
              aria-label={question.title}
              value={question.value}
              rows={question.value.length > 150 ? 7 : 2}
              onChange={(e) =>
                setQuestion({ ...question, value: e.target.value })
              }
            />
          )}
          <div className="actions">
            <button type="button" onClick={() => close(null)}>
              Cancel
            </button>
            <button type="submit" className="primary">
              {question.confirm ? "Confirm" : "Continue"}
            </button>
          </div>
        </form>
      </dialog>
    ) : null,
  };
}
