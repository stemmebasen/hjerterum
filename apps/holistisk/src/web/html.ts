/** HTML built from tagged templates: every interpolated value is escaped unless it is already SafeHtml. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string { return this.value; }
}

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

type Value = SafeHtml | string | number | boolean | null | undefined | Value[];

function render(value: Value): string {
  if (value === null || value === undefined || value === false || value === true) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  if (value instanceof SafeHtml) return value.value;
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): SafeHtml {
  let out = strings[0] ?? "";
  values.forEach((v, i) => { out += render(v) + (strings[i + 1] ?? ""); });
  return new SafeHtml(out);
}

export const raw = (value: string): SafeHtml => new SafeHtml(value);

/** JSON for a <script type="application/ld+json"> block: "<" is escaped so the text can never close the element. */
export const jsonScript = (data: unknown): SafeHtml => raw(JSON.stringify(data).replace(/</g, "\\u003c"));
