/** Consent wording, with "SMS Terms" and "Privacy Policy" in its last sentence as links to the live pages. */
export default function ConsentText({ text, newTab = false }: { text: string; newTab?: boolean }) {
  const tail = "See our SMS Terms and Privacy Policy.";
  if (!text.endsWith(tail)) return <>{text}</>;
  const t = newTab ? { target: "_blank", rel: "noopener" } : {};
  return (
    <>
      {text.slice(0, -tail.length)}See our{" "}
      <a href="/sms-terms" {...t} className="font-semibold underline underline-offset-4">
        SMS Terms
      </a>{" "}
      and{" "}
      <a href="/privacy" {...t} className="font-semibold underline underline-offset-4">
        Privacy Policy
      </a>
      .
    </>
  );
}
