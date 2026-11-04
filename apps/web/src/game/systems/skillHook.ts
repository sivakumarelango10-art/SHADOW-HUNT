/** The skill-check HUD registers itself here so the input loop can route presses to it. */
export const skillCheckHook = {
  handle: (): boolean => false,
};
