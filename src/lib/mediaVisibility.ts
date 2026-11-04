
export type MediaPostVisibility = {
  hidden?: boolean | null;
  squad_code?: string | null;
};

/** Public feed items must not be hidden or belong to a private squad. */
export function isPublicMediaPost(post: MediaPostVisibility | null | undefined): boolean {
  return !!post && post.hidden !== true && String(post.squad_code || "") === "";
}

/**
 * A private squad post may be streamed only when the caller presents the
 * exact squad code. The code acts as the existing bearer access token.
 */
export function canAccessMediaPost(
  post: MediaPostVisibility | null | undefined,
  suppliedSquadCode: string | null | undefined,
): boolean {
  if (!post || post.hidden === true) return false;
  return String(post.squad_code || "") === String(suppliedSquadCode || "");
}
