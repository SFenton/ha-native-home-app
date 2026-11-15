/**
 * House-data scan: finds entity-shaped literals and host or token shapes in tracked files, so a real house id,
 * address or secret cannot reach this public repository. A port of the native app's `tools/house_scan.py`
 * rules that need no private list. It prints counts and `path:line rule` only, never the matched text.
 *
 *     npx tsx scripts/house-scan.ts        # exit 1 on any hit
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extname, resolve } from "node:path";

/**
 * `scripts/house-scan.json`: what the scan tolerates. `addresses` are exact non-house addresses (the Home Assistant
 * supervisor's own); `hexPaths` are path prefixes whose 32- or 40-digit strings are public commit ids; `debt` maps a path
 * to the most hits it may carry: placeholder ids from before the `demo_` rule, each file a ceiling that can only fall.
 */
export interface Allowlist {
  addresses: string[];
  hexPaths: string[];
  debt: Record<string, number>;
}

/** One finding. The matched text is deliberately not kept. */
export interface Hit {
  path: string;
  line: number;
  rule: string;
}

/** Home Assistant entity domains: `domain.object_id` is an entity literal only for these. */
const DOMAINS = `alarm_control_panel automation binary_sensor button calendar camera climate conversation counter cover
device_tracker event fan group humidifier image input_boolean input_button input_datetime input_number input_select input_text
lawn_mower light lock media_player notify number person remote scene schedule script select sensor siren stt sun switch text
timer todo tts update vacuum valve water_heater weather zone`.split(/\s+/);

/** Object ids that are generic words or service names (`light.turn_on`), never house data. */
const GENERIC = new Set(["id", "name", "values", "keys", "items", "count", "first", "last", "value", "state", "title", "text",
  "strip", "com", "org", "io", "net", "png", "jpg", "pdf", "json", "plist", "md", "swift", "py", "sh", "yml", "yaml", "txt", "html",
  "ts", "tsx", "js", "css", "map", "length", "icon", "type", "domain", "style", "entity", "entities", "attributes",
  // SF Symbol names and prose members, not entity ids (`lock.fill`, `lock.open`, `button.action`):
  "fill", "open", "trianglebadge", "crop", "walk", "stop", "2", "max", "action", "children", "items", "label", "source", "error", "props", "click", "focus", "color",
  "group", "field", "summary", "assigned", "binding", "slice", "components", "document", "mode", "data", "tasks", "viewer"]);
const SERVICES = new Set(["turn_on", "turn_off", "toggle", "add_item", "remove_item", "update_item", "install", "reload",
  "volume_up", "volume_down", "volume_set", "send_command", "set_percentage", "mobile_app", "set_value", "open_cover", "close_cover", "lock", "unlock", "press", "select_option", "set_temperature", "set_hvac_mode"]);
const ALLOWED_WORDS = ["test", "example", "fixture", "sample", "placeholder", "demo"];

const ENTITY = new RegExp(
  `(?<![\\w.-])(${[...DOMAINS].sort((a, b) => b.length - a.length).join("|")})\\.([a-z0-9][a-z0-9_]*)\\b(?!\\.(?:md|json|swift|py|sh|yml|yaml|txt|png|html|ts|tsx|js|css)\\b)`, "g");
