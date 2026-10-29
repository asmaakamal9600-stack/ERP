
import {
  generateSecureToken,
  generateVerificationCode,
  hashPassword,
  hashSessionToken,
  hmacSha256,
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword
} from "./security";

export interface AuthEnv {
  DB: D1Database;
  APP_SECRET?: string;
  EMAIL_PROVIDER_API_KEY?: string;
  EMAIL_FROM?: string;
}

type VerificationPurpose =
  | "signup"
  | "login"
  | "password_reset"
  | "change_email";

interface UserRecord {
  id: string;
  email: string;
  username: string;
  display_name: string;
  password_hash: string | null;
  role_id: string;
  status: "pending" | "active" | "disabled" | "locked";
  email_verified_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
}

function json(
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function requireEmailProvider(env: AuthEnv): {
  apiKey: string;
  from: string;
  secret: string;
} {
  if (
    !env.APP_SECRET ||
    env.APP_SECRET.length < 32 ||
    !env.EMAIL_PROVIDER_API_KEY ||
    !env.EMAIL_FROM
  ) {
    throw new Error("Authentication services are not configured");
  }

  return {
    apiKey: env.EMAIL_PROVIDER_API_KEY,
    from: env.EMAIL_FROM,
    secret: env.APP_SECRET
  };
}

function validPurpose(value: string): value is VerificationPurpose {
  return [
    "signup",
    "login",
    "password_reset",
    "change_email"
  ].includes(value);
}

async function sendEmail(
  env: AuthEnv,
  email: string,
  code: string
): Promise<void> {
  const config = requireEmailProvider(env);

  // Resend email API. Configure a verified sender address in Resend.
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.from,
      to: [email],
      subject: "رمز التحقق - System ABR",
      text:
        `رمز التحقق الخاص بك هو: ${code}\n\n` +
        "صلاحية الرمز 10 دقائق. لا تشاركيه مع أي شخص."
    })
  });

  if (!response.ok) {
    throw new Error("Email delivery failed");
  }
}

