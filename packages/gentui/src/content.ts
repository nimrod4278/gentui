import { sanitizeText } from "./sanitize.js";

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface FileListEntry {
  id: string;
  path: string;
  status: FileStatus;
  previousPath?: string;
}

export interface SelectOption {
  id: string;
  label: string;
  value: unknown;
  disabled: boolean;
}

/** Parse and sanitize typed select options; malformed entries are ignored. */
export function parseSelectOptions(input: unknown): SelectOption[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  const options: SelectOption[] = [];
  for (const candidate of input) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id === "" || ids.has(record.id) || typeof record.label !== "string" || !("value" in record)) continue;
    ids.add(record.id);
    options.push({ id: record.id, label: sanitizeText(record.label), value: record.value, disabled: record.disabled === true });
  }
  return options;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticEntry {
  id: string;
  severity: DiagnosticSeverity;
  message: string;
  location?: string;
  source?: string;
  code?: string;
}

const fileStatuses: Record<string, FileStatus> = {
  A: "added", added: "added", M: "modified", modified: "modified",
  D: "deleted", deleted: "deleted", R: "renamed", renamed: "renamed",
};

/**
 * Parse the deliberately data-only file-list format. Each line is either a
 * literal path, or `status<TAB>stable-id<TAB>path[<TAB>previous-path]`.
 * Sanitization occurs here so the same safe values are used for frames/results.
 */
export function parseFileList(content: string): FileListEntry[] {
  return content.split("\n").filter((line) => line.length > 0).map((line) => {
    const fields = line.split("\t").map(sanitizeText);
    const status = fileStatuses[fields[0] ?? ""];
    if (status && fields.length >= 3) {
      const entry: FileListEntry = { status, id: fields[1] || fields[2]!, path: fields[2]! };
      if (status === "renamed" && fields[3]) entry.previousPath = fields[3];
      return entry;
    }
    const path = sanitizeText(line);
    return { status: "modified", id: path, path };
  });
}

const severities: Record<string, DiagnosticSeverity> = {
  error: "error", warning: "warning", warn: "warning", info: "info",
};
const severityOrder: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Parse `severity<TAB>location<TAB>source<TAB>code<TAB>message` records. */
export function parseDiagnostics(content: string): DiagnosticEntry[] {
  const entries = content.split("\n").filter((line) => line.length > 0).map((line, index) => {
    const fields = line.split("\t").map(sanitizeText);
    const severity = severities[fields[0]?.toLowerCase() ?? ""];
    if (severity) {
      const location = fields[1] || undefined;
      const source = fields[2] || undefined;
      const code = fields[3] || undefined;
      const message = fields.slice(4).join("\t") || "No message";
      return { id: `${location ?? ""}:${source ?? ""}:${code ?? ""}:${message}`, severity, message, ...(location ? { location } : {}), ...(source ? { source } : {}), ...(code ? { code } : {}) };
    }
    const clean = sanitizeText(line);
    return { id: `line-${index}:${clean}`, severity: "info" as const, message: clean };
  });
  return entries.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
    || (left.location ?? "").localeCompare(right.location ?? "") || left.id.localeCompare(right.id));
}
