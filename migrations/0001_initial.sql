
PRAGMA foreign_keys = ON;

-- إعدادات المؤسسة الواحدة
CREATE TABLE IF NOT EXISTS organization_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    organization_name TEXT NOT NULL DEFAULT 'System ABR',
    legal_name TEXT,
    logo_url TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    currency_code TEXT NOT NULL DEFAULT 'EGP',
    currency_minor_unit INTEGER NOT NULL DEFAULT 2
        CHECK (currency_minor_unit BETWEEN 0 AND 4),
    tax_number TEXT,
    default_tax_rate_bps INTEGER NOT NULL DEFAULT 0
        CHECK (default_tax_rate_bps BETWEEN 0 AND 10000),
    invoice_prefix TEXT NOT NULL DEFAULT 'INV',
    next_invoice_number INTEGER NOT NULL DEFAULT 1
        CHECK (next_invoice_number > 0),
    timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
    theme TEXT NOT NULL DEFAULT 'purple'
        CHECK (theme IN ('purple', 'dark', 'light')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO organization_settings (id) VALUES (1);

-- الأدوار
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_system_role INTEGER NOT NULL DEFAULT 0
        CHECK (is_system_role IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الصلاحيات
CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT NOT NULL,
    permission_id TEXT NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- المستخدمون: لا يُخزَّن نص كلمة المرور
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    role_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'disabled', 'locked')),
    email_verified_at TEXT,
    password_changed_at TEXT,
    failed_login_count INTEGER NOT NULL DEFAULT 0
        CHECK (failed_login_count >= 0),
    locked_until TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE INDEX IF NOT EXISTS idx_users_status
    ON users(status);

-- عناوين البريد المسموح لها بإنشاء حساب
CREATE TABLE IF NOT EXISTS email_allowlist (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    role_id TEXT NOT NULL,
    invited_by TEXT,
    expires_at TEXT,
    used_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (role_id) REFERENCES roles(id),
    FOREIGN KEY (invited_by) REFERENCES users(id)
);

-- رموز التحقق: يُخزَّن تجزؤ الرمز لا الرمز نفسه
CREATE TABLE IF NOT EXISTS email_verification_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE,
    purpose TEXT NOT NULL
        CHECK (purpose IN ('signup', 'login', 'password_reset', 'change_email')),
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
        CHECK (attempts >= 0),
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_verification_email_purpose
    ON email_verification_codes(email, purpose, created_at);

-- جلسات المستخدمين؛ تُخزَّن بصمة معرّف الجلسة فقط
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON sessions(user_id, expires_at);

-- سجل التدقيق
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details_json TEXT,
    ip_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created
    ON audit_log(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_entity
    ON audit_log(entity_type, entity_id);

-- تصنيفات المنتجات
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    parent_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES categories(id)
);

-- المنتجات والخدمات
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category_id TEXT,
    item_type TEXT NOT NULL DEFAULT 'product'
        CHECK (item_type IN ('product', 'service')),
    unit_name TEXT NOT NULL DEFAULT 'قطعة',
    sale_price_minor INTEGER NOT NULL DEFAULT 0
        CHECK (sale_price_minor >= 0),
    purchase_cost_minor INTEGER NOT NULL DEFAULT 0
        CHECK (purchase_cost_minor >= 0),
    tax_rate_bps INTEGER NOT NULL DEFAULT 0
        CHECK (tax_rate_bps BETWEEN 0 AND 10000),
    track_inventory INTEGER NOT NULL DEFAULT 1
        CHECK (track_inventory IN (0, 1)),
    minimum_stock_milli INTEGER NOT NULL DEFAULT 0
        CHECK (minimum_stock_milli >= 0),
    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE INDEX IF NOT EXISTS idx_products_name
    ON products(name);

CREATE INDEX IF NOT EXISTS idx_products_category
    ON products(category_id);

