
export interface AccountingEnv {
  DB: D1Database;
}

type InvoiceType = "sale" | "purchase";

interface ProductRecord {
  id: string;
  name: string;
  item_type: "product" | "service";
  sale_price_minor: number;
  purchase_cost_minor: number;
  tax_rate_bps: number;
  track_inventory: number;
  is_active: number;
}

interface PartyRecord {
  id: string;
  party_type: "customer" | "supplier" | "both";
  name: string;
  is_active: number;
}

interface WarehouseRecord {
  id: string;
  is_active: number;
}

interface InvoiceLineInput {
  productId: string;
  quantityMilli: number;
  discountMinor?: number;
}

interface CalculatedLine {
  productId: string;
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  unitCostMinor: number;
  discountMinor: number;
  taxRateBps: number;
  taxMinor: number;
  lineTotalMinor: number;
}

interface InvoiceTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
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

function isValidId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128
  );
}

function isSafeIntegerInRange(
  value: unknown,
  min: number,
  max: number
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

/**
 * Rounds a positive integer ratio to the nearest integer.
 * Money is stored in minor currency units.
 */
function divideRounded(
  numerator: number,
  denominator: number
): number {
  if (
    !Number.isSafeInteger(numerator) ||
    numerator < 0 ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0
  ) {
    throw new Error("Invalid calculation");
  }

  const result = Math.floor(
    (numerator + Math.floor(denominator / 2)) / denominator
  );

  if (!Number.isSafeInteger(result)) {
    throw new Error("Calculation exceeds supported range");
  }

  return result;
}

function calculateLine(
  product: ProductRecord,
  type: InvoiceType,
  quantityMilli: number,
  discountMinor: number
): CalculatedLine {
  if (
    !isSafeIntegerInRange(quantityMilli, 1, 1_000_000_000) ||
    !isSafeIntegerInRange(discountMinor, 0, 1_000_000_000_000)
  ) {
    throw new Error("Invalid quantity or discount");
  }

  const unitPriceMinor =
    type === "sale"
      ? product.sale_price_minor
      : product.purchase_cost_minor;

  const unitCostMinor = product.purchase_cost_minor;

  if (
    !isSafeIntegerInRange(unitPriceMinor, 0, 1_000_000_000_000) ||
    !isSafeIntegerInRange(unitCostMinor, 0, 1_000_000_000_000) ||
    !isSafeIntegerInRange(product.tax_rate_bps, 0, 10_000)
  ) {
    throw new Error("Invalid product pricing configuration");
  }

  // quantityMilli = 1000 represents one whole unit.
  const grossMinor = divideRounded(
    quantityMilli * unitPriceMinor,
    1000
  );

  if (discountMinor > grossMinor) {
    throw new Error("Discount cannot exceed the line value");
  }

  const netMinor = grossMinor - discountMinor;

  const taxMinor = divideRounded(
    netMinor * product.tax_rate_bps,
    10_000
  );

  const lineTotalMinor = netMinor + taxMinor;

  if (
    !Number.isSafeInteger(lineTotalMinor) ||
    lineTotalMinor > 1_000_000_000_000
  ) {
    throw new Error("Invoice line total exceeds supported range");
  }

  return {
    productId: product.id,
    description: product.name,
    quantityMilli,
    unitPriceMinor,
    unitCostMinor,
    discountMinor,
    taxRateBps: product.tax_rate_bps,
    taxMinor,
    lineTotalMinor
  };
}

function calculateInvoiceTotals(
  lines: CalculatedLine[]
): InvoiceTotals {
  let subtotalMinor = 0;
  let discountMinor = 0;
  let taxMinor = 0;
  let totalMinor = 0;

  for (const line of lines) {
    const grossMinor = divideRounded(
      line.quantityMilli * line.unitPriceMinor,
      1000
    );

    subtotalMinor += grossMinor;
    discountMinor += line.discountMinor;
    taxMinor += line.taxMinor;
    totalMinor += line.lineTotalMinor;
  }

  for (const amount of [
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor
  ]) {
    if (
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > 1_000_000_000_000
    ) {
      throw new Error("Invoice total exceeds supported range");
    }
  }

  return {
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor
  };
}

async function getProduct(
  db: D1Database,
  productId: string
): Promise<ProductRecord | null> {
  return db
    .prepare(
      `SELECT id, name, item_type, sale_price_minor,
              purchase_cost_minor, tax_rate_bps,
              track_inventory, is_active
       FROM products
       WHERE id = ? AND is_active = 1`
    )
    .bind(productId)
    .first<ProductRecord>();
}

async function validateParty(
  db: D1Database,
  partyId: string,
  type: InvoiceType
): Promise<PartyRecord | null> {
  const party = await db
    .prepare(
      `SELECT id, party_type, name, is_active
       FROM parties
       WHERE id = ? AND is_active = 1`
    )
    .bind(partyId)
    .first<PartyRecord>();

  if (!party) {
    return null;
  }

  const accepted =
    party.party_type === "both" ||
    (type === "sale" && party.party_type === "customer") ||
    (type === "purchase" && party.party_type === "supplier");

  return accepted ? party : null;
}

async function validateWarehouse(
  db: D1Database,
  warehouseId: string
): Promise<WarehouseRecord | null> {
  return db
    .prepare(
      `SELECT id, is_active
       FROM warehouses
       WHERE id = ? AND is_active = 1`
    )
    .bind(warehouseId)
    .first<WarehouseRecord>();
}

/**
 * Creates a draft sale or purchase invoice.
 *
 * Prices and tax rates come from the database, not the browser.
 * This function does not post the invoice, change stock,
 * record a payment, or update account balances.
 */
export async function createInvoiceDraft(
  env: AccountingEnv,
  input: {
    invoiceType: InvoiceType;
    partyId: string;
    warehouseId: string;
    issueDate?: string;
    dueDate?: string;
    notes?: string;
    idempotencyKey: string;
    lines: InvoiceLineInput[];
  }
): Promise<Response> {
  const {
    invoiceType,
    partyId,
    warehouseId,
    issueDate,
    dueDate,
    notes,
    idempotencyKey,
    lines
  } = input;

  if (
    (invoiceType !== "sale" && invoiceType !== "purchase") ||
    !isValidId(partyId) ||
    !isValidId(warehouseId) ||
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length < 16 ||
    idempotencyKey.length > 128 ||
    !Array.isArray(lines) ||
    lines.length < 1 ||
    lines.length > 200 ||
    (notes !== undefined &&
      (typeof notes !== "string" || notes.length > 2000))
  ) {
    return json({
      success: false,
      error: "INVALID_INPUT",
      message: "بيانات الفاتورة غير مكتملة أو غير صحيحة."
    }, 400);
  }

  const validDate = (value: string): boolean =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

  if (
    (issueDate !== undefined && !validDate(issueDate)) ||
    (dueDate !== undefined && !validDate(dueDate)) ||
    (issueDate !== undefined &&
      dueDate !== undefined &&
      dueDate < issueDate)
  ) {
    return json({
      success: false,
      error: "INVALID_DATE",
      message: "تاريخ الفاتورة أو تاريخ الاستحقاق غير صحيح."
    }, 400);
  }

  try {
    const existing = await env.DB
      .prepare(
        `SELECT id, status
         FROM invoices
         WHERE idempotency_key = ?`
      )
      .bind(idempotencyKey)
      .first<{ id: string; status: string }>();

    if (existing) {
      return json({
        success: false,
        error: "DUPLICATE_REQUEST",
        message: "تم استخدام مفتاح هذه العملية من قبل.",
        invoiceId: existing.id,
        status: existing.status
      }, 409);
    }

    const party = await validateParty(
      env.DB,
      partyId,
      invoiceType
    );

    if (!party) {
      return json({
        success: false,
        error: "INVALID_PARTY",
        message: "العميل أو المورد غير موجود أو غير مناسب لنوع الفاتورة."
      }, 400);
    }

    const warehouse = await validateWarehouse(
      env.DB,
      warehouseId
    );

    if (!warehouse) {
      return json({
        success: false,
        error: "INVALID_WAREHOUSE",
        message: "المخزن غير موجود أو غير نشط."
      }, 400);
    }

    const calculatedLines: CalculatedLine[] = [];

    for (const line of lines) {
      if (
        !isValidId(line.productId) ||
        !isSafeIntegerInRange(
          line.quantityMilli,
          1,
          1_000_000_000
        ) ||
        !isSafeIntegerInRange(
          line.discountMinor ?? 0,
          0,
          1_000_000_000_000
        )
      ) {
        return json({
          success: false,
          error: "INVALID_LINE",
          message: "يوجد صنف أو كمية أو خصم غير صحيح."
        }, 400);
      }

      const product = await getProduct(
        env.DB,
        line.productId
      );

      if (!product) {
        return json({
          success: false,
          error: "PRODUCT_NOT_FOUND",
          message: "أحد المنتجات غير موجود أو غير نشط."
        }, 400);
      }

      try {
        calculatedLines.push(
          calculateLine(
            product,
            invoiceType,
            line.quantityMilli,
            line.discountMinor ?? 0
          )
        );
      } catch {
        return json({
          success: false,
          error: "INVALID_LINE_CALCULATION",
          message: "تعذر حساب أحد أصناف الفاتورة."
        }, 400);
      }
    }

    const totals = calculateInvoiceTotals(calculatedLines);

    const settings = await env.DB
      .prepare(
        `SELECT currency_code, invoice_prefix
         FROM organization_settings
         WHERE id = 1`
      )
      .first<{
        currency_code: string;
        invoice_prefix: string;
      }>();

    if (!settings) {
      return json({
        success: false,
        error: "SETTINGS_NOT_CONFIGURED",
        message: "إعدادات المؤسسة غير موجودة."
      }, 503);
    }

    const invoiceId = crypto.randomUUID();
    const invoiceNumber =
      `${settings.invoice_prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO invoices
          (id, invoice_number, invoice_type, status,
           party_id, warehouse_id, issue_date, due_date,
           currency_code, subtotal_minor, discount_minor,
           tax_minor, total_minor, paid_minor, notes,
           idempotency_key)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).bind(
        invoiceId,
        invoiceNumber,
        invoiceType,
        partyId,
        warehouseId,
        issueDate ?? new Date().toISOString().slice(0, 10),
        dueDate ?? null,
        settings.currency_code,
        totals.subtotalMinor,
        totals.discountMinor,
        totals.taxMinor,
        totals.totalMinor,
        notes?.trim() || null,
        idempotencyKey
      )
    ];

    for (const line of calculatedLines) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO invoice_lines
            (id, invoice_id, product_id, description,
             quantity_milli, unit_price_minor, unit_cost_minor,
             discount_minor, tax_rate_bps, tax_minor, line_total_minor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          invoiceId,
          line.productId,
          line.description,
          line.quantityMilli,
          line.unitPriceMinor,
          line.unitCostMinor,
          line.discountMinor,
          line.taxRateBps,
          line.taxMinor,
          line.lineTotalMinor
        )
      );
    }

    // D1 batch runs these statements transactionally.
    // If an insert fails, the batch should roll back.
    await env.DB.batch(statements);

    return json({
      success: true,
      message: "تم إنشاء مسودة الفاتورة.",
      invoice: {
        id: invoiceId,
        invoiceNumber,
        type: invoiceType,
        status: "draft",
        currency: settings.currency_code,
        ...totals,
        lines: calculatedLines
      }
    }, 201);
  } catch {
    return json({
      success: false,
      error: "INVOICE_CREATION_FAILED",
      message: "تعذر إنشاء الفاتورة. تحققي من البيانات وحاولي مجددًا."
    }, 500);
  }
}
