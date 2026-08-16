import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INPUT = path.join(ROOT, "data", "directory.csv");
const OUTPUT = process.argv[2] || path.join(ROOT, "data", "seed-schools.sql");

if (!existsSync(INPUT)) {
  console.error(`Input CSV not found: ${INPUT}`);
  process.exit(1);
}

const text = new TextDecoder("windows-1252").decode(readFileSync(INPUT));

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const rows = parseCsv(text);
if (rows.length === 0) {
  console.error("No rows parsed from CSV.");
  process.exit(1);
}

const headers = rows[0].map((h) => h.trim().toUpperCase());
const col = (name) => {
  const i = headers.indexOf(name);
  return i === -1 ? -1 : i;
};
const IDX = {
  id: col("SCHOOL ID"),
  name: col("SCHOOL NAME"),
  district: col("DISTRICT"),
  email: col("SCHOOL EMAIL"),
};

const DISTRICT_FIXES = {
  Riza: "Rizal",
  Penaranda: "Pe\u00f1aranda",
};

const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
const esc = (v) => v.replace(/'/g, "''");

const byKey = new Map();
const byId = new Map();
let skippedEmpty = 0;
let skippedDup = 0;
let conflicts = 0;

for (const raw of rows.slice(1)) {
  const district = clean(DISTRICT_FIXES[clean(raw[IDX.district])] ?? clean(raw[IDX.district]));
  const name = clean(raw[IDX.name]);
  const schoolId = clean(raw[IDX.id]);
  const email = clean(raw[IDX.email]);

  if (!district && !name) { skippedEmpty++; continue; }
  if (!district || !name) {
    console.warn(`WARN: row missing district or name -> district="${district}" name="${name}"`);
    continue;
  }

  if (schoolId && byId.has(schoolId)) {
    const prev = byId.get(schoolId);
    if (prev.district !== district || prev.name !== name) {
      conflicts++;
      console.warn(`WARN: school ID ${schoolId} maps to different rows: "${prev.district}|${prev.name}" vs "${district}|${name}"`);
    }
    skippedDup++;
    continue;
  }

  const key = `${district}\u0000${name}`;
  if (byKey.has(key)) { skippedDup++; continue; }

  byKey.set(key, { district, name, schoolId, email });
  if (schoolId) byId.set(schoolId, { district, name });
}

const stmts = [...byKey.values()].map((s) =>
  `INSERT OR IGNORE INTO schools (district, school_name, school_id, school_email) VALUES ('${esc(s.district)}', '${esc(s.name)}', ${s.schoolId ? `'${esc(s.schoolId)}'` : "NULL"}, ${s.email ? `'${esc(s.email)}'` : "NULL"});`
);

writeFileSync(OUTPUT, stmts.join("\n") + "\n", "utf8");

const districts = [...new Set([...byKey.values()].map((s) => s.district))].sort();
console.log(`CSV rows (excl. header): ${rows.length - 1}`);
console.log(`Skipped empty rows: ${skippedEmpty}`);
console.log(`Skipped duplicates: ${skippedDup}`);
console.log(`Conflicting IDs: ${conflicts}`);
console.log(`Schools to insert: ${stmts.length}`);
console.log(`Districts: ${districts.length}`);
console.log(`SQL written to: ${OUTPUT}`);