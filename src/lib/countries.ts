export const COUNTRIES: [string, string][] = [
  ["US", "United States"],
  ["IN", "India"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["BR", "Brazil"],
  ["MX", "Mexico"],
  ["JP", "Japan"],
  ["KR", "South Korea"],
  ["SG", "Singapore"],
  ["AE", "United Arab Emirates"],
  ["ZA", "South Africa"],
  ["NG", "Nigeria"],
  ["ID", "Indonesia"],
  ["PH", "Philippines"],
  ["OTHER", "Other"],
];

export function countryName(code: string): string {
  return COUNTRIES.find(([c]) => c === code)?.[1] ?? code;
}
