import { useEffect, useRef, useState } from 'react';

export function useThrottledMessages<T>(messages: T, intervalMs = 80): T {
  const [displayedMessages, setDisplayedMessages] = useState(messages);
  const latestMessages = useRef(messages);
  const lastFlushAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    latestMessages.current = messages;
    const flush = () => {
      timer.current = undefined;
      lastFlushAt.current = performance.now();
      setDisplayedMessages(latestMessages.current);
    };
    const elapsed = performance.now() - lastFlushAt.current;
    if (!timer.current && elapsed >= intervalMs) {
      flush();
    } else if (!timer.current) {
      timer.current = setTimeout(flush, Math.max(0, intervalMs - elapsed));
    }
  }, [intervalMs, messages]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return displayedMessages;
}
