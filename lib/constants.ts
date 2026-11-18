/**
 * Single source of truth for plans, roles, permissions and the string-union
 * types that stand in for database enums (see prisma/schema.prisma rule 2).
 *
 * If you add a status value here, TypeScript will tell you every switch
 * statement that needs updating. That is the whole point of keeping these
 * as unions instead of Postgres enums.
 */

// ═══════════════════════════════════════════════════════════════════════════
// PLANS
// ═══════════════════════════════════════════════════════════════════════════

/** Sentinel for "no limit". Compared with `=== UNLIMITED`, never counted. */
export const UNLIMITED = -1;

export type PlanId = "STARTER" | "BUSINESS" | "ENTERPRISE";

export interface PlanSeats {
  /** Full-control admins. Can grant/revoke permissions on sub-admins. */
  mainAdmin: number;
  /** Restricted admins. Access is exactly the permission list granted to them. */
  subAdmin: number;
  /** Till operators. POS only. */
  cashier: number;
  branches: number;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  /** Annual price, upfront, in kobo. */
  priceKobo: number;
  seats: PlanSeats;
  /** Marketing bullets, in display order. */
  features: string[];
  /** Shown with a border treatment on the pricing table. */
  highlighted: boolean;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  STARTER: {
    id: "STARTER",
    name: "Starter",
    tagline: "One shop, one till, everything you need to stop guessing.",
    priceKobo: 5_000_000, // ₦50,000 / year
    seats: { mainAdmin: 1, subAdmin: 2, cashier: UNLIMITED, branches: 1 },
    features: [
      "1 main admin + 2 sub-admins",
      "Unlimited cashiers",
      "1 branch",
      "Unlimited products & barcodes",
      "Offline POS — sells when the network is down",
      "Cost, retail & wholesale pricing",
      "Expiry date tracking + alerts",
      "Daily sales report to email or WhatsApp",
      "Thermal receipt printing",
    ],
    highlighted: false,
  },
  BUSINESS: {
    id: "BUSINESS",
    name: "Business",
    tagline: "Multiple tills, real staff controls, profit you can actually see.",
    priceKobo: 18_000_000, // ₦180,000 / year
    seats: { mainAdmin: 2, subAdmin: 8, cashier: UNLIMITED, branches: 3 },
    features: [
      "2 main admins + 8 sub-admins",
      "Unlimited cashiers",
      "Up to 3 branches",
      "Everything in Starter",
      "Per-permission staff restrictions",
      "Supplier & market purchase tracking",
      "Customer debts and part-payments",
      "Profit, COGS and expense reporting",
      "Full audit trail of price & stock edits",
    ],
    highlighted: true,
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    tagline: "Unlimited everything, for chains and distributors.",
    priceKobo: 45_000_000, // ₦450,000 / year
    seats: {
      mainAdmin: UNLIMITED,
      subAdmin: UNLIMITED,
      cashier: UNLIMITED,
      branches: UNLIMITED,
    },
    features: [
      "Unlimited main admins & sub-admins",
      "Unlimited cashiers",
      "Unlimited branches",
      "Everything in Business",
      "Consolidated multi-branch reporting",
      "Stock transfers between branches",
      "Priority support & onboarding",
      "Branded receipts",
    ],
    highlighted: false,
  },
};

export const PLAN_ORDER: PlanId[] = ["STARTER", "BUSINESS", "ENTERPRISE"];

export function getPlan(id: string): PlanDefinition {
  return PLANS[(id as PlanId) in PLANS ? (id as PlanId) : "STARTER"];
}

