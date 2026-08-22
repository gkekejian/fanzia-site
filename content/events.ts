export type StoreEvent = {
  title: string;
  cadence: string;
  description: string;
};

// {{TODO: organized play schedule}} — replace this placeholder once
// Fanzia Glendale has a confirmed recurring event (e.g. Friday Night
// Magic, a Pokémon league night). Keep at least one entry populated;
// an empty list here is worse for distributor review than a
// clearly-marked placeholder.
export const events: StoreEvent[] = [
  {
    title: "{{TODO: event name, e.g. Friday Night Magic}}",
    cadence: "{{TODO: cadence, e.g. Weekly — Fridays, 6:00 PM}}",
    description:
      "{{TODO: short description of the event and who it's for}}",
  },
];
