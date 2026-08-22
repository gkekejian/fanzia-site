"use client";

import {
  TextField,
  TextAreaField,
  CheckboxGroupField,
  Honeypot,
  SubmitButton,
  StatusBanner,
} from "@/components/forms/fields";
import { useFormSubmit } from "@/components/forms/useFormSubmit";

const PARTS = [
  "High-capacity coils",
  "Bundle support bars",
  "TCN-series replacement parts",
  "Other",
];

export default function PartsQuoteForm() {
  const { status, error, onSubmit } = useFormSubmit("parts-quote");

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
          <TextField label="Equipment model" name="equipmentModel" />
          <CheckboxGroupField label="Parts needed" name="partsNeeded" options={PARTS} />
          <TextField label="Quantity" name="quantity" />
          <TextAreaField label="Notes" name="notes" placeholder="Describe the parts you need if not listed above." />
        </div>
        <SubmitButton pending={status === "sending"}>Request a Parts Quote</SubmitButton>
        <StatusBanner
          status={status}
          successMessage="Request received. A Fanzia Supply rep will follow up with a quote."
          errorMessage={error}
        />
      </div>
    </form>
  );
}