async function countRecentCodes(
  db: D1Database,
  email: string
): Promise<number> {
  const result = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM email_verification_codes
       WHERE email = ?
         AND created_at >= datetime('now', '-15 minutes')`
    )
    .bind(email)
    .first<{ count: number }>();

  return Number(result?.count ?? 0);
}

export async function requestEmailVerification(
  env: AuthEnv,
  emailInput: string,
  purposeInput: string
): Promise<Response> {
  const email = normalizeEmail(emailInput);

  if (!validateEmail(email) || !validPurpose(purposeInput)) {
    return json({
      success: false,
      error: "INVALID_REQUEST",
      message: "تحققي من البريد الإلكتروني والطلب."
    }, 400);
  }

  const purpose = purposeInput;

  try {
    const recentCount = await countRecentCodes(env.DB, email);

    if (recentCount >= 5) {
      return json({
        success: false,
        error: "RATE_LIMITED",
        message: "تم طلب رموز كثيرة. حاولي لاحقًا."
      }, 429);
    }

    // Avoid sending login codes to unknown or disabled accounts.
    if (purpose === "login") {
      const user = await env.DB
        .prepare(
          `SELECT id
           FROM users
           WHERE email = ?
             AND status = 'active'
             AND email_verified_at IS NOT NULL`
        )
        .bind(email)
        .first<{ id: string }>();

      if (!user) {
        // Generic response avoids revealing whether an account exists.
        return json({
          success: true,
          message: "إذا كان البريد مسجلًا ومفعّلًا، فستصلك تعليمات التحقق."
        });
      }
    }

    if (purpose === "signup") {
      const invitation = await env.DB
        .prepare(
          `SELECT id
           FROM email_allowlist
           WHERE email = ?
             AND used_at IS NULL
             AND revoked_at IS NULL
             AND (expires_at IS NULL OR expires_at > datetime('now'))`
        )
        .bind(email)
        .first<{ id: string }>();

      if (!invitation) {
        return json({
          success: false,
          error: "INVITATION_REQUIRED",
          message: "هذا البريد غير مدعو لإنشاء حساب."
        }, 403);
      }
    }

    if (purpose === "password_reset") {
      const user = await env.DB
        .prepare(
          `SELECT id
           FROM users
           WHERE email = ?
             AND status = 'active'`
        )
        .bind(email)
        .first<{ id: string }>();

      if (!user) {
        return json({
          success: true,
          message: "إذا كان البريد مؤهلًا، فستصلك تعليمات التحقق."
        });
      }
    }

    const config = requireEmailProvider(env);
    const code = generateVerificationCode();
    const codeHash = await hmacSha256(
      config.secret,
      `${email}:${purpose}:${code}`
    );

    const id = crypto.randomUUID();

    await env.DB
      .prepare(
        `INSERT INTO email_verification_codes
          (id, email, purpose, code_hash, attempts, expires_at)
         VALUES (?, ?, ?, ?, 0, datetime('now', '+10 minutes'))`
      )
      .bind(id, email, purpose, codeHash)
      .run();

    try {
      await sendEmail(env, email, code);
    } catch {
      await env.DB
        .prepare(
          `DELETE FROM email_verification_codes
           WHERE id = ? AND consumed_at IS NULL`
        )
        .bind(id)
        .run();

      return json({
        success: false,
        error: "EMAIL_DELIVERY_FAILED",
        message: "تعذر إرسال البريد. تحققي من إعدادات خدمة البريد."
      }, 503);
    }

    return json({
      success: true,
      message: "إذا كان البريد مؤهلًا، فقد أُرسل رمز التحقق."
    });
  } catch {
    return json({
      success: false,
      error: "AUTH_SERVICE_UNAVAILABLE",
      message: "خدمة التحقق غير جاهزة حاليًا."
    }, 503);
  }
}

export async function verifyEmailCode(
  env: AuthEnv,
  emailInput: string,
  purposeInput: string,
  code: string
): Promise<{ success: true; email: string; purpose: VerificationPurpose } |
          { success: false; response: Response }> {
  const email = normalizeEmail(emailInput);

  if (
    !validateEmail(email) ||
    !validPurpose(purposeInput) ||
    !/^\d{6}$/.test(code)
  ) {
    return {
      success: false,
      response: json({
        success: false,
        error: "INVALID_CODE",
        message: "رمز التحقق غير صحيح أو انتهت صلاحيته."
      }, 400)
    };
  }

  const purpose = purposeInput;

  try {
    const row = await env.DB
      .prepare(
        `SELECT id, code_hash, attempts
         FROM email_verification_codes
         WHERE email = ?
           AND purpose = ?
           AND consumed_at IS NULL
           AND expires_at > datetime('now')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .bind(email, purpose)
      .first<{
        id: string;
        code_hash: string;
        attempts: number;
      }>();

    if (!row || row.attempts >= 5) {
      return {
        success: false,
        response: json({
          success: false,
          error: "INVALID_CODE",
          message: "رمز التحقق غير صحيح أو انتهت صلاحيته."
        }, 400)
      };
    }

    const config = requireEmailProvider(env);
    const submittedHash = await hmacSha256(
      config.secret,
      `${email}:${purpose}:${code}`
    );

    if (submittedHash !== row.code_hash) {
      await env.DB
        .prepare(
          `UPDATE email_verification_codes
           SET attempts = attempts + 1
           WHERE id = ?
             AND consumed_at IS NULL
             AND attempts < 5`
        )
        .bind(row.id)
        .run();

      return {
        success: false,
        response: json({
          success: false,
          error: "INVALID_CODE",
          message: "رمز التحقق غير صحيح أو انتهت صلاحيته."
        }, 400)
      };
    }

    const consumed = await env.DB
      .prepare(
        `UPDATE email_verification_codes
         SET consumed_at = datetime('now')
         WHERE id = ?
           AND consumed_at IS NULL
           AND expires_at > datetime('now')
           AND attempts < 5`
      )
      .bind(row.id)
      .run();

    if (consumed.meta.changes !== 1) {
      return {
        success: false,
        response: json({
          success: false,
          error: "CODE_ALREADY_USED",
          message: "انتهت صلاحية الرمز أو سبق استخدامه."
        }, 400)
      };
    }

    return { success: true, email, purpose };
  } catch {
    return {
      success: false,
      response: json({
        success: false,
        error: "AUTH_SERVICE_UNAVAILABLE",
        message: "تعذر التحقق الآن."
      }, 503)
    };
  }
}

