import { useCallback, useEffect, useState } from "react";
import type { ToastType } from "../../types";
import deadLetterService, { type DeadLetter } from "../services/deadLetterService";
import feedbackLoopService from "../services/agents/feedbackLoopService";
import agentRunService from "../services/agents/agentRunService";

interface UseDeadLetterInboxProps {
  addToast: (message: string, type?: ToastType) => void;
}

/**
 * Dead-letter queue subscription: failed merges / agent actions / runs surface
 * as Inbox items with retry/discard actions. Extracted from App.tsx as a
 * behavior-neutral wiring block.
 */
export function useDeadLetterInbox({ addToast }: UseDeadLetterInboxProps) {
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([]);
  useEffect(() => deadLetterService.subscribe(setDeadLetters), []);

  const followUp = useCallback(async (runId: string, message: string) => {
    await agentRunService.followUp(runId, message);
  }, []);

  const handleRetryDeadLetter = useCallback(
    (id: string) => {
      void deadLetterService.retry(id).then(({ ok, error }) => {
        if (ok) addToast("Retry succeeded.", "success");
        else addToast(error ?? "Retry failed.", "error");
      });
    },
    [addToast],
  );

  const handleDiscardDeadLetter = useCallback(
    (id: string) => {
      deadLetterService.discard(id);
      addToast("Dead letter discarded.", "info");
    },
    [addToast],
  );

  const handleResolveMergeWithAgent = useCallback(
    (id: string) => {
      const letter = deadLetterService.getById(id);
      if (!letter || letter.kind !== "merge") {
        addToast("Merge dead letter not found.", "error");
        return;
      }
      void feedbackLoopService
        .resolveMergeConflictWithAgent(letter, followUp)
        .then(() => addToast("Conflict repair run started — re-merge follows on completion.", "info"))
        .catch((err) =>
          addToast(err instanceof Error ? err.message : "Could not start conflict repair.", "error"),
        );
    },
    [addToast, followUp],
  );

  const handleSendDeadLetterToAgent = useCallback(
    (id: string) => {
      const letter = deadLetterService.getById(id);
      if (!letter) {
        addToast("Dead letter not found.", "error");
        return;
      }
      const action =
        letter.kind === "ci"
          ? feedbackLoopService.sendCiFailureToAgent(letter, followUp)
          : letter.kind === "review"
            ? feedbackLoopService.sendReviewCommentsToAgent(letter, followUp)
            : Promise.reject(new Error(`Unsupported kind: ${letter.kind}`));
      void action
        .then(() => addToast("Sent context to agent.", "success"))
        .catch((err) =>
          addToast(err instanceof Error ? err.message : "Could not send to agent.", "error"),
        );
    },
    [addToast, followUp],
  );

  return {
    deadLetters,
    handleRetryDeadLetter,
    handleDiscardDeadLetter,
    handleResolveMergeWithAgent,
    handleSendDeadLetterToAgent,
  };
}
