export type StorePhoto = {
  // {{TODO: exterior with signage}} / {{TODO: interior 1-4}} — replace src
  // with real photography before publishing. Distributor applications
  // (e.g. Southern Hobby) require exactly this set: one exterior shot with
  // visible signage, plus four interior shots.
  src: string | null;
  alt: string;
  label: string;
};

export const storePhotos: StorePhoto[] = [
  {
    src: null,
    alt: "{{TODO: exterior with signage}} — Fanzia Glendale storefront exterior with visible signage",
    label: "Exterior / Signage",
  },
  {
    src: null,
    alt: "{{TODO: interior 1}} — Fanzia Glendale interior, card inventory on shelves",
    label: "Interior / 01",
  },
  {
    src: null,
    alt: "{{TODO: interior 2}} — Fanzia Glendale interior, sales counter",
    label: "Interior / 02",
  },
  {
    src: null,
    alt: "{{TODO: interior 3}} — Fanzia Glendale interior, product display",
    label: "Interior / 03",
  },
  {
    src: null,
    alt: "{{TODO: interior 4}} — Fanzia Glendale interior, store floor",
    label: "Interior / 04",
  },
];
