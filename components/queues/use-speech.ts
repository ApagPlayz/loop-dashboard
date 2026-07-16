"use client";

/**
 * Thin wrapper around the browser's Web Speech API (voice dictation) for the
 * custom-idea composer. One recognition instance is shared across all the
 * fields on the composer; `toggle(targetId, onFinal)` starts dictating into a
 * field (or stops it if that field is already the one listening).
 *
 * Final transcript chunks are handed to the caller's `onFinal` so it can append
 * them to whatever field is bound; interim (not-yet-final) text is exposed via
 * `interim` so the field can show it lightly while the owner is still talking.
 *
 * Unsupported browsers report `supported: false` so the UI can explain that
 * Chrome and Safari work. A denied mic permission surfaces a plain message.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal typings for the (still non-standard) Web Speech API. */
type SpeechRecognitionAlternative = { transcript: string };
type SpeechRecognitionResult = {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
};
type SpeechRecognitionResultList = {
  length: number;
  [index: number]: SpeechRecognitionResult;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};
type SpeechRecognitionErrorEventLike = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type UseSpeech = {
  /** Whether this browser supports voice dictation at all. */
  supported: boolean;
  /** The id of the field currently being dictated into, or null. */
  listeningTarget: string | null;
  /** Interim (not-yet-final) text for the active field. */
  interim: string;
  /** A plain-English error (e.g. mic permission denied), or null. */
  error: string | null;
  /** Start dictating into `targetId`, or stop if it's already listening. */
  toggle: (targetId: string, onFinal: (text: string) => void) => void;
  /** Stop any active dictation. */
  stop: () => void;
};

export function useSpeech(): UseSpeech {
  const [supported, setSupported] = useState(false);
  const [listeningTarget, setListeningTarget] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef<((text: string) => void) | null>(null);
  // Track the target in a ref so the onend handler reads the current value.
  const targetRef = useRef<string | null>(null);

  useEffect(() => {
    // Defer so we don't call setState synchronously inside the effect body.
    const t = setTimeout(() => setSupported(getRecognitionCtor() !== null), 0);
    return () => {
      clearTimeout(t);
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const stop = useCallback(() => {
    targetRef.current = null;
    setInterim("");
    setListeningTarget(null);
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(
    (targetId: string, onFinal: (text: string) => void) => {
      // Clicking the mic on the field that's already listening turns it off.
      if (targetRef.current === targetId) {
        stop();
        return;
      }

      const Ctor = getRecognitionCtor();
      if (!Ctor) {
        setError("Voice input isn't supported in this browser — Chrome and Safari work.");
        return;
      }

      // Switching fields: tear down the old instance first.
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }

      setError(null);
      setInterim("");
      onFinalRef.current = onFinal;
      targetRef.current = targetId;

      const rec = new Ctor();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;

      rec.onresult = (e) => {
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) {
            const trimmed = text.trim();
            if (trimmed) onFinalRef.current?.(trimmed);
          } else {
            interimText += text;
          }
        }
        setInterim(interimText);
      };

      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setError(
            "Microphone access was blocked. Allow the mic for this site in your browser, then try again.",
          );
        } else if (e.error === "no-speech") {
          setError("Didn't catch anything — try speaking again.");
        } else if (e.error !== "aborted") {
          setError("Voice input stopped unexpectedly. Try again.");
        }
        targetRef.current = null;
        setInterim("");
        setListeningTarget(null);
      };

      rec.onend = () => {
        // Ended (naturally or via stop): clear listening state if this is still
        // the active recognition.
        setInterim("");
        if (targetRef.current === targetId) {
          targetRef.current = null;
          setListeningTarget(null);
        }
      };

      recognitionRef.current = rec;
      try {
        rec.start();
        setListeningTarget(targetId);
      } catch {
        setError("Couldn't start voice input. Try again.");
        targetRef.current = null;
        setListeningTarget(null);
      }
    },
    [stop],
  );

  return { supported, listeningTarget, interim, error, toggle, stop };
}
