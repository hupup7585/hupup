"use client";

/**
 * The two text-consent boxes (Abraham, approved): separate, both unchecked by default, with the approved
 * /text-alerts wording and links to the SMS Terms and Privacy Policy. Neither is required.
 */
export default function TextConsentBoxes({
  transactionalText,
  marketingText,
  transactional,
  marketing,
  onChange,
  smsNumber,
  staff = false,
}: {
  transactionalText: string;
  marketingText: string;
  transactional: boolean;
  marketing: boolean;
  onChange: (v: { transactional: boolean; marketing: boolean }) => void;
  smsNumber: string;
  staff?: boolean;
}) {
  const box = (checked: boolean, set: (v: boolean) => void, text: string, name: string) => (
    <label className="flex items-start gap-3 text-sm leading-relaxed" data-consent-box={name}>
      <input type="checkbox" name={name} checked={checked} onChange={(e) => set(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-hu-deep" />
      <span>{text}</span>
    </label>
  );
  return (
    <fieldset className="space-y-3 rounded-xl border border-hu-deep/15 p-4" data-text-consent>
      <legend className="px-1 text-sm font-bold">Text messages (optional)</legend>
      {staff && <p className="text-xs text-muted">Read each box to the customer. Check a box only if they say yes. Neither is needed to book.</p>}
      {box(transactional, (v) => onChange({ transactional: v, marketing }), transactionalText, "smsTransactional")}
      {box(marketing, (v) => onChange({ transactional, marketing: v }), marketingText, "smsMarketing")}
      <p className="text-sm">
        Text HELP to {smsNumber} for help. Text STOP to opt out. See our{" "}
        <a href="/sms-terms" target="_blank" rel="noopener" className="font-semibold underline underline-offset-4">
          SMS Terms
        </a>{" "}
        and{" "}
        <a href="/privacy" target="_blank" rel="noopener" className="font-semibold underline underline-offset-4">
          Privacy Policy
        </a>
        .
      </p>
    </fieldset>
  );
}
