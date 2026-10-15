/**
 * Typed Mock Data Layer for Website Vikreta Finance SaaS.
 * Pure TypeScript, clean domain types, behind typed accessors.
 */

export interface KPICardData {
  id: string;
  label: string;
  amount: number;
  badgeText: string;
  badgeType: "positive" | "negative" | "neutral";
  iconName: "credit-card" | "arrow-left-right" | "bar-chart-2" | "users";
}

export interface CashFlowMonth {
  month: string;
  income: number;    // In Rupees
  expense: number;   // In Rupees
}

export interface ClientPayment {
  id: string;
  clientName: string;
  amount: number;
  status: "paid" | "due" | "overdue";
  statusText: string;
  progressPercent: number;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  category: string;
  account: string;
  type: "in" | "out";
  amount: number;
  status: "completed" | "pending";
  clientOrVendor?: string;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  clientGst?: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  gstRate: number;
  gstAmount: number;
  totalAmount: number;
  status: "paid" | "due" | "overdue";
  items: InvoiceItem[];
}

export interface ClientRecord {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  activeProjects: number;
  totalBilled: number;
  outstanding: number;
  status: "active" | "inactive";
  lastPaymentDate: string;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountNumberMasked: string;
  accountType: string;
  balance: number;
  currency: "INR" | "USD";
  lastSynced: string;
  status: "synced" | "syncing" | "error";
}

// ---------------------------------------------------------------------------
// DATA ACCESSORS
// ---------------------------------------------------------------------------

export const DASHBOARD_KPIS: KPICardData[] = [
  {
    id: "kpi-money-in",
    label: "MONEY IN",
    amount: 8_42_600,
    badgeText: "+12.4%",
    badgeType: "positive",
    iconName: "credit-card",
  },
  {
    id: "kpi-money-out",
    label: "MONEY OUT",
    amount: 3_18_240,
    badgeText: "-4.8%",
    badgeType: "negative",
    iconName: "arrow-left-right",
  },
  {
    id: "kpi-net-cash",
    label: "NET CASH FLOW",
    amount: 5_24_360,
    badgeText: "+18.1%",
    badgeType: "positive",
    iconName: "bar-chart-2",
  },
  {
    id: "kpi-receivables",
    label: "RECEIVABLES",
    amount: 2_14_500,
    badgeText: "3 invoices",
    badgeType: "neutral",
    iconName: "users",
  },
];

export const CASH_FLOW_DATA_6M: CashFlowMonth[] = [
  { month: "May", income: 5_10_000, expense: 2_60_000 },
  { month: "Jun", income: 6_40_000, expense: 3_30_000 },
  { month: "Jul", income: 5_60_000, expense: 3_70_000 },
  { month: "Aug", income: 7_80_000, expense: 3_10_000 },
  { month: "Sep", income: 7_20_000, expense: 4_10_000 },
  { month: "Oct", income: 8_42_600, expense: 3_18_240 },
];

export const CLIENT_PAYMENTS: ClientPayment[] = [
  {
    id: "cp-1",
    clientName: "PixelCraft",
    amount: 84_000,
    status: "paid",
    statusText: "Paid today",
    progressPercent: 100,
  },
  {
    id: "cp-2",
    clientName: "Northstar Labs",
    amount: 1_02_600,
    status: "due",
    statusText: "Due 09 Oct",
    progressPercent: 82,
  },
  {
    id: "cp-3",
    clientName: "Acme Retail",
    amount: 45_000,
    status: "overdue",
    statusText: "3 days overdue",
    progressPercent: 30,
  },
];

export const TRANSACTIONS: Transaction[] = [
  {
    id: "tx-1",
    date: "09 Oct 2026",
    description: "PixelCraft — Web Development Retainer",
    category: "Client payment",
    account: "HDFC Current",
    type: "in",
    amount: 84_000,
    status: "completed",
    clientOrVendor: "PixelCraft",
  },
  {
    id: "tx-2",
    date: "08 Oct 2026",
    description: "Cursor Pro & Anthropic API credits",
    category: "Software & AI Tools",
    account: "ICICI Corporate",
    type: "out",
    amount: 14_800,
    status: "completed",
    clientOrVendor: "Anthropic / Cursor",
  },
  {
    id: "tx-3",
    date: "07 Oct 2026",
    description: "Northstar Labs — Milestone 1 Milestone Release",
    category: "Client payment",
    account: "HDFC Current",
    type: "in",
    amount: 1_50_000,
    status: "completed",
    clientOrVendor: "Northstar Labs",
  },
  {
    id: "tx-4",
    date: "05 Oct 2026",
    description: "Baner Office Rent — October",
    category: "Rent & Utilities",
    account: "HDFC Current",
    type: "out",
    amount: 65_000,
    status: "completed",
    clientOrVendor: "Baner Commercials",
  },
  {
    id: "tx-5",
    date: "04 Oct 2026",
    description: "Team Payroll — Engineering & Design (Sprint)",
    category: "Salaries",
    account: "HDFC Current",
    type: "out",
    amount: 2_10_000,
    status: "completed",
    clientOrVendor: "Core Team",
  },
  {
    id: "tx-6",
    date: "02 Oct 2026",
    description: "Sustainable Bitcoin Protocol — AI Dashboard Phase",
    category: "Client payment",
    account: "Stripe USD",
    type: "in",
    amount: 2_40_000,
    status: "completed",
    clientOrVendor: "SBP Global",
  },
  {
    id: "tx-7",
    date: "01 Oct 2026",
    description: "Google Ads & Meta Campaign for Local Leads",
    category: "Marketing",
    account: "ICICI Corporate",
    type: "out",
    amount: 28_440,
    status: "completed",
    clientOrVendor: "Google Ads",
  },
];

