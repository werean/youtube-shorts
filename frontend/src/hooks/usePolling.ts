import { useRef, useEffect } from "react";

/**
 * Hook for managing polling intervals with cleanup
 */
export function usePolling() {
  const pollRef = useRef<number | null>(null);

  const startPolling = (callback: () => void | Promise<void>, interval: number) => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
    }
    void callback();
    pollRef.current = window.setInterval(() => {
      void callback();
    }, interval);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const isPolling = () => pollRef.current !== null;

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
      }
    };
  }, []);

  return { startPolling, stopPolling, isPolling };
}

/**
 * Hook for auto-scrolling to bottom when content changes
 */
export function useAutoScroll(deps: any[]) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, deps);

  return containerRef;
}
