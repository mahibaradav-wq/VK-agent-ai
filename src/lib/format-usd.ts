export function formatUsd(amount: number) {
  const sign = amount < 0 ? "-" : "";
  const [whole, fraction] = Math.abs(amount).toFixed(2).split(".");
  return `${sign}${whole},${fraction} $`;
}
