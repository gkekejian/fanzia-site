import MotionSection from "../MotionSection";
import { events } from "@/content/events";

export default function Community() {
  return (
    <MotionSection className="section bg-brand-ink text-white">
      <div className="container">
        <p className="eyebrow">Community</p>
        <h2 className="h-section">Organized Play at Fanzia Glendale</h2>

        <ul className="mt-12 grid gap-6 md:grid-cols-2">
          {events.map((event) => (
            <li key={event.title} className="card-dark">
              <h3 className="font-display text-2xl uppercase leading-tight text-white">
                {event.title}
              </h3>
              <p className="mt-2 font-display text-xs uppercase tracking-[0.2em] text-brand-red">
                {event.cadence}
              </p>
              <p className="mt-4 text-white/70">{event.description}</p>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-sm text-white/50">
          {/* {{TODO: organized play schedule}} */}
          Event schedule pending confirmation &mdash; check back or contact
          the store for the current calendar.
        </p>
      </div>
    </MotionSection>
  );
}
