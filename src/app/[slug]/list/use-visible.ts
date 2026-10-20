import { useEffect, useState } from "react";
import type { RefObject } from "react";

// true enquanto o elemento está na tela (com 50 px de folga). Sem IntersectionObserver, sempre true.
export function useVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setVisible(true));
      return;
    }
    const io = new IntersectionObserver((entries) => setVisible(entries[entries.length - 1].isIntersecting), { rootMargin: "50px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return visible;
}
