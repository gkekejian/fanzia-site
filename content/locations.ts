export type Location = {
  name: string;
  address: string;
  city: string;
  kind: "Storefront" | "Retail location";
  href?: string;
};

export const locations: Location[] = [
  {
    name: "Fanzia Glendale",
    address: "320 N Verdugo Rd, Glendale, CA 91206",
    city: "Glendale, CA",
    kind: "Storefront",
    href: "/store",
  },
  {
    name: "Fanzia at Lakewood Center",
    address: "Lakewood Center",
    city: "Lakewood, CA",
    kind: "Retail location",
    href: "/store",
  },
];
