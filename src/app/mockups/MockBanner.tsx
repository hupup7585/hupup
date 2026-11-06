/** Yellow strip at the top of every mock-up page so it can't be mistaken for the live site. */
export default function MockBanner({ title, note }: { title: string; note: string }) {
  return (
    <div className="bg-hu-yellow px-4 py-3 text-center font-display text-hu-deep">
      <p className="text-base font-extrabold">MOCK-UP FOR REVIEW: {title}</p>
      <p className="text-sm font-medium">{note} The live home page is unchanged.</p>
    </div>
  );
}