/** `true` when adding one more of `kind` would exceed the plan. */
export function seatLimitReached(
  plan: string,
  kind: keyof PlanSeats,
  currentCount: number,
): boolean {
  const limit = getPlan(plan).seats[kind];
  if (limit === UNLIMITED) return false;
  return currentCount >= limit;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROLES
// ═══════════════════════════════════════════════════════════════════════════

export type Role =
  | "MAIN_ADMIN"
  | "SUB_ADMIN"
  | "MANAGER"
  | "CASHIER"
  | "STOREKEEPER";

export const ROLES: Role[] = [
  "MAIN_ADMIN",
  "SUB_ADMIN",
  "MANAGER",
  "CASHIER",
  "STOREKEEPER",
];

export const ROLE_LABELS: Record<Role, string> = {
  MAIN_ADMIN: "Main admin",
  SUB_ADMIN: "Sub-admin",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  STOREKEEPER: "Storekeeper",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  MAIN_ADMIN:
    "Full control. Sees cost prices and profit, manages staff and permissions.",
  SUB_ADMIN: "Access is exactly what a main admin grants, nothing more.",
  MANAGER: "Runs the floor: stock, reports and purchases. No staff management.",
  CASHIER: "Till only. Sells, takes payment, prints receipts.",
  STOREKEEPER: "Receives goods and adjusts stock. No pricing, no sales.",
};

/**
 * Which seat bucket a role consumes. MANAGER and STOREKEEPER are permission
 * presets sitting on top of the sub-admin seat pool, so the plan maths the
 * customer was sold ("3 admins") stays true no matter which preset they pick.
 */
export const ROLE_SEAT_BUCKET: Record<Role, keyof PlanSeats> = {
  MAIN_ADMIN: "mainAdmin",
  SUB_ADMIN: "subAdmin",
  MANAGER: "subAdmin",
  STOREKEEPER: "subAdmin",
  CASHIER: "cashier",
};

// ═══════════════════════════════════════════════════════════════════════════
// PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Granular grants. MAIN_ADMIN implicitly holds all of them — its stored list is
 * never consulted (see lib/permissions.ts), so a main admin can't accidentally
 * lock itself out.
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard.view",

  POS_SELL: "pos.sell",
  POS_DISCOUNT: "pos.discount",
  POS_CREDIT_SALE: "pos.credit_sale",
  POS_REPRINT: "pos.reprint",
  POS_PRICE_OVERRIDE: "pos.price_override",

  PRODUCTS_VIEW: "products.view",
  PRODUCTS_CREATE: "products.create",
  PRODUCTS_EDIT: "products.edit",
  PRODUCTS_DELETE: "products.delete",
  /** Separate from PRODUCTS_VIEW on purpose — margin is sensitive. */
  PRODUCTS_COST_VIEW: "products.cost_view",
  PRODUCTS_IMPORT: "products.import",
  PRODUCTS_BARCODE: "products.barcode",

  STOCK_VIEW: "stock.view",
  STOCK_ADJUST: "stock.adjust",
  STOCK_TRANSFER: "stock.transfer",

  SALES_VIEW: "sales.view",
  /** Without this, a user only sees the sales they rang up themselves. */
  SALES_VIEW_ALL: "sales.view_all",
  SALES_VOID: "sales.void",
  SALES_REFUND: "sales.refund",

  CUSTOMERS_VIEW: "customers.view",
  CUSTOMERS_MANAGE: "customers.manage",
  CUSTOMERS_DEBT: "customers.debt",

  SUPPLIERS_VIEW: "suppliers.view",
  SUPPLIERS_MANAGE: "suppliers.manage",

  PURCHASES_VIEW: "purchases.view",
  PURCHASES_MANAGE: "purchases.manage",
  /** Filing supplier receipts. Separate from receiving goods on purpose:
   *  the owner wants only admins and managers handling vendor paperwork. */
  RECEIPTS_MANAGE: "receipts.manage",
  PURCHASES_PAY: "purchases.pay",

  EXPENSES_VIEW: "expenses.view",
  EXPENSES_MANAGE: "expenses.manage",

  REPORTS_VIEW: "reports.view",
  /** Revenue without margin is safe to share; margin is not. */
  REPORTS_PROFIT: "reports.profit",
  REPORTS_EXPORT: "reports.export",

  USERS_VIEW: "users.view",
  USERS_MANAGE: "users.manage",
  USERS_PERMISSIONS: "users.permissions",

  SETTINGS_VIEW: "settings.view",
  SETTINGS_MANAGE: "settings.manage",

  AUDIT_VIEW: "audit.view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Drives the permission-picker UI in staff settings. */
export interface PermissionGroup {
  key: string;
  label: string;
  description: string;
  permissions: { key: Permission; label: string; hint?: string }[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "pos",
    label: "Selling",
    description: "What this person can do at the till.",
    permissions: [
      { key: PERMISSIONS.POS_SELL, label: "Ring up sales" },
      { key: PERMISSIONS.POS_DISCOUNT, label: "Apply discounts" },
      {
        key: PERMISSIONS.POS_CREDIT_SALE,
        label: "Sell on credit",
        hint: "Let a customer owe money",
      },
      { key: PERMISSIONS.POS_REPRINT, label: "Reprint receipts" },
      {
        key: PERMISSIONS.POS_PRICE_OVERRIDE,
        label: "Change price at the till",
        hint: "Risky — usually leave off",
      },
    ],
  },
  {
    key: "products",
    label: "Products",
    description: "The catalogue and its pricing.",
    permissions: [
      { key: PERMISSIONS.PRODUCTS_VIEW, label: "View products" },
      { key: PERMISSIONS.PRODUCTS_CREATE, label: "Add products" },
      { key: PERMISSIONS.PRODUCTS_EDIT, label: "Edit products & prices" },
      { key: PERMISSIONS.PRODUCTS_DELETE, label: "Delete products" },
      {
        key: PERMISSIONS.PRODUCTS_COST_VIEW,
        label: "See cost price & margin",
        hint: "Hide this from floor staff",
      },
      { key: PERMISSIONS.PRODUCTS_IMPORT, label: "Bulk import from Excel" },
      { key: PERMISSIONS.PRODUCTS_BARCODE, label: "Assign & print barcodes" },
    ],
  },
  {
    key: "stock",
    label: "Stock",
    description: "Quantities on hand and corrections to them.",
    permissions: [
      { key: PERMISSIONS.STOCK_VIEW, label: "View stock levels" },
      {
        key: PERMISSIONS.STOCK_ADJUST,
        label: "Adjust stock",
        hint: "Damage, recounts, write-offs",
      },
      { key: PERMISSIONS.STOCK_TRANSFER, label: "Transfer between branches" },
    ],
  },
  {
    key: "sales",
    label: "Sales records",
    description: "Access to completed transactions.",
    permissions: [
      { key: PERMISSIONS.SALES_VIEW, label: "View sales" },
      {
        key: PERMISSIONS.SALES_VIEW_ALL,
        label: "View everyone's sales",
        hint: "Off = only their own till",
      },
      { key: PERMISSIONS.SALES_VOID, label: "Void a sale" },
      { key: PERMISSIONS.SALES_REFUND, label: "Refund a sale" },
    ],
  },
  {
    key: "people",
    label: "Customers",
    description: "Customer records and what they owe.",
    permissions: [
      { key: PERMISSIONS.CUSTOMERS_VIEW, label: "View customers" },
      { key: PERMISSIONS.CUSTOMERS_MANAGE, label: "Add & edit customers" },
      { key: PERMISSIONS.CUSTOMERS_DEBT, label: "Record debt payments" },
    ],
  },
  {
    key: "buying",
    label: "Suppliers & purchases",
    description: "Where goods come from and what they cost.",
    permissions: [
      { key: PERMISSIONS.SUPPLIERS_VIEW, label: "View suppliers & markets" },
      { key: PERMISSIONS.SUPPLIERS_MANAGE, label: "Add & edit suppliers" },
      {
        key: PERMISSIONS.PURCHASES_VIEW,
        label: "View purchases",
        hint: "Includes supplier receipts",
      },
      {
        key: PERMISSIONS.PURCHASES_MANAGE,
        label: "Record goods received",
      },
      {
        key: PERMISSIONS.RECEIPTS_MANAGE,
        label: "File supplier receipts",
        hint: "Upload, edit and delete vendor receipts",
      },
      { key: PERMISSIONS.PURCHASES_PAY, label: "Pay suppliers" },
    ],
  },
  {
    key: "money",
    label: "Expenses & reports",
    description: "Business performance.",
    permissions: [
      { key: PERMISSIONS.EXPENSES_VIEW, label: "View expenses" },
      { key: PERMISSIONS.EXPENSES_MANAGE, label: "Record expenses" },
      { key: PERMISSIONS.REPORTS_VIEW, label: "View reports" },
      {
        key: PERMISSIONS.REPORTS_PROFIT,
        label: "See profit figures",
        hint: "Revenue without margin is safer to share",
      },
      { key: PERMISSIONS.REPORTS_EXPORT, label: "Export reports" },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    description: "Staff, settings and the audit trail.",
    permissions: [
      { key: PERMISSIONS.USERS_VIEW, label: "View staff" },
      { key: PERMISSIONS.USERS_MANAGE, label: "Add & edit staff" },
      {
        key: PERMISSIONS.USERS_PERMISSIONS,
        label: "Change staff permissions",
        hint: "Effectively hands over control",
      },
      { key: PERMISSIONS.SETTINGS_VIEW, label: "View settings" },
      { key: PERMISSIONS.SETTINGS_MANAGE, label: "Change settings" },
      { key: PERMISSIONS.AUDIT_VIEW, label: "View audit log" },
    ],
  },
];

/** Starting grants when a main admin creates a user with a given role. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  MAIN_ADMIN: ALL_PERMISSIONS,
  SUB_ADMIN: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.REPORTS_VIEW,
  ],
  MANAGER: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.POS_SELL,
    PERMISSIONS.POS_DISCOUNT,
    PERMISSIONS.POS_REPRINT,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.PRODUCTS_CREATE,
    PERMISSIONS.PRODUCTS_EDIT,
    PERMISSIONS.PRODUCTS_COST_VIEW,
    PERMISSIONS.PRODUCTS_BARCODE,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.SALES_VIEW_ALL,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.CUSTOMERS_MANAGE,
    PERMISSIONS.CUSTOMERS_DEBT,
    PERMISSIONS.SUPPLIERS_VIEW,
    PERMISSIONS.SUPPLIERS_MANAGE,
    PERMISSIONS.PURCHASES_VIEW,
    PERMISSIONS.PURCHASES_MANAGE,
    PERMISSIONS.RECEIPTS_MANAGE,
    PERMISSIONS.EXPENSES_VIEW,
    PERMISSIONS.EXPENSES_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_PROFIT,
  ],
  CASHIER: [
    PERMISSIONS.POS_SELL,
    PERMISSIONS.POS_REPRINT,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.SALES_VIEW,
  ],
  STOREKEEPER: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.PRODUCTS_CREATE,
    PERMISSIONS.PRODUCTS_EDIT,
    PERMISSIONS.PRODUCTS_BARCODE,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.SUPPLIERS_VIEW,
    PERMISSIONS.PURCHASES_VIEW,
    PERMISSIONS.PURCHASES_MANAGE,
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// DOMAIN UNIONS  (these mirror the String columns in schema.prisma)
// ═══════════════════════════════════════════════════════════════════════════

export type OrgStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED";
export type LeadStatus =
  | "NEW"
  | "CONTACTED"
  | "INVOICED"
  | "PAID"
  | "PROVISIONED"
  | "REJECTED";

export type PaymentMethod = "CASH" | "TRANSFER" | "POS" | "CREDIT" | "SPLIT";

/**
 * "POS" means a card terminal here, not this software. That is how every shop
 * in the market says it, and the dashboard should use the words spoken at the
 * counter rather than teach the owner ours.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  TRANSFER: "Bank transfer",
  POS: "Card / POS",
  CREDIT: "On credit",
  SPLIT: "Split payment",
};

export type SaleStatus =
  | "COMPLETED"
  | "VOIDED"
  | "REFUNDED"
  | "PARTIAL_REFUND";

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  COMPLETED: "Completed",
  VOIDED: "Voided",
  REFUNDED: "Refunded",
  PARTIAL_REFUND: "Part refunded",
};

export type PriceMode = "RETAIL" | "WHOLESALE";

export type MovementType =
  | "OPENING"
  | "PURCHASE"
  | "SALE"
  | "RETURN"
  | "ADJUSTMENT"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "DAMAGE"
  | "EXPIRED"
  | "RECOUNT";

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  OPENING: "Opening stock",
  PURCHASE: "Purchase received",
  SALE: "Sold",
  RETURN: "Customer return",
  ADJUSTMENT: "Manual adjustment",
  TRANSFER_IN: "Transferred in",
  TRANSFER_OUT: "Transferred out",
  DAMAGE: "Damaged",
  EXPIRED: "Expired / discarded",
  RECOUNT: "Stock recount",
};

export type NotificationType =
  | "EXPIRY_SOON"
  | "EXPIRED"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "DEBT_DUE"
  | "SUBSCRIPTION_EXPIRING"
  | "SYNC_FAILED";

export type SupplierType =
  | "MARKET"
  | "DISTRIBUTOR"
  | "MANUFACTURER"
  | "SHOP"
  | "ONLINE"
  | "OTHER";

export const SUPPLIER_TYPE_LABELS: Record<SupplierType, string> = {
  MARKET: "Market trader",
  DISTRIBUTOR: "Distributor",
  MANUFACTURER: "Manufacturer",
  SHOP: "Shop / wholesaler",
  ONLINE: "Online",
  OTHER: "Other",
};

export const EXPENSE_CATEGORIES = [
  "RENT",
  "ELECTRICITY",
  "TRANSPORT",
  "SALARIES",
  "INTERNET",
  "PACKAGING",
  "REPAIRS",
  "SUPPLIES",
  "LEVIES",
  "FUEL",
  "MISC",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENT: "Rent",
  ELECTRICITY: "Electricity",
  TRANSPORT: "Transport",
  SALARIES: "Staff salaries",
  INTERNET: "Internet / airtime",
  PACKAGING: "Packaging",
  REPAIRS: "Repairs",
  SUPPLIES: "Shop supplies",
  LEVIES: "Levies & dues",
  FUEL: "Fuel / generator",
  MISC: "Miscellaneous",
};

/** Sold-by units. `decimal: true` allows fractional quantities (0.5 kg). */
export const PRODUCT_UNITS = [
  { value: "pcs", label: "Piece", decimal: false },
  { value: "carton", label: "Carton", decimal: false },
  { value: "pack", label: "Pack", decimal: false },
  { value: "bag", label: "Bag", decimal: false },
  { value: "crate", label: "Crate", decimal: false },
  { value: "dozen", label: "Dozen", decimal: false },
  { value: "kg", label: "Kilogram", decimal: true },
  { value: "g", label: "Gram", decimal: true },
  { value: "litre", label: "Litre", decimal: true },
  { value: "bundle", label: "Bundle", decimal: false },
  { value: "roll", label: "Roll", decimal: false },
] as const;

export const BUSINESS_TYPES = [
  "SUPERMARKET",
  "MINI_MART",
  "PHARMACY",
  "ELECTRONICS",
  "BOUTIQUE",
  "SPARE_PARTS",
  "WHOLESALER",
  "RESTAURANT",
  "OTHER",
] as const;

export const BUSINESS_TYPE_LABELS: Record<string, string> = {
  SUPERMARKET: "Supermarket",
  MINI_MART: "Mini mart / provisions",
  PHARMACY: "Pharmacy",
  ELECTRONICS: "Electronics",
  BOUTIQUE: "Boutique / fashion",
  SPARE_PARTS: "Spare parts",
  WHOLESALER: "Wholesaler / distributor",
  RESTAURANT: "Restaurant / bar",
  OTHER: "Other",
};

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "FCT - Abuja", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina",
  "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo",
  "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];

// ═══════════════════════════════════════════════════════════════════════════
// OPERATIONAL DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════

/** Warn this many days before a product expires. Three months, per spec. */
export const DEFAULT_EXPIRY_WARNING_DAYS = 90;
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/** Product image ceilings — images are optional and must never slow the till. */
export const IMAGE_MAX_DIMENSION = 640;
export const IMAGE_TARGET_BYTES = 70 * 1024;
export const THUMB_MAX_DIMENSION = 64;
export const THUMB_TARGET_BYTES = 3 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Departments (a shop that is a supermarket AND a pharmacy)
// ─────────────────────────────────────────────────────────────────────────────

export const DEPARTMENTS = ["SUPERMARKET", "PHARMACY"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  SUPERMARKET: "Supermarket",
  PHARMACY: "Pharmacy",
};

/** Roles that always see both departments, whatever is stored on them. */
export const SEES_ALL_DEPARTMENTS: readonly string[] = ["MAIN_ADMIN", "SUB_ADMIN", "MANAGER"];

export function isDepartment(value: unknown): value is Department {
  return value === "SUPERMARKET" || value === "PHARMACY";
}
