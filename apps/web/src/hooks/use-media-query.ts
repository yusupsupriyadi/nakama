import { useCallback, useSyncExternalStore } from "react";
import { PHONE_MEDIA_QUERY } from "@/lib/breakpoints";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    [query]
  );

  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query]
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Layout decisions that CSS cannot express, such as forcing a panel wide. */
export function usePhoneViewport(): boolean {
  return useMediaQuery(PHONE_MEDIA_QUERY);
}
