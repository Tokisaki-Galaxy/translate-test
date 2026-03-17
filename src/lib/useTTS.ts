"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Regex to strip leading index numbers/letters like "1. ", "A. ", "1) " */
const INDEX_PREFIX_RE = /^([A-Za-z0-9]+[.)\s]+)+/;

export function cleanTTSText(text: string): string {
  return text.replace(INDEX_PREFIX_RE, "").trim();
}

export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function useTTS(voiceURI: string, rate: number) {
  const [playingId, setPlayingId] = useState<number | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Cancel any ongoing speech on unmount
  useEffect(() => {
    return () => {
      if (isTTSSupported()) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const stop = useCallback(() => {
    if (isTTSSupported()) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setPlayingId(null);
  }, []);

  const speak = useCallback(
    (id: number, text: string) => {
      if (!isTTSSupported()) return;

      // Toggle off if already playing this sentence
      if (playingId === id) {
        stop();
        return;
      }

      // Stop any current speech
      window.speechSynthesis.cancel();

      const cleaned = cleanTTSText(text);
      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.rate = rate;

      // Set voice if specified
      if (voiceURI) {
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find((v) => v.voiceURI === voiceURI);
        if (voice) utterance.voice = voice;
      }

      utterance.onend = () => {
        setPlayingId((prev) => (prev === id ? null : prev));
        utteranceRef.current = null;
      };
      utterance.onerror = () => {
        setPlayingId((prev) => (prev === id ? null : prev));
        utteranceRef.current = null;
      };

      utteranceRef.current = utterance;
      setPlayingId(id);
      window.speechSynthesis.speak(utterance);
    },
    [playingId, rate, voiceURI, stop],
  );

  return { playingId, speak, stop };
}
