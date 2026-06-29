interface FaqItem {
  question: string;
  answer: string;
}

interface FormatFAQProps {
  items: FaqItem[];
}

export function FormatFAQ({ items }: FormatFAQProps) {
  return (
    <section className="mt-10 space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">FAQ</h2>
      <div className="space-y-3">
        {items.map((item) => (
          <details key={item.question} className="rounded-2xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer font-medium text-slate-800">{item.question}</summary>
            <p className="mt-3 text-sm leading-6 text-slate-600">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
