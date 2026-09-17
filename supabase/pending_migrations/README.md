# Pending migrations

Files in this directory are deliberately excluded from `supabase db push`.

`202609110107_retire_legacy_payment_rpcs.sql` must **not** be moved to
`supabase/migrations` or applied until every deployed backend instance is using
the atomic payment RPC introduced by migration 106. Applying it earlier removes
the two RPCs required by an older backend during a rolling deployment.