/** A CSS class prefix (`button.w2-card`): the selector names a class, never an entity. */
const CSS_CLASS_PREFIX = "w2";
const PRIVATE_IP = /(?<![\w.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})(?![\w.]*\w)/g;
const IPV6_ULA = /(?<![\w:])f[cd][0-9a-f]{2}(?::[0-9a-f]{0,4}){2,}/gi;
const TAILNET = /(?<![\w.-])[\w-]+(?:\.[\w-]+)*\.ts\.net\b/gi;
const LOCAL_HOST = /(?<![\w.-])((?:[A-Za-z0-9][A-Za-z0-9-]*\.)*[A-Za-z0-9][A-Za-z0-9-]*)\.local(?![\w(\[-]|\.\w)/gi;
const VIN = /(?<![0-9A-Za-z])[A-HJ-NPR-Z0-9]{17}(?![0-9A-Za-z])/gi;
const HEX = /(?<![0-9A-Za-z@])(?:[0-9a-f]{40}|[0-9a-f]{32})(?![0-9A-Za-z])/gi;
const ESCAPES = /\\u\{([0-9a-fA-F]{1,8})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|&#[xX]([0-9a-fA-F]{1,6});|&#(\d{1,7});/g;

const SKIP_SUFFIXES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".zip", ".svg"]);
const SKIP_FILES = new Set(["package-lock.json", "THIRD_PARTY_NOTICES.md"]);
const MAX_BYTES = 1_000_000;

/** Is `domain.objectId` a demo, generic or test id? Allow words match whole `_` tokens, never substrings. */
export function entityIsAllowed(objectId: string): boolean {
  if (objectId.startsWith("demo_") || GENERIC.has(objectId) || SERVICES.has(objectId)) return true;
  const padded = `_${objectId}_`;
  return ALLOWED_WORDS.some((word) => padded.includes(`_${word}_`));
}

/** The text with numeric and `\u` escapes replaced by their characters, so an escaped dot cannot hide an id. */
export function decodeEscapes(line: string): string {
  return line.replace(ESCAPES, (whole, a, b, c, d, e) => {
    const digits = a ?? b ?? c ?? d ?? e;
    const code = parseInt(digits, e === undefined ? 16 : 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

const CODE_SUFFIXES = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh"]);
const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`\n]*`/g;
const INTERPOLATION = /\$?\{[^{}\n]*\}/g;

/** The parts of a line where an entity id counts. Prose and data files: the whole line. Code: string literals (interpolations
 * blanked, so a property access is not an id) and the line comment. Stylesheets hold class names, never ids. */
function entityZones(line: string, suffix: string): string[] {
  if (suffix === ".css") return [];
  if (!CODE_SUFFIXES.has(suffix)) return [line];
  const zones = [...line.matchAll(STRING)].map((m) => m[0].replace(INTERPOLATION, (x) => " ".repeat(x.length)));
  const mark = line.search(/(?<!:)\/\/|(?<![\w$])#/);
  if (mark >= 0) zones.push(line.slice(mark));
  return zones;
}

function lineRules(line: string, suffix: string, wholeLine: boolean, allow: Allowlist, path: string): string[] {
  const rules: string[] = [];
  for (const zone of wholeLine ? [line] : entityZones(line, suffix)) {
    for (const m of zone.matchAll(ENTITY)) {
      if (zone[(m.index ?? 0) + m[0].length] === "(") continue; // a method call such as `counter.values()`
      if (m[2] === CSS_CLASS_PREFIX && zone[(m.index ?? 0) + m[0].length] === "-") continue; // a selector such as `button.w2-card`
      if (!entityIsAllowed(m[2])) rules.push("entity");
    }
  }
  if (line.toLowerCase().includes(".local")) {
    for (const m of line.matchAll(LOCAL_HOST)) if (`${m[1]}.local`.toLowerCase() !== "example.local") rules.push("localhost");
  }
  for (const m of line.matchAll(PRIVATE_IP)) if (!allow.addresses.includes(m[0])) rules.push("ipv4");
  for (const _ of line.matchAll(IPV6_ULA)) rules.push("ipv6");
  const lowered = line.toLowerCase();
  if (lowered.includes(".ts.net")) for (const _ of line.matchAll(TAILNET)) rules.push("tailnet");
  for (const m of line.matchAll(VIN)) {
    const token = m[0];
    if (token !== token.toUpperCase() && token !== token.toLowerCase()) continue; // mixed case is base64 or a hash
    if ((token.match(/\d/g)?.length ?? 0) >= 3 && (token.match(/[a-z]/gi)?.length ?? 0) >= 3) rules.push("vin");
  }
  for (const m of line.matchAll(HEX)) {
    if (new Set(m[0].toLowerCase()).size > 4 && !allow.hexPaths.some((prefix) => path.startsWith(prefix))) rules.push("hex"); // forty of one digit is a placeholder
  }
  return rules;
}

/** Every finding in one file's text. A line holding an escape is scanned as written and decoded; the larger count per rule wins. */
export function scanText(path: string, text: string, allow: Allowlist = { addresses: [], hexPaths: [], debt: {} }): Hit[] {
  const hits: Hit[] = [];
  const suffix = extname(path).toLowerCase();
  text.split(/\r?\n/).forEach((line, index) => {
    const raw = lineRules(line, suffix, false, allow, path);
    const decoded = decodeEscapes(line);
    const rules = [...raw];
    if (decoded !== line) {
      const seen = new Map<string, number>();
      for (const rule of raw) seen.set(rule, (seen.get(rule) ?? 0) + 1);
      for (const rule of lineRules(decoded, suffix, true, allow, path)) {
        if ((seen.get(rule) ?? 0) > 0) seen.set(rule, seen.get(rule)! - 1);
        else rules.push(rule);
      }
    }
    for (const rule of rules) hits.push({ path, line: index + 1, rule });
  });
  return hits;
}

/** Tracked paths from `git ls-files`, the working tree, so uncommitted edits are scanned too. */
export function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
}

/** Read the allowlist; a missing file allows nothing. */
export function loadAllowlist(file = resolve(dirname(fileURLToPath(import.meta.url)), "house-scan.json")): Allowlist {
  let data: Partial<Allowlist> = {};
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // no allowlist: everything counts
  }
  return { addresses: data.addresses ?? [], hexPaths: data.hexPaths ?? [], debt: data.debt ?? {} };
}

/** Drop what the allowlist tolerates: allowed addresses and public-id paths are removed upstream; debt files may keep up to their ceiling. */
export function applyDebt(hits: Hit[], allow: Allowlist): { failures: Hit[]; tolerated: number } {
  const byPath = new Map<string, Hit[]>();
  for (const hit of hits) byPath.set(hit.path, [...(byPath.get(hit.path) ?? []), hit]);
  const failures: Hit[] = [];
  let tolerated = 0;
  for (const [path, list] of byPath) {
    const ceiling = allow.debt[path] ?? 0;
    if (list.length <= ceiling) tolerated += list.length;
    else failures.push(...list);
  }
  return { failures, tolerated };
}

/** Scan every tracked text file. */
export function scanTree(allow: Allowlist = loadAllowlist()): Hit[] {
  const hits: Hit[] = [];
  for (const path of trackedFiles()) {
    if (SKIP_SUFFIXES.has(extname(path).toLowerCase()) || SKIP_FILES.has(path.split("/").pop() ?? "")) continue;
    let buffer: Buffer;
    try {
      buffer = readFileSync(path);
    } catch {
      continue; // deleted in the working tree
    }
    if (buffer.length > MAX_BYTES || buffer.includes(0)) continue;
    hits.push(...scanText(path, buffer.toString("utf8"), allow));
  }
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const allow = loadAllowlist();
  const all = scanTree(allow);
  const { failures: hits, tolerated } = applyDebt(all, allow);
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.rule, (counts.get(hit.rule) ?? 0) + 1);
  for (const hit of hits) console.log(`${hit.path}:${hit.line} ${hit.rule}`);
  console.log(`house-scan: ${hits.length} hit(s), ${tolerated} tolerated as debt${[...counts].map(([rule, n]) => ` ${rule}=${n}`).join("")}`);
  process.exit(hits.length ? 1 : 0);
}