export async function createInvitedUser(
  env: AuthEnv,
  input: {
    email: string;
    username: string;
    displayName: string;
    password: string;
    roleId: string;
  }
): Promise<Response> {
  const email = normalizeEmail(input.email);
  const username = input.username.trim();

  if (
    !validateEmail(email) ||
    !validateUsername(username) ||
    !validatePassword(input.password) ||
    input.displayName.trim().length < 2 ||
    input.displayName.trim().length > 100 ||
    !input.roleId
  ) {
    return json({
      success: false,
      error: "INVALID_INPUT",
      message: "راجعي البريد واسم المستخدم وكلمة المرور والبيانات المطلوبة."
    }, 400);
  }

  try {
    const verified = await env.DB
      .prepare(
        `SELECT id
         FROM email_verification_codes
         WHERE email = ?
           AND purpose = 'signup'
           AND consumed_at IS NOT NULL
           AND consumed_at >= datetime('now', '-15 minutes')
         ORDER BY consumed_at DESC
         LIMIT 1`
      )
      .bind(email)
      .first<{ id: string }>();

    if (!verified) {
      return json({
        success: false,
        error: "EMAIL_NOT_VERIFIED",
        message: "يجب التحقق من البريد أولًا."
      }, 403);
    }

    const invitation = await env.DB
      .prepare(
        `SELECT id, role_id
         FROM email_allowlist
         WHERE email = ?
           AND used_at IS NULL
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > datetime('now'))`
      )
      .bind(email)
      .first<{ id: string; role_id: string }>();

    if (!invitation || invitation.role_id !== input.roleId) {
      return json({
        success: false,
        error: "INVITATION_REQUIRED",
        message: "لا توجد دعوة صالحة لهذا البريد والدور."
      }, 403);
    }

    const passwordHash = await hashPassword(input.password);
    const userId = crypto.randomUUID();

    // Batch both writes so the invitation cannot be consumed
    // unless the account insert succeeds.
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users
          (id, email, username, display_name, password_hash,
           role_id, status, email_verified_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`
      ).bind(
        userId,
        email,
        username,
        input.displayName.trim(),
        passwordHash,
        input.roleId
      ),
      env.DB.prepare(
        `UPDATE email_allowlist
         SET used_at = datetime('now')
         WHERE id = ?
           AND used_at IS NULL
           AND revoked_at IS NULL`
      ).bind(invitation.id)
    ]);

    if (
      results.length !== 2 ||
      results[1].meta.changes !== 1
    ) {
      return json({
        success: false,
        error: "ACCOUNT_CREATION_FAILED",
        message: "تعذر إنشاء الحساب. تحققي من البيانات وحالة الدعوة."
      }, 409);
    }

    return json({
      success: true,
      message: "تم إنشاء الحساب. يمكنك تسجيل الدخول.",
      user: {
        id: userId,
        email,
        username,
        displayName: input.displayName.trim(),
        roleId: input.roleId
      }
    }, 201);
  } catch {
    // Do not expose SQL errors or password data.
    return json({
      success: false,
      error: "ACCOUNT_CREATION_FAILED",
      message: "تعذر إنشاء الحساب. قد يكون البريد أو اسم المستخدم مستخدمًا."
    }, 409);
  }
}

export async function checkPasswordLogin(
  env: AuthEnv,
  emailInput: string,
  usernameInput: string,
  password: string
): Promise<
  { success: true; user: UserRecord } |
  { success: false; response: Response }
> {
  const email = normalizeEmail(emailInput);
  const username = usernameInput.trim();

  if (
    !validateEmail(email) ||
    !validateUsername(username) ||
    typeof password !== "string" ||
    password.length > 256
  ) {
    return {
      success: false,
      response: json({
        success: false,
        error: "INVALID_CREDENTIALS",
        message: "بيانات تسجيل الدخول غير صحيحة."
      }, 400)
    };
  }

  try {
    const user = await env.DB
      .prepare(
        `SELECT id, email, username, display_name, password_hash,
                role_id, status, email_verified_at,
                failed_login_count, locked_until
         FROM users
         WHERE email = ? AND username = ?`
      )
      .bind(email, username)
      .first<UserRecord>();

    if (
      !user ||
      user.status !== "active" ||
      !user.email_verified_at ||
      !user.password_hash ||
      (user.locked_until && user.locked_until > new Date().toISOString())
    ) {
      return {
        success: false,
        response: json({
          success: false,
          error: "INVALID_CREDENTIALS",
          message: "بيانات تسجيل الدخول غير صحيحة."
        }, 401)
      };
    }

    const valid = await verifyPassword(password, user.password_hash);

    if (!valid) {
      const nextCount = user.failed_login_count + 1;

      await env.DB
        .prepare(
          `UPDATE users
           SET failed_login_count = ?,
               locked_until = CASE
                 WHEN ? >= 10 THEN datetime('now', '+15 minutes')
                 ELSE locked_until
               END,
               updated_at = datetime('now')
           WHERE id = ? AND status = 'active'`
        )
        .bind(nextCount, nextCount, user.id)
        .run();

      return {
        success: false,
        response: json({
          success: false,
          error: "INVALID_CREDENTIALS",
          message: "بيانات تسجيل الدخول غير صحيحة."
        }, 401)
      };
    }

    await env.DB
      .prepare(
        `UPDATE users
         SET failed_login_count = 0,
             locked_until = NULL,
             last_login_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(user.id)
      .run();

    return { success: true, user };
  } catch {
    return {
      success: false,
      response: json({
        success: false,
        error: "AUTH_SERVICE_UNAVAILABLE",
        message: "تعذر تسجيل الدخول الآن."
      }, 503)
    };
  }
}

export async function createSession(
  env: AuthEnv,
  userId: string
): Promise<{ token: string; expiresAt: string }> {
  const token = generateSecureToken(32);
  const tokenHash = await hashSessionToken(token);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

  await env.DB
    .prepare(
      `INSERT INTO sessions
        (id, user_id, session_token_hash, expires_at)
       SELECT ?, id, ?, ?
       FROM users
       WHERE id = ? AND status = 'active'
         AND email_verified_at IS NOT NULL`
    )
    .bind(
      id,
      tokenHash,
      expiresAt.toISOString(),
      userId
    )
    .run();

  const session = await env.DB
    .prepare(
      `SELECT id
       FROM sessions
       WHERE id = ? AND user_id = ?`
    )
    .bind(id, userId)
    .first<{ id: string }>();

  if (!session) {
    throw new Error("Unable to create session");
  }

  return {
    token,
    expiresAt: expiresAt.toISOString()
  };
}

export async function getSessionUser(
  env: AuthEnv,
  token: string
): Promise<UserRecord | null> {
  try {
    if (token.length < 32 || token.length > 512) {
      return null;
    }

    const tokenHash = await hashSessionToken(token);

    const user = await env.DB
      .prepare(
        `SELECT u.id, u.email, u.username, u.display_name,
                u.password_hash, u.role_id, u.status,
                u.email_verified_at, u.failed_login_count,
                u.locked_until
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.session_token_hash = ?
           AND s.revoked_at IS NULL
           AND s.expires_at > datetime('now')
           AND u.status = 'active'`
      )
      .bind(tokenHash)
      .first<UserRecord>();

    return user ?? null;
  } catch {
    return null;
  }
}

export async function revokeSession(
  env: AuthEnv,
  token: string
): Promise<void> {
  if (token.length < 32 || token.length > 512) {
    return;
  }

  const tokenHash = await hashSessionToken(token);

  await env.DB
    .prepare(
      `UPDATE sessions
       SET revoked_at = datetime('now')
       WHERE session_token_hash = ?
         AND revoked_at IS NULL`
    )
    .bind(tokenHash)
    .run();
}
