export const SCHOOL_OTHER_FLAG = "school_other";

export interface SchoolRow {
  school_name: string;
  school_id: string | null;
  school_email: string | null;
}

export async function listDistricts(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT DISTINCT district FROM schools WHERE is_active = 1 ORDER BY district COLLATE NOCASE`)
    .all<{ district: string }>();
  return rows.results.map((r) => r.district);
}

export async function listSchoolsByDistrict(db: D1Database, district: string): Promise<SchoolRow[]> {
  const rows = await db
    .prepare(
      `SELECT school_name, school_id, school_email FROM schools
       WHERE is_active = 1 AND district = ? COLLATE NOCASE
       ORDER BY school_name COLLATE NOCASE`
    )
    .bind(district)
    .all<SchoolRow>();
  return rows.results;
}

export async function isKnownSchool(db: D1Database, district: string, schoolName: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM schools
       WHERE district = ? COLLATE NOCASE AND school_name = ? COLLATE NOCASE
       LIMIT 1`
    )
    .bind(district, schoolName)
    .first();
  return !!row;
}