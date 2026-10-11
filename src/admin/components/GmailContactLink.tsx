import { Mail } from 'lucide-react';

import { buildGmailComposeUrl, buildSupportEmailBody, buildSupportEmailSubject } from '../emailContact';
import { AdminIconButton } from './AdminIconButton';

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
 * look like a real address, never a broken link. Icon-only (envelope, not
 * Gmail's own branding/colors -- avoids any logo licensing concern), same
 * tooltip/compactness treatment as WhatsAppContactButton next to it.
 */
export function GmailContactLink({ email, customerName, subject }: GmailContactLinkProps) {
  if (!email) return null;

  const url = buildGmailComposeUrl(email, buildSupportEmailSubject(subject), buildSupportEmailBody(customerName));
  if (!url) return null;

  return (
    <AdminIconButton
      icon={Mail}
      label="Contactar por Gmail"
      tone="neutral"
      size="sm"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    />
  );
}
