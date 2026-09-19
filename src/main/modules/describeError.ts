// Turns whatever was thrown into a string worth showing a user.
//
// Shared so the nine bot modules extract a message identically. They all used to
// swallow the error with a bare `catch {}`, which is why a failed bot could only
// say "error" and never why.
export function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'Unknown error'
}
