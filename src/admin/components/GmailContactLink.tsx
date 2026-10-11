import { buildGmailComposeUrl, buildSupportEmailBody, buildSupportEmailSubject } from '../emailContact';

export type GmailContactLinkProps = {
  email: string | null | undefined;
  customerName: string;
  subject?: string | null;
};

/**
 * A single, direct link -- unlike WhatsAppContactButton, there is no
 * intermediate editable panel here: the message stays fully editable inside
 * Gmail's own compose window once opened, so there is nothing for this admin
 * UI to pre-review. Renders nothing when there is no email or it does not
 * look like a real address, never a broken link.
 */
export function GmailContactLink({ email, customerName, subject }: GmailContactLinkProps) {
  if (!email) return null;

  const url = buildGmailComposeUrl(email, buildSupportEmailSubject(subject), buildSupportEmailBody(customerName));
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-900"
    >
      Contactar por Gmail
    </a>
  );
}
