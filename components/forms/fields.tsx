"use client";

export function TextField({
  label,
  name,
  type = "text",
  required,
  autoComplete,
  placeholder,
  className,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className || ""}`}>
      <span className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
        {label}
        {required && <span className="ml-1 text-brand-red">*</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="mt-2 w-full rounded-none border border-white/20 bg-black px-4 py-3 text-base text-white placeholder:text-white/30 focus:border-brand-red focus:outline-none"
      />
    </label>
  );
}

export function TextAreaField({
  label,
  name,
  required,
  rows = 4,
  placeholder,
}: {
  label: string;
  name: string;
  required?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
        {label}
        {required && <span className="ml-1 text-brand-red">*</span>}
      </span>
      <textarea
        name={name}
        required={required}
        rows={rows}
        placeholder={placeholder}
        className="mt-2 w-full rounded-none border border-white/20 bg-black px-4 py-3 text-base text-white placeholder:text-white/30 focus:border-brand-red focus:outline-none"
      />
    </label>
  );
}

export function SelectField({
  label,
  name,
  required,
  options,
  placeholder = "Select one",
}: {
  label: string;
  name: string;
  required?: boolean;
  options: string[];
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
        {label}
        {required && <span className="ml-1 text-brand-red">*</span>}
      </span>
      <select
        name={name}
        required={required}
        defaultValue=""
        className="mt-2 w-full rounded-none border border-white/20 bg-black px-4 py-3 text-base text-white focus:border-brand-red focus:outline-none"
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CheckboxGroupField({
  label,
  name,
  options,
  required,
}: {
  label: string;
  name: string;
  options: string[];
  required?: boolean;
}) {
  return (
    <fieldset className="block">
      <legend className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
        {label}
        {required && <span className="ml-1 text-brand-red">*</span>}
      </legend>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <label
            key={o}
            className="flex items-center gap-2 border border-white/20 px-3 py-2 text-sm text-white/85"
          >
            <input
              type="checkbox"
              name={name}
              value={o}
              className="h-4 w-4 accent-brand-red"
            />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ConsentField({
  name,
  label,
  required,
}: {
  name: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 text-sm text-white/80">
      <input
        type="checkbox"
        name={name}
        required={required}
        value="yes"
        className="mt-1 h-4 w-4 shrink-0 accent-brand-red"
      />
      <span>{label}</span>
    </label>
  );
}

export function FileField({
  label,
  name,
  required,
  hint,
}: {
  label: string;
  name: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="font-display text-xs uppercase tracking-[0.22em] text-white/70">
        {label}
        {required && <span className="ml-1 text-brand-red">*</span>}
      </span>
      <input
        name={name}
        type="file"
        required={required}
        accept=".pdf,.jpg,.jpeg,.png"
        className="mt-2 w-full border border-white/20 bg-black px-4 py-3 text-sm text-white/80 file:mr-4 file:border-0 file:bg-brand-red file:px-4 file:py-2 file:font-display file:text-xs file:uppercase file:tracking-wider file:text-white"
      />
      {hint && <span className="mt-1 block text-xs text-white/40">{hint}</span>}
    </label>
  );
}

export function Honeypot() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "-10000px",
        top: "auto",
        width: 1,
        height: 1,
        overflow: "hidden",
      }}
    >
      <label>
        Website (leave blank)
        <input type="text" name="website" tabIndex={-1} autoComplete="off" />
      </label>
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary mt-2 w-full disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Sending..." : children}
    </button>
  );
}

export function StatusBanner({
  status,
  successMessage,
  errorMessage,
}: {
  status: "idle" | "sending" | "ok" | "error";
  successMessage: string;
  errorMessage: string | null;
}) {
  if (status !== "ok" && status !== "error") return null;
  return (
    <div className="mt-4 text-sm" aria-live="polite">
      {status === "ok" && <span className="text-brand-red">{successMessage}</span>}
      {status === "error" && (
        <span className="text-brand-red">
          {errorMessage || "Could not send. Email contact@fanzia.io directly."}
        </span>
      )}
    </div>
  );
}
