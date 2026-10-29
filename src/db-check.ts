
export interface DatabaseCheckResult {
  connected: boolean;
}

export async function checkDatabase(
  db: D1Database
): Promise<DatabaseCheckResult> {
  try {
    const result = await db
      .prepare("SELECT 1 AS ok")
      .first<{ ok: number }>();

    return {
      connected: result?.ok === 1
    };
  } catch {
    return {
      connected: false
    };
  }
}
