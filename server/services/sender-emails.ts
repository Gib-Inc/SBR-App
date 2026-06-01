// Map of sender display names → email addresses, used to set the SendGrid
// reply-to header when a Take-Action / vendor-communication / production-
// priority email is sent. The from-address stays at SENDGRID_FROM_EMAIL
// (which has to be a verified sender domain in SendGrid); replyTo lets the
// supplier respond directly to the human who sent the message.
//
// Emails added here are also used as the audit trail's "ordered by"
// signature when Roger's PO-create notification is fired.

export const SENDER_EMAILS: Record<string, string> = {
  Clarence: "clarencerohbock@gmail.com",
  Sammie:   "sammie@stickerburrroller.com",
  Matt:     "gibson.matt27@gmail.com",
  Stacy:    "stacy@stickerburrroller.com",
};

/** Returns the email for a sender name, or null if not on file. */
export function emailForSender(name: string | null | undefined): string | null {
  if (!name) return null;
  return SENDER_EMAILS[name.trim()] ?? null;
}

/**
 * Roger Christensen — owner who needs to know about every PO for accounting
 * follow-up. Hardcoded to a single mailbox; if Roger ever moves we change it
 * here and every PO-create path picks up the new value.
 */
export const ROGER_EMAIL = "rck1967@hotmail.com";
