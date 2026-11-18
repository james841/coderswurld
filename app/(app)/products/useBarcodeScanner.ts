"use client";

import { useEffect, useRef } from "react";

/**
 * Hear a hardware barcode scanner.
 *
 * A keyboard-wedge scanner — the kind every Nigerian supermarket already owns —
 * is just a keyboard that types the code impossibly fast and finishes with Enter.
 * This hook watches the whole document for that signature: a burst of keystrokes
 * closed by Enter, with gaps far shorter than human fingers can produce. When it
 * sees one, it hands the decoded string to `onScan` and swallows the Enter so it
 * can't submit a form by accident.
 *
 * The timing test is the whole point. Without it, this would fire on every Enter
 * a cashier presses and hijack ordinary typing. With it, a person typing a
 * barcode by hand into the search box is left completely alone — their gaps are
 * tens of times too slow — and only a real scan triggers the jump.
 *
 * We don't preventDefault the character keys, only the closing Enter, so if the
 * scan lands while an input is focused the digits still fill that input (scanning
 * straight into the barcode field is exactly what you want). The callback fires
 * as well; set the two to the same value and nothing fights.
 */
export function useBarcodeScanner(
  onScan: (code: string) => void,
  options: { minLength?: number; maxInterKeyMs?: number; enabled?: boolean } = {},
) {
  const { minLength = 4, maxInterKeyMs = 35, enabled = true } = options;

  // Keep the latest callback without re-subscribing the listener every render.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const buffer = useRef("");
  const lastTime = useRef(0);
  // True while every gap in the current burst has been scanner-fast.
  const fast = useRef(true);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      // A chord (Ctrl+C, ⌘V) is never a scan — don't let it poison the buffer.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const now = performance.now();
      const gap = now - lastTime.current;
      lastTime.current = now;

      if (event.key === "Enter") {
        const code = buffer.current;
        const wasFast = fast.current;
        buffer.current = "";
        fast.current = true;
        if (wasFast && code.length >= minLength) {
          // A real scan — claim the Enter and report the code.
          event.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      // Only printable single characters are part of a barcode.
      if (event.key.length !== 1) return;

      if (buffer.current === "") {
        // First character of a fresh burst — start optimistic.
        fast.current = true;
      } else if (gap > maxInterKeyMs) {
        // Too slow between keys to be a machine: this is a person typing.
        fast.current = false;
      }
      buffer.current += event.key;
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, minLength, maxInterKeyMs]);
}