-- المخازن
CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    location TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- حركات المخزون؛ الكميات بوحدة الألف من الوحدة الأساسية
CREATE TABLE IF NOT EXISTS inventory_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    movement_type TEXT NOT NULL
        CHECK (movement_type IN (
            'opening',
            'purchase',
            'sale',
            'purchase_return',
            'sale_return',
            'adjustment_in',
            'adjustment_out',
            'transfer_in',
            'transfer_out',
            'reversal'
        )),
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
    quantity_delta_milli INTEGER NOT NULL
        CHECK (quantity_delta_milli != 0),
    unit_cost_minor INTEGER NOT NULL DEFAULT 0
        CHECK (unit_cost_minor >= 0),
    reference_type TEXT,
    reference_id TEXT,
    idempotency_key TEXT UNIQUE,
    notes TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_product_warehouse
    ON inventory_movements(product_id, warehouse_id, created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_reference
    ON inventory_movements(reference_type, reference_id);

-- العملاء والموردون
CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    party_type TEXT NOT NULL
        CHECK (party_type IN ('customer', 'supplier', 'both')),
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    tax_number TEXT,
    opening_balance_minor INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_parties_name
    ON parties(name);

CREATE INDEX IF NOT EXISTS idx_parties_phone
    ON parties(phone);

-- الحسابات المالية والصناديق
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    account_type TEXT NOT NULL
        CHECK (account_type IN (
            'cash',
            'bank',
            'receivable',
            'payable',
            'income',
            'expense',
            'inventory',
            'equity',
            'other'
        )),
    opening_balance_minor INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- فواتير البيع والشراء والمرتجعات
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    invoice_type TEXT NOT NULL
        CHECK (invoice_type IN (
            'sale',
            'purchase',
            'sale_return',
            'purchase_return'
        )),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'posted', 'void')),
    party_id TEXT,
    warehouse_id TEXT,
    issue_date TEXT NOT NULL DEFAULT (date('now')),
    due_date TEXT,
    currency_code TEXT NOT NULL DEFAULT 'EGP',
    subtotal_minor INTEGER NOT NULL DEFAULT 0
        CHECK (subtotal_minor >= 0),
    discount_minor INTEGER NOT NULL DEFAULT 0
        CHECK (discount_minor >= 0),
    tax_minor INTEGER NOT NULL DEFAULT 0
        CHECK (tax_minor >= 0),
    total_minor INTEGER NOT NULL DEFAULT 0
        CHECK (total_minor >= 0),
    paid_minor INTEGER NOT NULL DEFAULT 0
        CHECK (paid_minor >= 0),
    notes TEXT,
    reference_invoice_id TEXT,
    idempotency_key TEXT UNIQUE,
    created_by TEXT,
    posted_by TEXT,
    posted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (party_id) REFERENCES parties(id),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (reference_invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (posted_by) REFERENCES users(id),
    CHECK (discount_minor <= subtotal_minor),
    CHECK (paid_minor <= total_minor)
);

CREATE INDEX IF NOT EXISTS idx_invoices_date_status
    ON invoices(issue_date, status);

CREATE INDEX IF NOT EXISTS idx_invoices_party
    ON invoices(party_id, issue_date);

CREATE INDEX IF NOT EXISTS idx_invoices_type
    ON invoices(invoice_type, status);

-- تفاصيل الفواتير
CREATE TABLE IF NOT EXISTS invoice_lines (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    product_id TEXT,
    description TEXT NOT NULL,
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
    unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
    unit_cost_minor INTEGER NOT NULL DEFAULT 0
        CHECK (unit_cost_minor >= 0),
    discount_minor INTEGER NOT NULL DEFAULT 0
        CHECK (discount_minor >= 0),
    tax_rate_bps INTEGER NOT NULL DEFAULT 0
        CHECK (tax_rate_bps BETWEEN 0 AND 10000),
    tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id) REFERENCES products(id),
    CHECK (discount_minor <= quantity_milli * unit_price_minor / 1000)
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice
    ON invoice_lines(invoice_id);

-- المقبوضات والمدفوعات
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    payment_number TEXT NOT NULL UNIQUE,
    payment_type TEXT NOT NULL
        CHECK (payment_type IN ('receipt', 'disbursement')),
    status TEXT NOT NULL DEFAULT 'posted'
        CHECK (status IN ('draft', 'posted', 'void')),
    party_id TEXT,
    invoice_id TEXT,
    account_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    payment_date TEXT NOT NULL DEFAULT (date('now')),
    reference_number TEXT,
    notes TEXT,
    idempotency_key TEXT UNIQUE,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (party_id) REFERENCES parties(id),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice
    ON payments(invoice_id, status);

CREATE INDEX IF NOT EXISTS idx_payments_date
    ON payments(payment_date, status);

-- المصروفات والإيرادات الأخرى
CREATE TABLE IF NOT EXISTS financial_entries (
    id TEXT PRIMARY KEY,
    entry_type TEXT NOT NULL
        CHECK (entry_type IN ('expense', 'income')),
    status TEXT NOT NULL DEFAULT 'posted'
        CHECK (status IN ('draft', 'posted', 'void')),
    category_name TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    account_id TEXT NOT NULL,
    entry_date TEXT NOT NULL DEFAULT (date('now')),
    reference_number TEXT,
    notes TEXT,
    idempotency_key TEXT UNIQUE,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_financial_entries_date
    ON financial_entries(entry_date, entry_type, status);

-- التحويلات بين الصناديق والحسابات
CREATE TABLE IF NOT EXISTS account_transfers (
    id TEXT PRIMARY KEY,
    transfer_number TEXT NOT NULL UNIQUE,
    from_account_id TEXT NOT NULL,
    to_account_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    transfer_date TEXT NOT NULL DEFAULT (date('now')),
    status TEXT NOT NULL DEFAULT 'posted'
        CHECK (status IN ('draft', 'posted', 'void')),
    notes TEXT,
    idempotency_key TEXT UNIQUE,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (from_account_id) REFERENCES accounts(id),
    FOREIGN KEY (to_account_id) REFERENCES accounts(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    CHECK (from_account_id != to_account_id)
);

-- مفاتيح منع تكرار العمليات الحساسة
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_json TEXT,
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'completed', 'failed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expiry
    ON idempotency_keys(expires_at);
