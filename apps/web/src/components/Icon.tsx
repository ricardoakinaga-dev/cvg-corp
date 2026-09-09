export type IconName = "grid" | "calendar" | "paw" | "stethoscope" | "box" | "wallet" | "spark" | "settings" | "search" | "bell" | "arrow" | "lock" | "check" | "alert" | "close" | "plus" | "refresh";

const paths: Record<IconName, string> = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  calendar: "M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z",
  paw: "M8 11c-2 0-4 1.8-4 4 0 1.8 1.2 3 3 3 1.2 0 2-.7 3-1 1 .3 1.8 1 3 1 1.8 0 3-1.2 3-3 0-2.2-2-4-4-4-1.1 0-1.8.4-2 1-.2-.6-.9-1-2-1zM7 8c1 0 1.5-1 1.2-2.1C8 4.8 7.2 4 6.3 4S5 4.8 5.3 5.9C5.5 7 6 8 7 8zm10 0c1 0 1.5-1 1.7-2.1C19 4.8 18.2 4 17.3 4s-1.7.8-1.2 1.9C16.3 7 17 8 17 8zm-6-1c1 0 1.7-1 1.7-2.2S12 2.5 11 2.5 9.3 3.6 9.3 4.8 10 7 11 7z",
  stethoscope: "M6 3v5a5 5 0 0010 0V3M4 3h4M14 3h4M16 13v2a4 4 0 004 4h0M20 19a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0",
  box: "M4 7l8-4 8 4-8 4-8-4zm0 0v10l8 4 8-4V7M12 11v10M8 5l8 4",
  wallet: "M4 6a2 2 0 012-2h12v4H6a2 2 0 000 4h14v6H6a2 2 0 01-2-2V6zm14 6h2v3h-2a1.5 1.5 0 010-3z",
  spark: "M12 2l1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5L12 2zm7 14l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16z",
  settings: "M12 8a4 4 0 100 8 4 4 0 000-8zm8.5 4a6.5 6.5 0 01-.1 1l1.7 1.3-2 3.4-2-.8a7.4 7.4 0 01-1.8 1l-.3 2.1h-4l-.3-2.1a7.4 7.4 0 01-1.8-1l-2 .8-2-3.4L5.6 13a6.5 6.5 0 010-2L3.9 9.7l2-3.4 2 .8a7.4 7.4 0 011.8-1L10 4h4l.3 2.1a7.4 7.4 0 011.8 1l2-.8 2 3.4-1.7 1.3c.1.3.1.7.1 1z",
  search: "M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM16 16l5 5",
  bell: "M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  arrow: "M5 12h14m-6-6l6 6-6 6",
  lock: "M6 10V8a6 6 0 0112 0v2M5 10h14v10H5V10z",
  check: "M5 12l4 4L19 6",
  alert: "M12 4l9 16H3L12 4zm0 5v5m0 3h.01",
  close: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  refresh: "M20 11a8 8 0 00-14.9-3M4 5v4h4M4 13a8 8 0 0014.9 3M20 19v-4h-4"
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
