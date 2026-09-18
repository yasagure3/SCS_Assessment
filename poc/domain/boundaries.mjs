// Local proof of domain rules; this module is not an authentication provider.
import { createHash } from 'node:crypto';

export class RuleError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new RuleError(code); };
export function authorize(principal, customerId) {
  if (!principal?.authenticated || !principal.mfaComplete) fail('UNAUTHENTICATED');
  if (!principal.active) fail('FORBIDDEN');
  if (principal.role === 'admin') return true;
  if (principal.role !== 'staff' || !principal.customerIds.includes(customerId)) fail('NOT_FOUND');
  return true;
}
export function count(rows) {
  const counts = { yes: 0, uncertain: 0, no: 0, unanswered: 0 };
  for (const row of rows) {
    if (!Object.hasOwn(counts, row.status)) fail('INVALID_STATUS');
    counts[row.status]++;
  }
  return counts;
}
export function revise(document, expectedVersion, change) {
  if (document.version !== expectedVersion) fail('CONFLICT');
  const next = structuredClone(document);
  const row = next.rows.find(r => r.id === change.id);
  if (!row) fail('UNKNOWN_CRITERION');
  row.status = change.status;
  row.reason = change.reason;
  row.reviewRevision++;
  count(next.rows);
  next.version++;
  return next;
}
export function reviseScope(document, expectedVersion, scope) {
  if (document.version !== expectedVersion) fail('CONFLICT');
  const next = structuredClone(document);
  next.scope = structuredClone(scope);
  for (const row of next.rows) row.reviewRevision++;
  next.version++;
  return next;
}
export function reviseEvidence(document, expectedVersion, id, confirmed) {
  if (document.version !== expectedVersion) fail('CONFLICT');
  const next = structuredClone(document);
  const row = next.rows.find(r => r.id === id);
  if (!row) fail('UNKNOWN_CRITERION');
  row.evidenceConfirmed = confirmed;
  row.reviewRevision++;
  next.version++;
  return next;
}
export function snapshot(document) {
  if (!['company', 'sites', 'departments', 'systems'].every(k => document.scope[k]?.trim())) fail('MISSING_SCOPE');
  return {
    version: document.version,
    scope: structuredClone(document.scope),
    counts: count(document.rows),
    tasks: structuredClone(document.tasks ?? []),
    rows: document.rows.map(r => ({
      id: r.id, status: r.status, reason: r.reason,
      evidenceConfirmed: r.evidenceConfirmed,
      advice: r.confirmed?.reviewRevision === r.reviewRevision ? r.confirmed.text : null,
      adviceState: r.confirmed?.reviewRevision === r.reviewRevision ? 'confirmed' : 'unconfirmed',
    })),
  };
}
export function inputDigest(requirement, sanitizedText) {
  return createHash('sha256').update(JSON.stringify({ requirement, sanitizedText })).digest('hex');
}
export function buildAiRequest(officialRequirement, form) {
  if (!form.reviewed || form.reviewedDigest !== inputDigest(officialRequirement, form.sanitizedText)) fail('INPUT_REVIEW_REQUIRED');
  if (typeof form.sanitizedText !== 'string' || form.sanitizedText.length > 4000 || !form.sanitizedText.trim()) fail('INVALID_INPUT');
  // A small detection aid, never a claim of perfect anonymization.
  if (/https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(form.sanitizedText)) fail('POSSIBLE_IDENTIFIER');
  return { requirement: officialRequirement, situation: form.sanitizedText };
}
