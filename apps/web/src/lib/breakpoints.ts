/**
 * Tailwind's `sm`. Below it the shell hides the profile rail and the sidebar
 * and moves them into the mobile navigation drawer.
 */
export const SM_BREAKPOINT_PX = 640;

/** True on phone-sized viewports, matching the shell's `max-sm:` styles. */
export const PHONE_MEDIA_QUERY = `(max-width: ${SM_BREAKPOINT_PX - 0.02}px)`;
