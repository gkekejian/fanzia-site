import MotionSection from "../MotionSection";
import { events } from "@/content/events";

// Only events with real copy render. The placeholder entry in
// content/events.ts was rendering "{{TODO: event name...}}" on the live
// homepage. No events = no section (better than an empty promise).
const liveEvents = events.filter((e) => !/\{\{TODO/.test(`${e.title}${e.cadence}${e.description}`));

export default function Community() {
  if (liveEvents.length === 0) return null;
  return (
    <MotionSection className="section bg-brand-ink text-white">
      <div className="container">
        <p className="eyebrow">Community</p>
        <h2 className="h-section">Organized Play at Fanzia Glendale</h2>
        <ul className="mt-12 grid gap-6 md:grid-cols-2">
          {liveEvents.map((event) => (
            <li key={event.title} className="card-dark">
              <h3 className="font-display text-2xl uppercase leading-tight text-white">{event.title}</h3>
              <p className="mt-2 font-display text-xs uppercase tracking-[0.2em] text-brand-red">{event.cadence}</p>
              <p className="mt-4 text-white/70">{event.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </MotionSection>
  );
}
