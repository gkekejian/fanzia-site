"use client";

import {
  TextField,
  SelectField,
  CheckboxGroupField,
  Honeypot,
  SubmitButton,
  StatusBanner,
} from "@/components/forms/fields";
import { useFormSubmit } from "@/components/forms/useFormSubmit";

const BUSINESS_TYPES = [
  "Brick & mortar retail",
  "In-mall retail",
  "Multi-location retail operator",
  "Event / convention seller",
  "Online retailer",
  "Other",
];

const CATEGORIES = [
  "Pokémon US",
  "Pokémon Japanese",
  "Pokémon Chinese",
  "Magic: The Gathering",
  "Basketball",
  "Soccer",
  "One Piece",
  "Other",
];

export default function CatalogAccessForm() {
  const { status, error, onSubmit } = useFormSubmit("catalog-access");

  return (
    <form onSubmit={onSubmit} noValidate className="relative">
      <div className="absolute -left-3 -top-3 h-full w-full border-2 border-brand-red" aria-hidden />
      <div className="relative border-2 border-white bg-black p-6 md:p-10">
        <Honeypot />
        <div className="grid gap-5">
          <TextField label="Business name" name="businessName" required autoComplete="organization" />
          <TextField label="Contact name" name="contactName" required autoComplete="name" />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label="Email" name="email" type="email" required autoComplete="email" />
            <TextField label="Phone" name="phone" type="tel" required autoComplete="tel" />
          </div>
          <SelectField label="Business type" name="businessType" required options={BUSINESS_TYPES} />
          <CheckboxGroupField label="Categories of interest" name="categories" required options={CATEGORIES} />
          <TextField label="Resale certificate number" name="resaleCertNumber" required />
        </div>
        <SubmitButton pending={status === "sending"}>Request Catalog Access</SubmitButton>
        <StatusBanner
          status={status}
          successMessage="Request received. Approved accounts receive catalog access within 1–3 business days."
          errorMessage={error}
        />
      </div>
    </form>
  );
}
