export type PreferenceClaim = {
  claim_status?: string;
  preference_id?: string;
  checkout_url?: string;
};

export type PreferenceGateway = {
  claim: (leaseToken: string) => Promise<PreferenceClaim | null>;
  complete: (leaseToken: string, preferenceId: string, checkoutUrl: string) => Promise<PreferenceClaim | null>;
  fail: (leaseToken: string) => Promise<void>;
};

export type PreferenceProvider = {
  create: () => Promise<{ id?: string; checkoutUrl?: string }>;
};

export type PreferenceResult =
  | { status: 'ready'; preferenceId: string; checkoutUrl: string }
  | { status: 'processing' | 'reconciliation_required' | 'failed' };

// The database lease is acquired and completed in separate short transactions.
// The provider call is intentionally outside of any SQL transaction.
export async function createOrReusePreference(
  gateway: PreferenceGateway,
  provider: PreferenceProvider,
  leaseToken: string,
): Promise<PreferenceResult> {
  const claim = await gateway.claim(leaseToken);
  if (claim?.claim_status === 'ready' && claim.preference_id && claim.checkout_url) {
    return { status: 'ready', preferenceId: claim.preference_id, checkoutUrl: claim.checkout_url };
  }
  if (claim?.claim_status === 'processing' || claim?.claim_status === 'reconciliation_required') {
    return { status: claim.claim_status };
  }
  if (claim?.claim_status !== 'claimed') return { status: 'failed' };

  try {
    const created = await provider.create();
    if (!created.id || !created.checkoutUrl) throw new Error('provider preference response incomplete');
    const completed = await gateway.complete(leaseToken, created.id, created.checkoutUrl);
    if (completed?.claim_status !== 'ready' || !completed.preference_id || !completed.checkout_url) throw new Error('preference completion failed');
    return { status: 'ready', preferenceId: completed.preference_id, checkoutUrl: completed.checkout_url };
  } catch {
    // A timed-out provider request is ambiguous. Preserve the reservation and
    // require a controlled reconciliation instead of creating a second one.
    try { await gateway.fail(leaseToken); } catch { /* preserve generic provider failure */ }
    return { status: 'failed' };
  }
}
