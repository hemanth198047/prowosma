/**
 * Turns a failed axios request into a message that is safe to show a person.
 *
 * The backend answers errors in two different shapes:
 *   - GlobalExceptionHandler:  { error: "INVALID_CREDENTIALS", message: "Invalid email or password" }
 *       → `error` is a machine CODE, `message` is the human text.
 *   - Inline controller replies: { error: "Invitation has expired" }
 *       → `error` IS the human text and there is no `message`.
 *
 * Reading `error` first (a common pattern in this codebase) shows people the raw
 * code in the first shape. So: prefer `message`, and only fall back to `error`
 * when it reads like a sentence rather than an ALL_CAPS code. Anything else gets
 * the caller's own fallback.
 */
const MACHINE_CODE = /^[A-Z][A-Z0-9_]*$/;

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function apiErrorMessage(err, fallback = "Something went wrong. Please try again.") {
  const data = err?.response?.data;
  const message = clean(data?.message);
  if (message) return message;
  const error = clean(data?.error);
  if (error && !MACHINE_CODE.test(error)) return error;
  return fallback;
}
