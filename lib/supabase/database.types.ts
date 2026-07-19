/**
 * Hand-maintained Supabase Database contract for Path A schema.
 * Mirrors `supabase/migrations/20260719_init_babylon_schema.sql`.
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

export type BudgetTargetInsert =
  Database["public"]["Tables"]["budget_targets"]["Insert"];
export type IncomeEntryInsert =
  Database["public"]["Tables"]["income_entries"]["Insert"];
export type ExpenseEntryInsert =
  Database["public"]["Tables"]["expense_entries"]["Insert"];
