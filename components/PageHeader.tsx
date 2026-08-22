export default function PageHeader({
  eyebrow,
  title,
  deck,
}: {
  eyebrow: string;
  title: React.ReactNode;
  deck?: string;
}) {
  return (
    <div className="container pb-4 pt-32 md:pt-40">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="h-section">{title}</h1>
      {deck && <p className="mt-6 max-w-2xl text-lg text-white/70 md:text-xl">{deck}</p>}
    </div>
  );
}
