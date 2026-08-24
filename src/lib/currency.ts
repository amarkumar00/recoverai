const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatInrFromPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new TypeError("Money must be provided as integer paise.");
  }

  return inrFormatter.format(paise / 100);
}
