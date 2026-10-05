// Basic email shape check — good enough to gate a submit button and show
// inline feedback without being overly strict about valid TLDs.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
