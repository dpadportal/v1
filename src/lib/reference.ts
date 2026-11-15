export async function generateDpadReference(db: D1Database): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `DPAD-${year}-`;

  const row = await db
    .prepare(
      "SELECT arta_reference_no FROM tickets WHERE arta_reference_no LIKE ? ORDER BY arta_reference_no DESC LIMIT 1"
    )
    .bind(`${prefix}%`)
    .first<{ arta_reference_no: string }>();

  let next = 1;
  if (row) {
    const last = Number.parseInt(row.arta_reference_no.slice(prefix.length), 10);
    if (!Number.isNaN(last)) next = last + 1;
  }
  return `${prefix}${String(next).padStart(5, "0")}`;
}

export function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as { cause?: { message?: string } }).cause;
  const message = [err.message, cause?.message].filter(Boolean).join(" ");
  return message.includes("UNIQUE constraint failed");
}