export const INVOICES: Invoice[] = [
  {
    id: "inv-1",
    invoiceNumber: "INV-2026-089",
    clientName: "PixelCraft",
    clientEmail: "accounts@pixelcraft.studio",
    clientGst: "27AABCP1234F1Z5",
    issueDate: "01 Oct 2026",
    dueDate: "09 Oct 2026",
    subtotal: 71_186,
    gstRate: 18,
    gstAmount: 12_814,
    totalAmount: 84_000,
    status: "paid",
    items: [
      {
        description: "Full-Stack Web App Development (Sprint 4)",
        quantity: 1,
        rate: 71_186,
        amount: 71_186,
      },
    ],
  },
  {
    id: "inv-2",
    invoiceNumber: "INV-2026-090",
    clientName: "Northstar Labs",
    clientEmail: "billing@northstarlabs.ai",
    clientGst: "27AABCN5678M1Z2",
    issueDate: "25 Sep 2026",
    dueDate: "09 Oct 2026",
    subtotal: 86_949,
    gstRate: 18,
    gstAmount: 15_651,
    totalAmount: 1_02_600,
    status: "due",
    items: [
      {
        description: "Custom AI Automation Workflow & CRM Integrations",
        quantity: 1,
        rate: 86_949,
        amount: 86_949,
      },
    ],
  },
  {
    id: "inv-3",
    invoiceNumber: "INV-2026-085",
    clientName: "Acme Retail",
    clientEmail: "finance@acmeretail.in",
    clientGst: "27AABCA9012R1ZX",
    issueDate: "15 Sep 2026",
    dueDate: "06 Oct 2026",
    subtotal: 38_135,
    gstRate: 18,
    gstAmount: 6_865,
    totalAmount: 45_000,
    status: "overdue",
    items: [
      {
        description: "Shopify Speed Optimization & UI Enhancements",
        quantity: 1,
        rate: 38_135,
        amount: 38_135,
      },
    ],
  },
  {
    id: "inv-4",
    invoiceNumber: "INV-2026-088",
    clientName: "Simpli Home",
    clientEmail: "payments@simplihome.com",
    issueDate: "10 Sep 2026",
    dueDate: "24 Sep 2026",
    subtotal: 1_15_000,
    gstRate: 0,
    gstAmount: 0,
    totalAmount: 1_15_000,
    status: "paid",
    items: [
      {
        description: "Enterprise CRM Automation & n8n Workflows",
        quantity: 1,
        rate: 1_15_000,
        amount: 1_15_000,
      },
    ],
  },
];

export const CLIENTS: ClientRecord[] = [
  {
    id: "cl-1",
    name: "PixelCraft",
    contactPerson: "Arjun Verma",
    email: "arjun@pixelcraft.studio",
    activeProjects: 2,
    totalBilled: 3_80_000,
    outstanding: 0,
    status: "active",
    lastPaymentDate: "09 Oct 2026",
  },
  {
    id: "cl-2",
    name: "Northstar Labs",
    contactPerson: "Priya Nair",
    email: "priya@northstarlabs.ai",
    activeProjects: 1,
    totalBilled: 4_20_000,
    outstanding: 1_02_600,
    status: "active",
    lastPaymentDate: "15 Sep 2026",
  },
  {
    id: "cl-3",
    name: "Acme Retail",
    contactPerson: "Rohan Deshmukh",
    email: "rohan@acmeretail.in",
    activeProjects: 1,
    totalBilled: 1_90_000,
    outstanding: 45_000,
    status: "active",
    lastPaymentDate: "20 Aug 2026",
  },
  {
    id: "cl-4",
    name: "Sustainable Bitcoin Protocol",
    contactPerson: "Brad Townsend",
    email: "brad@sbp.org",
    activeProjects: 1,
    totalBilled: 7_50_000,
    outstanding: 66_900,
    status: "active",
    lastPaymentDate: "02 Oct 2026",
  },
  {
    id: "cl-5",
    name: "Simpli Home",
    contactPerson: "Kavita Shah",
    email: "kavita@simplihome.com",
    activeProjects: 0,
    totalBilled: 2_60_000,
    outstanding: 0,
    status: "active",
    lastPaymentDate: "24 Sep 2026",
  },
];

export const BANK_ACCOUNTS: BankAccount[] = [
  {
    id: "ba-1",
    bankName: "HDFC Bank (Primary Operating)",
    accountNumberMasked: "•••• 4892",
    accountType: "Current Account",
    balance: 14_28_450,
    currency: "INR",
    lastSynced: "Just now",
    status: "synced",
  },
  {
    id: "ba-2",
    bankName: "ICICI Bank (Tax & Reserves)",
    accountNumberMasked: "•••• 9120",
    accountType: "Current Account",
    balance: 6_45_200,
    currency: "INR",
    lastSynced: "12 mins ago",
    status: "synced",
  },
  {
    id: "ba-3",
    bankName: "Stripe International USD",
    accountNumberMasked: "acct_1NZ•••",
    accountType: "Merchant Settlement",
    balance: 10_54_000, // Equivalent in INR
    currency: "USD",
    lastSynced: "1 hour ago",
    status: "synced",
  },
];
