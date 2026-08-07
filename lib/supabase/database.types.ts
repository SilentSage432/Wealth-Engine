/**
 * Hand-maintained Supabase Database contract for Path A schema.
 * Mirrors:
 * - `supabase/migrations/20260719_init_babylon_schema.sql`
 * - `supabase/migrations/20260807_add_debts_archives_logs.sql`
 */

export type IncomeStreamKindDb =
  | "primary"
  | "side_hustle"
  | "passive"
  | "other";

export type IncomeIntervalDb =
  | "one_time"
  | "weekly"
  | "bi_weekly"
  | "semi_monthly"
  | "monthly"
  | "annually";

export type BudgetCategoryGroupDb = "essential" | "discretionary";

export type ActivityLogTypeDb = "income" | "expense" | "category" | "system";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Sealed-month payload stored in period_archives.snapshot_data. */
export type PeriodArchiveSnapshotDb = {
  totalIncome: number;
  totalSpent: number;
  wealthAllocated: number;
  debtAllocated: number;
  expenditurePool: number;
  expenditureRemaining: number;
  surplusDisposition:
    | "debt_wealth"
    | "emergency_shield"
    | "split_50_50"
    | "wealth_boost"
    | "rollover";
  surplusAmount: number;
};

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      budget_targets: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          cap: number;
          group_kind: BudgetCategoryGroupDb;
          month_key: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          cap: number;
          group_kind: BudgetCategoryGroupDb;
          month_key: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          cap?: number;
          group_kind?: BudgetCategoryGroupDb;
          month_key?: string;
        };
        Relationships: [];
      };
      income_entries: {
        Row: {
          id: string;
          user_id: string;
          source: string;
          amount: number;
          date: string;
          kind: IncomeStreamKindDb;
          interval: IncomeIntervalDb;
          month_key: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source: string;
          amount: number;
          date: string;
          kind?: IncomeStreamKindDb;
          interval?: IncomeIntervalDb;
          month_key: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source?: string;
          amount?: number;
          date?: string;
          kind?: IncomeStreamKindDb;
          interval?: IncomeIntervalDb;
          month_key?: string;
        };
        Relationships: [];
      };
      expense_entries: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          amount: number;
          date: string;
          due_date: string | null;
          is_settled: boolean;
          category_id: string | null;
          month_key: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          amount: number;
          date: string;
          due_date?: string | null;
          is_settled?: boolean;
          category_id?: string | null;
          month_key: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          amount?: number;
          date?: string;
          due_date?: string | null;
          is_settled?: boolean;
          category_id?: string | null;
          month_key?: string;
        };
        Relationships: [];
      };
      activity_logs: {
        Row: {
          id: string;
          user_id: string;
          type: ActivityLogTypeDb;
          description: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: ActivityLogTypeDb;
          description: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: ActivityLogTypeDb;
          description?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      debt_entries: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          total_balance: number;
          minimum_payment: number;
          interest_rate: number;
          current_balance: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          total_balance?: number;
          minimum_payment?: number;
          interest_rate?: number;
          current_balance?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          total_balance?: number;
          minimum_payment?: number;
          interest_rate?: number;
          current_balance?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      period_archives: {
        Row: {
          id: string;
          user_id: string;
          month_key: string;
          closed_at: string;
          snapshot_data: PeriodArchiveSnapshotDb | Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          month_key: string;
          closed_at?: string;
          snapshot_data: PeriodArchiveSnapshotDb | Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          month_key?: string;
          closed_at?: string;
          snapshot_data?: PeriodArchiveSnapshotDb | Json;
          created_at?: string;
        };
        Relationships: [];
      };
      plaid_items: {
        Row: {
          id: string;
          user_id: string;
          access_token: string;
          item_id: string;
          institution_name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          access_token: string;
          item_id: string;
          institution_name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          access_token?: string;
          item_id?: string;
          institution_name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      plaid_transactions: {
        Row: {
          id: string;
          user_id: string;
          plaid_transaction_id: string;
          account_id: string;
          amount: number;
          name: string;
          category: string | null;
          date: string;
          pending: boolean;
          is_processed: boolean;
        };
        Insert: {
          id?: string;
          user_id: string;
          plaid_transaction_id: string;
          account_id: string;
          amount: number;
          name: string;
          category?: string | null;
          date: string;
          pending?: boolean;
          is_processed?: boolean;
        };
        Update: {
          id?: string;
          user_id?: string;
          plaid_transaction_id?: string;
          account_id?: string;
          amount?: number;
          name?: string;
          category?: string | null;
          date?: string;
          pending?: boolean;
          is_processed?: boolean;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      income_stream_kind: IncomeStreamKindDb;
      income_interval: IncomeIntervalDb;
      budget_category_group: BudgetCategoryGroupDb;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type BudgetTargetRow =
  Database["public"]["Tables"]["budget_targets"]["Row"];
export type IncomeEntryRow =
  Database["public"]["Tables"]["income_entries"]["Row"];
export type ExpenseEntryRow =
  Database["public"]["Tables"]["expense_entries"]["Row"];
export type ActivityLogRow =
  Database["public"]["Tables"]["activity_logs"]["Row"];
export type DebtEntryRow = Database["public"]["Tables"]["debt_entries"]["Row"];
export type PeriodArchiveRow =
  Database["public"]["Tables"]["period_archives"]["Row"];

export type BudgetTargetInsert =
  Database["public"]["Tables"]["budget_targets"]["Insert"];
export type IncomeEntryInsert =
  Database["public"]["Tables"]["income_entries"]["Insert"];
export type ExpenseEntryInsert =
  Database["public"]["Tables"]["expense_entries"]["Insert"];
export type ActivityLogInsert =
  Database["public"]["Tables"]["activity_logs"]["Insert"];
export type DebtEntryInsert =
  Database["public"]["Tables"]["debt_entries"]["Insert"];
export type PeriodArchiveInsert =
  Database["public"]["Tables"]["period_archives"]["Insert"];
