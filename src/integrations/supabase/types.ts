export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      admin_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          ecosystem_id: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          invited_by_name: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          ecosystem_id?: string | null
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          invited_by_name?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          ecosystem_id?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          invited_by_name?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_invitations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string
          created_at: string
          ecosystem_id: string | null
          id: string
          metadata: Json
          target: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          metadata?: Json
          target?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          metadata?: Json
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_accounts: {
        Row: {
          balance: number
          created_at: string
          ecosystem_id: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          ecosystem_id: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          ecosystem_id?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_accounts_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          account_id: string
          actor_id: string | null
          amount: number
          balance_after: number
          base_amount: number | null
          commission_amount: number | null
          commission_percent: number | null
          created_at: string
          direction: string
          ecosystem_id: string
          entry_kind: string
          id: string
          reason: string
          reference: string | null
          sale_id: string | null
          tx_id: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          actor_id?: string | null
          amount: number
          balance_after: number
          base_amount?: number | null
          commission_amount?: number | null
          commission_percent?: number | null
          created_at?: string
          direction: string
          ecosystem_id: string
          entry_kind?: string
          id?: string
          reason: string
          reference?: string | null
          sale_id?: string | null
          tx_id?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          actor_id?: string | null
          amount?: number
          balance_after?: number
          base_amount?: number | null
          commission_amount?: number | null
          commission_percent?: number | null
          created_at?: string
          direction?: string
          ecosystem_id?: string
          entry_kind?: string
          id?: string
          reason?: string
          reference?: string | null
          sale_id?: string | null
          tx_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "voucher_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_lot_consumptions: {
        Row: {
          amount: number
          created_at: string
          ecosystem_id: string
          id: string
          ledger_id: string
          lot_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          ecosystem_id: string
          id?: string
          ledger_id: string
          lot_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          ecosystem_id?: string
          id?: string
          ledger_id?: string
          lot_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_lot_consumptions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_lot_consumptions_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_lot_consumptions_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "credit_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_lots: {
        Row: {
          amount: number
          created_at: string
          ecosystem_id: string
          id: string
          ledger_id: string
          remaining: number
          seq: number
          source_kind: string
          source_user_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          ecosystem_id: string
          id?: string
          ledger_id: string
          remaining: number
          seq?: number
          source_kind: string
          source_user_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          ecosystem_id?: string
          id?: string
          ledger_id?: string
          remaining?: number
          seq?: number
          source_kind?: string
          source_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_lots_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_lots_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: true
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      ecosystems: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credits_per_point: number
          current_period_end: string | null
          default_commission_percent: number
          default_reseller_discount_percent: number
          default_sale_commission_percent: number
          default_subreseller_discount_percent: number
          default_subreseller_sale_commission_percent: number
          default_upline_commission_percent: number
          description: string | null
          frozen_at: string | null
          frozen_by: string | null
          frozen_reason: string | null
          grace_period_days: number
          id: string
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          reviewed_at: string | null
          reviewed_by: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          credits_per_point?: number
          current_period_end?: string | null
          default_commission_percent?: number
          default_reseller_discount_percent?: number
          default_sale_commission_percent?: number
          default_subreseller_discount_percent?: number
          default_subreseller_sale_commission_percent?: number
          default_upline_commission_percent?: number
          description?: string | null
          frozen_at?: string | null
          frozen_by?: string | null
          frozen_reason?: string | null
          grace_period_days?: number
          id?: string
          last_activity_at?: string | null
          name: string
          operations_frozen?: boolean
          payment_reference?: string | null
          plan_name?: string
          plan_price?: number
          points_rule_updated_at?: string
          points_rule_version?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          signup_enabled?: boolean
          signup_token?: string
          slug: string
          submitted_at?: string | null
          subscription_state?: Database["public"]["Enums"]["subscription_state"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          credits_per_point?: number
          current_period_end?: string | null
          default_commission_percent?: number
          default_reseller_discount_percent?: number
          default_sale_commission_percent?: number
          default_subreseller_discount_percent?: number
          default_subreseller_sale_commission_percent?: number
          default_upline_commission_percent?: number
          description?: string | null
          frozen_at?: string | null
          frozen_by?: string | null
          frozen_reason?: string | null
          grace_period_days?: number
          id?: string
          last_activity_at?: string | null
          name?: string
          operations_frozen?: boolean
          payment_reference?: string | null
          plan_name?: string
          plan_price?: number
          points_rule_updated_at?: string
          points_rule_version?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          signup_enabled?: boolean
          signup_token?: string
          slug?: string
          submitted_at?: string | null
          subscription_state?: Database["public"]["Enums"]["subscription_state"]
          updated_at?: string
        }
        Relationships: []
      }
      platform_bootstrap: {
        Row: {
          claimed_at: string
          claimed_email: string
          completed_at: string | null
          id: boolean
          source: string | null
          super_admin_id: string | null
        }
        Insert: {
          claimed_at?: string
          claimed_email: string
          completed_at?: string | null
          id?: boolean
          source?: string | null
          super_admin_id?: string | null
        }
        Update: {
          claimed_at?: string
          claimed_email?: string
          completed_at?: string | null
          id?: boolean
          source?: string | null
          super_admin_id?: string | null
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          billing_period: string
          created_at: string
          currency: string
          gcash_account_name: string
          gcash_number: string
          grace_period_days: number
          id: number
          payment_instructions: string
          plan_name: string
          plan_price: number
          support_message: string
          support_page_name: string
          support_page_url: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          billing_period?: string
          created_at?: string
          currency?: string
          gcash_account_name?: string
          gcash_number?: string
          grace_period_days?: number
          id?: number
          payment_instructions?: string
          plan_name?: string
          plan_price?: number
          support_message?: string
          support_page_name?: string
          support_page_url?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          billing_period?: string
          created_at?: string
          currency?: string
          gcash_account_name?: string
          gcash_number?: string
          grace_period_days?: number
          id?: number
          payment_instructions?: string
          plan_name?: string
          plan_price?: number
          support_message?: string
          support_page_name?: string
          support_page_url?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      points_accounts: {
        Row: {
          balance: number
          created_at: string
          ecosystem_id: string
          held: number
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          ecosystem_id: string
          held?: number
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          ecosystem_id?: string
          held?: number
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "points_accounts_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      points_ledger: {
        Row: {
          account_id: string
          actor_id: string | null
          amount: number
          balance_after: number
          created_at: string
          credits_basis: number | null
          credits_per_point_used: number | null
          direction: string
          ecosystem_id: string
          entry_type: string
          id: string
          points_rule_version: number | null
          reason: string
          redemption_id: string | null
          reference: string | null
          sale_id: string | null
          tx_id: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          actor_id?: string | null
          amount: number
          balance_after: number
          created_at?: string
          credits_basis?: number | null
          credits_per_point_used?: number | null
          direction: string
          ecosystem_id: string
          entry_type?: string
          id?: string
          points_rule_version?: number | null
          reason: string
          redemption_id?: string | null
          reference?: string | null
          sale_id?: string | null
          tx_id?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          actor_id?: string | null
          amount?: number
          balance_after?: number
          created_at?: string
          credits_basis?: number | null
          credits_per_point_used?: number | null
          direction?: string
          ecosystem_id?: string
          entry_type?: string
          id?: string
          points_rule_version?: number | null
          reason?: string
          redemption_id?: string | null
          reference?: string | null
          sale_id?: string | null
          tx_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "points_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "points_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          ecosystem_id: string | null
          email: string
          full_name: string
          id: string
          is_demo: boolean
          joined_at: string
          phone: string
          reseller_commission_percent: number | null
          reseller_discount_percent: number
          reseller_id: string | null
          sale_commission_percent: number | null
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          ecosystem_id?: string | null
          email?: string
          full_name?: string
          id: string
          is_demo?: boolean
          joined_at?: string
          phone?: string
          reseller_commission_percent?: number | null
          reseller_discount_percent?: number
          reseller_id?: string | null
          sale_commission_percent?: number | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          ecosystem_id?: string | null
          email?: string
          full_name?: string
          id?: string
          is_demo?: boolean
          joined_at?: string
          phone?: string
          reseller_commission_percent?: number | null
          reseller_discount_percent?: number
          reseller_id?: string | null
          sale_commission_percent?: number | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_reseller_id_fkey"
            columns: ["reseller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_runs: {
        Row: {
          created_at: string
          cutoff: string
          deleted: Json
          dry_run: boolean
          error: string | null
          finished_at: string | null
          flagged: Json
          id: string
          started_at: string
          status: string
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          cutoff: string
          deleted?: Json
          dry_run?: boolean
          error?: string | null
          finished_at?: string | null
          flagged?: Json
          id?: string
          started_at?: string
          status?: string
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          cutoff?: string
          deleted?: Json
          dry_run?: boolean
          error?: string | null
          finished_at?: string | null
          flagged?: Json
          id?: string
          started_at?: string
          status?: string
          triggered_by?: string | null
        }
        Relationships: []
      }
      reward_products: {
        Row: {
          active: boolean
          archived: boolean
          created_at: string
          description: string
          ecosystem_id: string
          id: string
          image_path: string | null
          name: string
          points_price: number
          reserved: number
          stock: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived?: boolean
          created_at?: string
          description?: string
          ecosystem_id: string
          id?: string
          image_path?: string | null
          name: string
          points_price: number
          reserved?: number
          stock?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived?: boolean
          created_at?: string
          description?: string
          ecosystem_id?: string
          id?: string
          image_path?: string | null
          name?: string
          points_price?: number
          reserved?: number
          stock?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_products_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_redemptions: {
        Row: {
          code: string
          created_at: string
          ecosystem_id: string
          handled_at: string | null
          handled_by: string | null
          handled_by_name: string | null
          id: string
          note: string | null
          points_price: number
          reward_id: string
          reward_image_path: string | null
          reward_name: string
          status: string
          tx_id: string | null
          updated_at: string
          user_id: string
          user_name: string
        }
        Insert: {
          code: string
          created_at?: string
          ecosystem_id: string
          handled_at?: string | null
          handled_by?: string | null
          handled_by_name?: string | null
          id?: string
          note?: string | null
          points_price: number
          reward_id: string
          reward_image_path?: string | null
          reward_name: string
          status?: string
          tx_id?: string | null
          updated_at?: string
          user_id: string
          user_name?: string
        }
        Update: {
          code?: string
          created_at?: string
          ecosystem_id?: string
          handled_at?: string | null
          handled_by?: string | null
          handled_by_name?: string | null
          id?: string
          note?: string | null
          points_price?: number
          reward_id?: string
          reward_image_path?: string | null
          reward_name?: string
          status?: string
          tx_id?: string | null
          updated_at?: string
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "reward_products"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_commissions: {
        Row: {
          commission_amount: number
          commission_percent: number
          created_at: string
          credits_consumed: number
          ecosystem_id: string
          id: string
          kind: string
          ledger_id: string | null
          recipient_id: string
          reversed_at: string | null
          sale_id: string
          source_ledger_id: string
          source_lot_id: string | null
        }
        Insert: {
          commission_amount: number
          commission_percent: number
          created_at?: string
          credits_consumed: number
          ecosystem_id: string
          id?: string
          kind?: string
          ledger_id?: string | null
          recipient_id: string
          reversed_at?: string | null
          sale_id: string
          source_ledger_id: string
          source_lot_id?: string | null
        }
        Update: {
          commission_amount?: number
          commission_percent?: number
          created_at?: string
          credits_consumed?: number
          ecosystem_id?: string
          id?: string
          kind?: string
          ledger_id?: string | null
          recipient_id?: string
          reversed_at?: string | null
          sale_id?: string
          source_ledger_id?: string
          source_lot_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_commissions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_commissions_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_commissions_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "voucher_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_commissions_source_ledger_id_fkey"
            columns: ["source_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_commissions_source_lot_id_fkey"
            columns: ["source_lot_id"]
            isOneToOne: false
            referencedRelation: "credit_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_requests: {
        Row: {
          amount_due: number
          amount_paid: number | null
          billing_period: string
          created_at: string
          currency: string
          decision_reason: string | null
          ecosystem_id: string
          id: string
          payment_reference: string
          period_end: string | null
          period_start: string | null
          plan_name: string
          plan_price: number
          proof_path: string | null
          requested_by: string | null
          requested_by_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_due: number
          amount_paid?: number | null
          billing_period: string
          created_at?: string
          currency?: string
          decision_reason?: string | null
          ecosystem_id: string
          id?: string
          payment_reference: string
          period_end?: string | null
          period_start?: string | null
          plan_name: string
          plan_price: number
          proof_path?: string | null
          requested_by?: string | null
          requested_by_name?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number | null
          billing_period?: string
          created_at?: string
          currency?: string
          decision_reason?: string | null
          ecosystem_id?: string
          id?: string
          payment_reference?: string
          period_end?: string | null
          period_start?: string | null
          plan_name?: string
          plan_price?: number
          proof_path?: string | null
          requested_by?: string | null
          requested_by_name?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_requests_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          ecosystem_id: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_codes: {
        Row: {
          code: string
          created_at: string
          ecosystem_id: string
          id: string
          import_id: string | null
          product_id: string
          sale_id: string | null
          sold_at: string | null
          sold_to: string | null
          status: string
        }
        Insert: {
          code: string
          created_at?: string
          ecosystem_id: string
          id?: string
          import_id?: string | null
          product_id: string
          sale_id?: string | null
          sold_at?: string | null
          sold_to?: string | null
          status?: string
        }
        Update: {
          code?: string
          created_at?: string
          ecosystem_id?: string
          id?: string
          import_id?: string | null
          product_id?: string
          sale_id?: string | null
          sold_at?: string | null
          sold_to?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_codes_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_codes_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "voucher_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "voucher_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_codes_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "voucher_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_imports: {
        Row: {
          actor_id: string | null
          actor_name: string
          created_at: string
          duplicate_count: number
          ecosystem_id: string
          id: string
          imported_count: number
          invalid_count: number
          product_id: string
          source: string
          total_rows: number
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          duplicate_count?: number
          ecosystem_id: string
          id?: string
          imported_count?: number
          invalid_count?: number
          product_id: string
          source?: string
          total_rows?: number
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          duplicate_count?: number
          ecosystem_id?: string
          id?: string
          imported_count?: number
          invalid_count?: number
          product_id?: string
          source?: string
          total_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "voucher_imports_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_imports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "voucher_products"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_products: {
        Row: {
          active: boolean
          archived: boolean
          created_at: string
          credit_price: number
          description: string
          ecosystem_id: string
          id: string
          name: string
          points_price: number | null
          promo_note: string | null
          promo_price: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived?: boolean
          created_at?: string
          credit_price?: number
          description?: string
          ecosystem_id: string
          id?: string
          name: string
          points_price?: number | null
          promo_note?: string | null
          promo_price?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived?: boolean
          created_at?: string
          credit_price?: number
          description?: string
          ecosystem_id?: string
          id?: string
          name?: string
          points_price?: number | null
          promo_note?: string | null
          promo_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_products_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_sales: {
        Row: {
          buyer_id: string
          buyer_role: Database["public"]["Enums"]["app_role"]
          commission_amount: number
          commission_percent: number
          commission_recipient_id: string | null
          created_at: string
          credits_per_point_used: number | null
          discount_amount: number
          discount_percent: number
          ecosystem_id: string
          id: string
          list_price: number
          parent_reseller_id: string | null
          payment_method: string
          points_earned: number
          points_price: number | null
          points_rule_version: number | null
          points_spent: number
          product_id: string
          product_name: string
          quantity: number
          refund_reason: string | null
          refund_tx: string | null
          refunded_at: string | null
          reseller_id: string | null
          sale_price: number
          tx_id: string
          unit_price: number | null
          upline_commission_amount: number
          upline_commission_percent: number
          upline_recipient_id: string | null
        }
        Insert: {
          buyer_id: string
          buyer_role: Database["public"]["Enums"]["app_role"]
          commission_amount?: number
          commission_percent?: number
          commission_recipient_id?: string | null
          created_at?: string
          credits_per_point_used?: number | null
          discount_amount?: number
          discount_percent?: number
          ecosystem_id: string
          id?: string
          list_price: number
          parent_reseller_id?: string | null
          payment_method?: string
          points_earned?: number
          points_price?: number | null
          points_rule_version?: number | null
          points_spent?: number
          product_id: string
          product_name: string
          quantity?: number
          refund_reason?: string | null
          refund_tx?: string | null
          refunded_at?: string | null
          reseller_id?: string | null
          sale_price: number
          tx_id: string
          unit_price?: number | null
          upline_commission_amount?: number
          upline_commission_percent?: number
          upline_recipient_id?: string | null
        }
        Update: {
          buyer_id?: string
          buyer_role?: Database["public"]["Enums"]["app_role"]
          commission_amount?: number
          commission_percent?: number
          commission_recipient_id?: string | null
          created_at?: string
          credits_per_point_used?: number | null
          discount_amount?: number
          discount_percent?: number
          ecosystem_id?: string
          id?: string
          list_price?: number
          parent_reseller_id?: string | null
          payment_method?: string
          points_earned?: number
          points_price?: number | null
          points_rule_version?: number | null
          points_spent?: number
          product_id?: string
          product_name?: string
          quantity?: number
          refund_reason?: string | null
          refund_tx?: string | null
          refunded_at?: string | null
          reseller_id?: string | null
          sale_price?: number
          tx_id?: string
          unit_price?: number | null
          upline_commission_amount?: number
          upline_commission_percent?: number
          upline_recipient_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voucher_sales_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "voucher_products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ecosystem_memberships: {
        Row: {
          ecosystem_id: string | null
          email: string | null
          full_name: string | null
          joined_at: string | null
          phone: string | null
          reseller_discount_percent: number | null
          role: Database["public"]["Enums"]["app_role"] | null
          status: Database["public"]["Enums"]["account_status"] | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_adjust_credits: {
        Args: {
          _amount: number
          _reason: string
          _reference?: string
          _user_id: string
        }
        Returns: string
      }
      admin_adjust_points: {
        Args: {
          _amount: number
          _reason: string
          _reference?: string
          _user_id: string
        }
        Returns: string
      }
      admin_product_inventory: {
        Args: { _ecosystem_id: string }
        Returns: {
          product_id: string
          sold: number
          total: number
          unused: number
        }[]
      }
      archive_ecosystem: {
        Args: { _ecosystem_id: string; _reason?: string }
        Returns: string
      }
      assert_actor_active: { Args: never; Returns: undefined }
      can_load_credits: {
        Args: { _actor: string; _target: string }
        Returns: boolean
      }
      claim_super_admin_bootstrap: {
        Args: { _email: string; _source: string }
        Returns: string
      }
      commission_rate_for: {
        Args: { _recipient: string; _sender: string }
        Returns: number
      }
      countable_members: {
        Args: { _ecosystem_id: string }
        Returns: {
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["account_status"]
          user_id: string
        }[]
      }
      create_ecosystem: {
        Args: {
          _contact_email?: string
          _contact_phone?: string
          _description?: string
          _grace_period_days?: number
          _name: string
          _plan_name?: string
          _plan_price?: number
          _signup_enabled?: boolean
          _slug?: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credits_per_point: number
          current_period_end: string | null
          default_commission_percent: number
          default_reseller_discount_percent: number
          default_sale_commission_percent: number
          default_subreseller_discount_percent: number
          default_subreseller_sale_commission_percent: number
          default_upline_commission_percent: number
          description: string | null
          frozen_at: string | null
          frozen_by: string | null
          frozen_reason: string | null
          grace_period_days: number
          id: string
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          reviewed_at: string | null
          reviewed_by: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ecosystems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_ecosystem: { Args: { _user_id: string }; Returns: string }
      customer_deletion_check: {
        Args: { _user_id: string }
        Returns: {
          blockers: string[]
          eligible: boolean
        }[]
      }
      delete_customer_account: {
        Args: { _reason?: string; _user_id: string }
        Returns: undefined
      }
      earnings_history: {
        Args: {
          _ecosystem?: string
          _from?: string
          _recipient?: string
          _to?: string
        }
        Returns: {
          basis_amount: number
          counterparty_id: string
          counterparty_name: string
          earning_amount: number
          earning_type: string
          ecosystem_id: string
          gross_amount: number
          id: string
          occurred_at: string
          product_name: string
          quantity: number
          rate_percent: number
          recipient_id: string
          recipient_name: string
          sale_id: string
          status: string
          tx_id: string
        }[]
      }
      ecosystem_cleanup_check: {
        Args: { _ecosystem_id: string }
        Returns: {
          blockers: string[]
          eligible: boolean
          last_activity: string
          status: string
        }[]
      }
      ecosystem_dashboard: {
        Args: { _ecosystem_id: string }
        Returns: {
          admin_count: number
          credits_outstanding: number
          customer_count: number
          member_count: number
          points_outstanding: number
          reseller_count: number
          subreseller_count: number
          suspended_count: number
          suspended_customer_count: number
        }[]
      }
      ecosystem_last_activity: {
        Args: { _ecosystem_id: string }
        Returns: string
      }
      expire_stale_invitations: { Args: never; Returns: undefined }
      expire_stale_subscriptions: { Args: never; Returns: number }
      get_signup_ecosystem: {
        Args: { _slug: string }
        Returns: {
          description: string
          id: string
          name: string
          slug: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_voucher_codes: {
        Args: { _codes: string[]; _product_id: string; _source?: string }
        Returns: {
          batch_id: string
          duplicate_count: number
          imported_count: number
          invalid_count: number
        }[]
      }
      invite_admin: {
        Args: {
          _ecosystem_id: string
          _email: string
          _role?: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      is_ecosystem_admin: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      list_admin_invitations: {
        Args: never
        Returns: {
          accepted_at: string | null
          created_at: string
          ecosystem_id: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          invited_by_name: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "admin_invitations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_ecosystem_redemptions: {
        Args: { _ecosystem_id: string }
        Returns: {
          code: string
          created_at: string
          ecosystem_id: string
          handled_at: string | null
          handled_by: string | null
          handled_by_name: string | null
          id: string
          note: string | null
          points_price: number
          reward_id: string
          reward_image_path: string | null
          reward_name: string
          status: string
          tx_id: string | null
          updated_at: string
          user_id: string
          user_name: string
        }[]
        SetofOptions: {
          from: "*"
          to: "reward_redemptions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_rewards: {
        Args: never
        Returns: {
          available: number
          description: string
          id: string
          image_path: string
          name: string
          points_price: number
        }[]
      }
      list_shop_products: {
        Args: never
        Returns: {
          available: number
          credit_price: number
          description: string
          id: string
          name: string
          points_price: number
          promo_note: string
          promo_price: number
        }[]
      }
      list_signup_ecosystems: {
        Args: never
        Returns: {
          description: string
          id: string
          name: string
          slug: string
        }[]
      }
      lookup_redemption: {
        Args: { _code: string }
        Returns: {
          code: string
          created_at: string
          ecosystem_name: string
          id: string
          points_price: number
          reward_name: string
          status: string
          user_name: string
        }[]
      }
      lookup_transfer_recipient: {
        Args: { _query: string }
        Returns: {
          full_name: string
          id: string
          masked_email: string
          phone: string
        }[]
      }
      my_operational_status: {
        Args: never
        Returns: {
          current_period_end: string
          ecosystem_id: string
          grace_period_days: number
          operational: boolean
          subscription_state: Database["public"]["Enums"]["subscription_state"]
        }[]
      }
      new_tx_id: { Args: never; Returns: string }
      platform_overview: {
        Args: never
        Returns: {
          admin_count: number
          archived_at: string
          archived_reason: string
          cleanup_blockers: string[]
          cleanup_status: string
          contact_email: string
          contact_phone: string
          created_at: string
          current_period_end: string
          customer_count: number
          description: string
          frozen_reason: string
          grace_period_days: number
          id: string
          last_activity_at: string
          member_count: number
          name: string
          operations_frozen: boolean
          payment_reference: string
          plan_name: string
          plan_price: number
          reseller_count: number
          reviewed_at: string
          signup_enabled: boolean
          signup_token: string
          slug: string
          submitted_at: string
          subreseller_count: number
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          suspended_customer_count: number
        }[]
      }
      promote_to_reseller: {
        Args: { _discount: number; _user_id: string }
        Returns: undefined
      }
      promote_to_subreseller: {
        Args: {
          _discount: number
          _parent_reseller_id?: string
          _user_id: string
        }
        Returns: undefined
      }
      purchase_voucher: {
        Args: { _product_id: string; _quantity?: number }
        Returns: {
          codes: string[]
          commission_amount: number
          commission_percent: number
          points_earned: number
          product_name: string
          quantity: number
          sale_id: string
          sale_price: number
          tx_id: string
          unit_price: number
        }[]
      }
      purchase_voucher_with_points: {
        Args: { _product_id: string }
        Returns: {
          code: string
          points_spent: number
          product_name: string
          sale_id: string
          tx_id: string
        }[]
      }
      real_super_admin_exists: { Args: never; Returns: boolean }
      refund_voucher_sale: {
        Args: { _reason: string; _sale_id: string }
        Returns: {
          codes_voided: number
          commission_reversed: number
          credits_refunded: number
          points_refunded: number
          points_reversed: number
          tx_id: string
        }[]
      }
      regenerate_signup_token: {
        Args: { _ecosystem_id: string }
        Returns: string
      }
      release_super_admin_bootstrap: {
        Args: { _email: string }
        Returns: undefined
      }
      request_redemption: {
        Args: { _reward_id: string }
        Returns: {
          code: string
          id: string
          points_price: number
          reward_name: string
          status: string
          tx_id: string
        }[]
      }
      require_operational: { Args: never; Returns: undefined }
      reseller_load_credits: {
        Args: { _amount: number; _customer_id: string; _reference?: string }
        Returns: string
      }
      reverse_sale_commission: {
        Args: { _reason?: string; _sale_id: string }
        Returns: number
      }
      reverse_sale_points: {
        Args: { _reason: string; _sale_id: string }
        Returns: string
      }
      review_redemption: {
        Args: { _decision: string; _id: string; _note?: string }
        Returns: string
      }
      review_subscription: {
        Args: {
          _ecosystem_id: string
          _period_end?: string
          _state: Database["public"]["Enums"]["subscription_state"]
        }
        Returns: undefined
      }
      review_subscription_request: {
        Args: { _decision: string; _reason?: string; _request_id: string }
        Returns: {
          amount_due: number
          amount_paid: number | null
          billing_period: string
          created_at: string
          currency: string
          decision_reason: string | null
          ecosystem_id: string
          id: string
          payment_reference: string
          period_end: string | null
          period_start: string | null
          plan_name: string
          plan_price: number
          proof_path: string | null
          requested_by: string | null
          requested_by_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "subscription_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_admin_invitation: { Args: { _id: string }; Returns: undefined }
      run_ecosystem_cleanup: { Args: { _dry_run?: boolean }; Returns: Json }
      run_retention_purge: {
        Args: { _dry_run?: boolean }
        Returns: {
          created_at: string
          cutoff: string
          deleted: Json
          dry_run: boolean
          error: string | null
          finished_at: string | null
          flagged: Json
          id: string
          started_at: string
          status: string
          triggered_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "retention_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sale_commission_rate_for: {
        Args: { _recipient: string }
        Returns: number
      }
      set_ecosystem_commission: {
        Args: { _ecosystem_id: string; _percent: number }
        Returns: number
      }
      set_ecosystem_freeze: {
        Args: { _ecosystem_id: string; _frozen: boolean; _reason?: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credits_per_point: number
          current_period_end: string | null
          default_commission_percent: number
          default_reseller_discount_percent: number
          default_sale_commission_percent: number
          default_subreseller_discount_percent: number
          default_subreseller_sale_commission_percent: number
          default_upline_commission_percent: number
          description: string | null
          frozen_at: string | null
          frozen_by: string | null
          frozen_reason: string | null
          grace_period_days: number
          id: string
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          reviewed_at: string | null
          reviewed_by: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ecosystems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_ecosystem_rates: {
        Args: {
          _ecosystem_id: string
          _reseller_discount_percent: number
          _reseller_sale_percent: number
          _subreseller_discount_percent: number
          _subreseller_sale_percent: number
          _upline_percent: number
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credits_per_point: number
          current_period_end: string | null
          default_commission_percent: number
          default_reseller_discount_percent: number
          default_sale_commission_percent: number
          default_subreseller_discount_percent: number
          default_subreseller_sale_commission_percent: number
          default_upline_commission_percent: number
          description: string | null
          frozen_at: string | null
          frozen_by: string | null
          frozen_reason: string | null
          grace_period_days: number
          id: string
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          reviewed_at: string | null
          reviewed_by: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ecosystems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_ecosystem_sale_commission: {
        Args: {
          _ecosystem_id: string
          _reseller_percent: number
          _subreseller_percent: number
        }
        Returns: undefined
      }
      set_member_status: {
        Args: {
          _status: Database["public"]["Enums"]["account_status"]
          _user_id: string
        }
        Returns: undefined
      }
      set_points_rule: {
        Args: { _credits_per_point: number; _ecosystem_id: string }
        Returns: number
      }
      set_reseller_commission: {
        Args: { _percent: number; _user_id: string }
        Returns: undefined
      }
      set_reseller_discount: {
        Args: { _discount: number; _user_id: string }
        Returns: undefined
      }
      set_sale_commission: {
        Args: { _percent: number; _user_id: string }
        Returns: undefined
      }
      set_subreseller_parent: {
        Args: { _reseller_id: string; _user_id: string }
        Returns: undefined
      }
      slugify: { Args: { _value: string }; Returns: string }
      submit_subscription_request: {
        Args: {
          _amount_paid?: number
          _ecosystem_id: string
          _proof_path?: string
          _reference: string
        }
        Returns: {
          amount_due: number
          amount_paid: number | null
          billing_period: string
          created_at: string
          currency: string
          decision_reason: string | null
          ecosystem_id: string
          id: string
          payment_reference: string
          period_end: string | null
          period_start: string | null
          plan_name: string
          plan_price: number
          proof_path: string | null
          requested_by: string | null
          requested_by_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "subscription_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      subscription_ok: { Args: { _ecosystem_id: string }; Returns: boolean }
      super_admin_bootstrap_available: { Args: never; Returns: boolean }
      transfer_credits: {
        Args: { _amount: number; _note?: string; _recipient_id: string }
        Returns: string
      }
      update_ecosystem: {
        Args: {
          _contact_email?: string
          _contact_phone?: string
          _description?: string
          _ecosystem_id: string
          _name: string
          _signup_enabled?: boolean
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credits_per_point: number
          current_period_end: string | null
          default_commission_percent: number
          default_reseller_discount_percent: number
          default_sale_commission_percent: number
          default_subreseller_discount_percent: number
          default_subreseller_sale_commission_percent: number
          default_upline_commission_percent: number
          description: string | null
          frozen_at: string | null
          frozen_by: string | null
          frozen_reason: string | null
          grace_period_days: number
          id: string
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          reviewed_at: string | null
          reviewed_by: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ecosystems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_ecosystem_plan: {
        Args: {
          _ecosystem_id: string
          _grace_period_days: number
          _plan_name: string
          _plan_price: number
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credits_per_point: number
          current_period_end: string | null
          default_commission_percent: number
          default_reseller_discount_percent: number
          default_sale_commission_percent: number
          default_subreseller_discount_percent: number
          default_subreseller_sale_commission_percent: number
          default_upline_commission_percent: number
          description: string | null
          frozen_at: string | null
          frozen_by: string | null
          frozen_reason: string | null
          grace_period_days: number
          id: string
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          reviewed_at: string | null
          reviewed_by: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ecosystems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_platform_settings: {
        Args: {
          _billing_period: string
          _currency: string
          _gcash_account_name: string
          _gcash_number: string
          _grace_period_days: number
          _payment_instructions: string
          _plan_name: string
          _plan_price: number
          _support_message: string
          _support_page_name: string
          _support_page_url: string
        }
        Returns: {
          billing_period: string
          created_at: string
          currency: string
          gcash_account_name: string
          gcash_number: string
          grace_period_days: number
          id: number
          payment_instructions: string
          plan_name: string
          plan_price: number
          support_message: string
          support_page_name: string
          support_page_url: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "platform_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upline_commission_rate_for: {
        Args: { _ecosystem_id: string }
        Returns: number
      }
      voucher_discount_percent_for: {
        Args: { _user_id: string }
        Returns: number
      }
    }
    Enums: {
      account_status: "active" | "suspended"
      app_role:
        | "super_admin"
        | "admin"
        | "reseller"
        | "customer"
        | "subreseller"
      subscription_state:
        | "pending"
        | "awaiting_approval"
        | "active"
        | "rejected"
        | "expired"
        | "suspended"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "suspended"],
      app_role: ["super_admin", "admin", "reseller", "customer", "subreseller"],
      subscription_state: [
        "pending",
        "awaiting_approval",
        "active",
        "rejected",
        "expired",
        "suspended",
      ],
    },
  },
} as const
