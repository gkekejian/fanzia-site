"use client";

import {
  TextField,
  TextAreaField,
  SelectField,
  CheckboxGroupField,
  ConsentField,
  FileField,
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

const FORMATS = ["Packs", "Boxes", "Bundles", "Cases"];

const VOLUME_OPTIONS = [
  "Under $2,500",
  "$2,500–$10,000",
  "$10,000–$25,000",
  "$25,000–$50,000",
  "$50,000+",
];

export default function WholesaleApplicationForm() {
  const { status, error, onSubmit } = useFormSubmit("wholesale");

  return (
    <form onSubmit={onSubmit} noValidate className="relative">
      <div className="absolute -left-3 -top-3 h-full w-full border-2 border-brand-red" aria-hidden />
      <div className="relative border-2 border-white bg-black p-6 md:p-10">
        <Honeypot />

        <div className="grid gap-8">
          <fieldset className="grid gap-5">
            <legend className="mb-1 font-display text-xs uppercase tracking-[0.3em] text-brand-red">
              Business
            </legend>
            <TextField label="Legal business name" name="legalName" required autoComplete="organization" />
            <TextField label="DBA / trade name" name="dba" />
            <SelectField label="Business type" name="businessType" required options={BUSINESS_TYPES} />
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField label="Years in operation" name="yearsInOperation" required />
              <TextField label="Number of locations" name="numLocations" required />
            </div>
            <TextField label="Business address" name="address" required autoComplete="street-address" />
            <div className="grid gap-5 sm:grid-cols-3">
              <TextField label="City" name="city" required autoComplete="address-level2" />
              <TextField label="State" name="state" required autoComplete="address-level1" />
              <TextField label="ZIP" name="zip" required autoComplete="postal-code" />
            </div>
            <TextField label="Website" name="website_url" />
            <TextField label="Instagram / TikTok / Facebook" name="social" />
          </fieldset>

          <fieldset className="grid gap-5 border-t border-white/10 pt-6">
            <legend className="mb-1 font-display text-xs uppercase tracking-[0.3em] text-brand-red">
              Verification
            </legend>
            <TextField label="Federal EIN / Tax ID" name="ein" required />
            <TextField label="State resale certificate number" name="resaleCertNumber" required />
            <FileField
              label="Resale certificate"
              name="file_resaleCert"
              required
              hint="PDF, JPG, or PNG. 10MB max."
            />
            <FileField label="Business license" name="file_businessLicense" hint="PDF, JPG, or PNG. 10MB max." />
            <FileField
              label="Photo of retail location"
              name="file_locationPhoto"
              hint="PDF, JPG, or PNG. 10MB max."
            />
          </fieldset>

          <fieldset className="grid gap-5 border-t border-white/10 pt-6">
            <legend className="mb-1 font-display text-xs uppercase tracking-[0.3em] text-brand-red">
              Contact
            </legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField label="Full name" name="contactName" required autoComplete="name" />
              <TextField label="Title" name="contactTitle" required />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField label="Email" name="contactEmail" type="email" required autoComplete="email" />
              <TextField label="Phone" name="contactPhone" type="tel" required autoComplete="tel" />
            </div>
          </fieldset>

          <fieldset className="grid gap-5 border-t border-white/10 pt-6">
            <legend className="mb-1 font-display text-xs uppercase tracking-[0.3em] text-brand-red">
              Buying profile
            </legend>
            <CheckboxGroupField label="Categories of interest" name="categories" required options={CATEGORIES} />
            <CheckboxGroupField label="Formats" name="formats" required options={FORMATS} />
            <SelectField
              label="Estimated monthly purchase volume"
              name="volume"
              required
              options={VOLUME_OPTIONS}
            />
            <TextField label="Current distributor relationships" name="currentDistributors" />
            <TextAreaField label="Notes" name="notes" />
          </fieldset>

          <fieldset className="grid gap-4 border-t border-white/10 pt-6">
            <legend className="sr-only">Consent</legend>
            <ConsentField
              name="consentAccurate"
              required
              label="I confirm the information above is accurate and I am purchasing for resale through a licensed business."
            />
            <ConsentField
              name="consentPolicies"
              required
              label="I agree to Fanzia's MAP and marketplace policies."
            />
          </fieldset>
        </div>

        <SubmitButton pending={status === "sending"}>Submit Application</SubmitButton>
        <StatusBanner
          status={status}
          successMessage="Application received. We verify accounts within 1–3 business days and will follow up at the email provided."
          errorMessage={error}
        />
      </div>
    </form>
  );
}
