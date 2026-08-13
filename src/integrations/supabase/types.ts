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
          reverses_ledger_id: string | null
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
          reverses_ledger_id?: string | null
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
          reverses_ledger_id?: string | null
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
            foreignKeyName: "credit_ledger_reverses_ledger_id_fkey"
            columns: ["reverses_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
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
      credit_packages: {
        Row: {
          active: boolean
          created_at: string
          credits: number
          id: string
          name: string
          price_php: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          credits: number
          id?: string
          name: string
          price_php: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          credits?: number
          id?: string
          name?: string
          price_php?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      credit_purchase_orders: {
        Row: {
          amount_due: number
          buyer_id: string
          buyer_name: string
          created_at: string
          credit_ledger_id: string | null
          credits: number
          decision_reason: string | null
          discount_percent: number
          ecosystem_id: string
          freeze_ledger_id: string | null
          id: string
          list_php: number
          note: string | null
          package_id: string | null
          package_name: string
          payment_reference: string
          quantity: number
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_due: number
          buyer_id: string
          buyer_name: string
          created_at?: string
          credit_ledger_id?: string | null
          credits: number
          decision_reason?: string | null
          discount_percent?: number
          ecosystem_id: string
          freeze_ledger_id?: string | null
          id?: string
          list_php: number
          note?: string | null
          package_id?: string | null
          package_name: string
          payment_reference: string
          quantity?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_due?: number
          buyer_id?: string
          buyer_name?: string
          created_at?: string
          credit_ledger_id?: string | null
          credits?: number
          decision_reason?: string | null
          discount_percent?: number
          ecosystem_id?: string
          freeze_ledger_id?: string | null
          id?: string
          list_php?: number
          note?: string | null
          package_id?: string | null
          package_name?: string
          payment_reference?: string
          quantity?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_purchase_orders_credit_ledger_id_fkey"
            columns: ["credit_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_purchase_orders_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_purchase_orders_freeze_ledger_id_fkey"
            columns: ["freeze_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_purchase_orders_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "credit_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transfer_reversals: {
        Row: {
          actor_id: string | null
          actor_name: string
          created_at: string
          ecosystem_id: string
          id: string
          kind: string
          note: string | null
          original_amount: number
          original_recipient_ledger_id: string
          original_sender_ledger_id: string
          original_tx_id: string
          reason: string
          recipient_id: string
          reversal_credit_ledger_id: string | null
          reversal_debit_ledger_id: string | null
          reversal_tx_id: string
          reversed_amount: number
          sender_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name: string
          created_at?: string
          ecosystem_id: string
          id?: string
          kind: string
          note?: string | null
          original_amount: number
          original_recipient_ledger_id: string
          original_sender_ledger_id: string
          original_tx_id: string
          reason: string
          recipient_id: string
          reversal_credit_ledger_id?: string | null
          reversal_debit_ledger_id?: string | null
          reversal_tx_id: string
          reversed_amount: number
          sender_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          ecosystem_id?: string
          id?: string
          kind?: string
          note?: string | null
          original_amount?: number
          original_recipient_ledger_id?: string
          original_sender_ledger_id?: string
          original_tx_id?: string
          reason?: string
          recipient_id?: string
          reversal_credit_ledger_id?: string | null
          reversal_debit_ledger_id?: string | null
          reversal_tx_id?: string
          reversed_amount?: number
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transfer_reversals_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transfer_reversals_original_recipient_ledger_id_fkey"
            columns: ["original_recipient_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transfer_reversals_original_sender_ledger_id_fkey"
            columns: ["original_sender_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transfer_reversals_reversal_credit_ledger_id_fkey"
            columns: ["reversal_credit_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transfer_reversals_reversal_debit_ledger_id_fkey"
            columns: ["reversal_debit_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_messages: {
        Row: {
          body: string
          created_at: string
          ecosystem_id: string
          id: string
          image_path: string | null
          read_at: string | null
          recipient_id: string
          sender_id: string
          thread_id: string
        }
        Insert: {
          body: string
          created_at?: string
          ecosystem_id: string
          id?: string
          image_path?: string | null
          read_at?: string | null
          recipient_id: string
          sender_id: string
          thread_id: string
        }
        Update: {
          body?: string
          created_at?: string
          ecosystem_id?: string
          id?: string
          image_path?: string | null
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_messages_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "dm_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_threads: {
        Row: {
          created_at: string
          ecosystem_id: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          ecosystem_id: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          ecosystem_id?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          user_a?: string
          user_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_threads_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      ecosystem_social_settings: {
        Row: {
          comment_cost: number | null
          created_at: string
          credit_exchange_rate: number | null
          daily_allowance: number | null
          ecosystem_id: string
          points_exchange_rate: number | null
          post_cost: number | null
          promotion_enabled: boolean | null
          social_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          comment_cost?: number | null
          created_at?: string
          credit_exchange_rate?: number | null
          daily_allowance?: number | null
          ecosystem_id: string
          points_exchange_rate?: number | null
          post_cost?: number | null
          promotion_enabled?: boolean | null
          social_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          comment_cost?: number | null
          created_at?: string
          credit_exchange_rate?: number | null
          daily_allowance?: number | null
          ecosystem_id?: string
          points_exchange_rate?: number | null
          post_cost?: number | null
          promotion_enabled?: boolean | null
          social_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ecosystem_social_settings_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: true
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      ecosystems: {
        Row: {
          admin_sale_commission_percent: number
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
          facebook_page_name: string | null
          facebook_page_url: string | null
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
          admin_sale_commission_percent?: number
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
          facebook_page_name?: string | null
          facebook_page_url?: string | null
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
          admin_sale_commission_percent?: number
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
          facebook_page_name?: string | null
          facebook_page_url?: string | null
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
      impersonation_sessions: {
        Row: {
          created_at: string
          ecosystem_id: string
          ended_at: string | null
          expires_at: string
          id: string
          operator_id: string
          operator_name: string
          operator_role: Database["public"]["Enums"]["app_role"]
          reason: string | null
          started_at: string
          target_id: string
          target_name: string
          target_role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          ecosystem_id: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          operator_id: string
          operator_name: string
          operator_role: Database["public"]["Enums"]["app_role"]
          reason?: string | null
          started_at?: string
          target_id: string
          target_name: string
          target_role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          ecosystem_id?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          operator_id?: string
          operator_name?: string
          operator_role?: Database["public"]["Enums"]["app_role"]
          reason?: string | null
          started_at?: string
          target_id?: string
          target_name?: string
          target_role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_sessions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      member_social_links: {
        Row: {
          created_at: string
          ecosystem_id: string
          id: string
          is_public: boolean
          label: string
          platform: string
          sort_order: number
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ecosystem_id: string
          id?: string
          is_public?: boolean
          label?: string
          platform: string
          sort_order?: number
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          ecosystem_id?: string
          id?: string
          is_public?: boolean
          label?: string
          platform?: string
          sort_order?: number
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_social_links_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_applications: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decider_name: string | null
          decider_role: Database["public"]["Enums"]["app_role"] | null
          decision_reason: string | null
          ecosystem_id: string
          email: string
          full_name: string
          id: string
          phone: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decider_name?: string | null
          decider_role?: Database["public"]["Enums"]["app_role"] | null
          decision_reason?: string | null
          ecosystem_id: string
          email: string
          full_name?: string
          id?: string
          phone?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decider_name?: string | null
          decider_role?: Database["public"]["Enums"]["app_role"] | null
          decision_reason?: string | null
          ecosystem_id?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_applications_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
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
      platform_deletion_log: {
        Row: {
          actor_id: string | null
          actor_name: string
          counts: Json
          created_at: string
          ecosystem_id: string
          ecosystem_name: string
          ecosystem_slug: string
          id: string
          reason: string
        }
        Insert: {
          actor_id?: string | null
          actor_name: string
          counts?: Json
          created_at?: string
          ecosystem_id: string
          ecosystem_name: string
          ecosystem_slug: string
          id?: string
          reason: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          counts?: Json
          created_at?: string
          ecosystem_id?: string
          ecosystem_name?: string
          ecosystem_slug?: string
          id?: string
          reason?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          admin_credit_discount_percent: number
          admin_voucher_discount_percent: number
          billing_period: string
          created_at: string
          credit_gcash_account_name: string
          credit_gcash_number: string
          credit_payment_instructions: string
          credit_release_mode: string
          currency: string
          default_admin_sale_commission_percent: number
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
          admin_credit_discount_percent?: number
          admin_voucher_discount_percent?: number
          billing_period?: string
          created_at?: string
          credit_gcash_account_name?: string
          credit_gcash_number?: string
          credit_payment_instructions?: string
          credit_release_mode?: string
          currency?: string
          default_admin_sale_commission_percent?: number
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
          admin_credit_discount_percent?: number
          admin_voucher_discount_percent?: number
          billing_period?: string
          created_at?: string
          credit_gcash_account_name?: string
          credit_gcash_number?: string
          credit_payment_instructions?: string
          credit_release_mode?: string
          currency?: string
          default_admin_sale_commission_percent?: number
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
          avatar_path: string | null
          bio: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          ecosystem_id: string | null
          email: string
          full_name: string
          handle: string | null
          id: string
          is_demo: boolean
          joined_at: string
          phone: string
          preferences: Json
          reseller_commission_percent: number | null
          reseller_discount_percent: number
          reseller_id: string | null
          sale_commission_percent: number | null
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          ecosystem_id?: string | null
          email?: string
          full_name?: string
          handle?: string | null
          id: string
          is_demo?: boolean
          joined_at?: string
          phone?: string
          preferences?: Json
          reseller_commission_percent?: number | null
          reseller_discount_percent?: number
          reseller_id?: string | null
          sale_commission_percent?: number | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          ecosystem_id?: string | null
          email?: string
          full_name?: string
          handle?: string | null
          id?: string
          is_demo?: boolean
          joined_at?: string
          phone?: string
          preferences?: Json
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
      social_ad_events: {
        Row: {
          claimed_at: string | null
          created_at: string
          ecosystem_id: string
          id: string
          provider: string
          provider_event_id: string
          reward_amount: number | null
          user_id: string
          verified: boolean
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          ecosystem_id: string
          id?: string
          provider: string
          provider_event_id: string
          reward_amount?: number | null
          user_id: string
          verified?: boolean
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          ecosystem_id?: string
          id?: string
          provider?: string
          provider_event_id?: string
          reward_amount?: number | null
          user_id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "social_ad_events_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      social_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          ecosystem_id: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          ecosystem_id: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          ecosystem_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_blocks_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      social_comments: {
        Row: {
          author_id: string
          body: string
          charged: boolean
          created_at: string
          ecosystem_id: string
          id: string
          post_id: string
          removed_at: string | null
          removed_by: string | null
          removed_reason: string | null
          status: string
        }
        Insert: {
          author_id: string
          body: string
          charged?: boolean
          created_at?: string
          ecosystem_id: string
          id?: string
          post_id: string
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          status?: string
        }
        Update: {
          author_id?: string
          body?: string
          charged?: boolean
          created_at?: string
          ecosystem_id?: string
          id?: string
          post_id?: string
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_comments_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_credit_accounts: {
        Row: {
          balance: number
          created_at: string
          ecosystem_id: string
          id: string
          last_allowance_on: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          ecosystem_id: string
          id?: string
          last_allowance_on?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          ecosystem_id?: string
          id?: string
          last_allowance_on?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_credit_accounts_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      social_credit_ledger: {
        Row: {
          account_id: string
          amount: number
          balance_after: number
          created_at: string
          direction: string
          ecosystem_id: string
          id: string
          reason: string
          reference: string | null
          source: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          balance_after: number
          created_at?: string
          direction: string
          ecosystem_id: string
          id?: string
          reason: string
          reference?: string | null
          source: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          balance_after?: number
          created_at?: string
          direction?: string
          ecosystem_id?: string
          id?: string
          reason?: string
          reference?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_credit_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_credit_ledger_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      social_likes: {
        Row: {
          created_at: string
          ecosystem_id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ecosystem_id: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          ecosystem_id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_likes_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_distributions: {
        Row: {
          auto_published: boolean
          created_at: string
          ecosystem_id: string
          id: string
          note: string | null
          origin_ecosystem_id: string
          post_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          auto_published?: boolean
          created_at?: string
          ecosystem_id: string
          id?: string
          note?: string | null
          origin_ecosystem_id: string
          post_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          auto_published?: boolean
          created_at?: string
          ecosystem_id?: string
          id?: string
          note?: string | null
          origin_ecosystem_id?: string
          post_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_distributions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_distributions_origin_ecosystem_id_fkey"
            columns: ["origin_ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_distributions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          audience: string
          author_id: string
          body: string
          comment_count: number
          created_at: string
          ecosystem_id: string
          id: string
          image_path: string | null
          like_count: number
          promoted: boolean
          promotion_cost: number | null
          promotion_currency: string | null
          promotion_duration_hours: number | null
          promotion_expires_at: string | null
          promotion_priority: number
          promotion_refund_reason: string | null
          promotion_refunded_at: string | null
          promotion_tier_id: string | null
          promotion_tier_name: string | null
          removed_at: string | null
          removed_by: string | null
          removed_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          audience?: string
          author_id: string
          body: string
          comment_count?: number
          created_at?: string
          ecosystem_id: string
          id?: string
          image_path?: string | null
          like_count?: number
          promoted?: boolean
          promotion_cost?: number | null
          promotion_currency?: string | null
          promotion_duration_hours?: number | null
          promotion_expires_at?: string | null
          promotion_priority?: number
          promotion_refund_reason?: string | null
          promotion_refunded_at?: string | null
          promotion_tier_id?: string | null
          promotion_tier_name?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          audience?: string
          author_id?: string
          body?: string
          comment_count?: number
          created_at?: string
          ecosystem_id?: string
          id?: string
          image_path?: string | null
          like_count?: number
          promoted?: boolean
          promotion_cost?: number | null
          promotion_currency?: string | null
          promotion_duration_hours?: number | null
          promotion_expires_at?: string | null
          promotion_priority?: number
          promotion_refund_reason?: string | null
          promotion_refunded_at?: string | null
          promotion_tier_id?: string | null
          promotion_tier_name?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_promotion_tier_id_fkey"
            columns: ["promotion_tier_id"]
            isOneToOne: false
            referencedRelation: "social_promotion_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      social_promotion_tiers: {
        Row: {
          active: boolean
          created_at: string
          currency: string
          description: string
          duration_hours: number
          ecosystem_id: string | null
          eligibility: string
          id: string
          name: string
          price_points: number
          price_social: number
          priority: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          currency?: string
          description?: string
          duration_hours?: number
          ecosystem_id?: string | null
          eligibility?: string
          id?: string
          name: string
          price_points?: number
          price_social?: number
          priority?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          currency?: string
          description?: string
          duration_hours?: number
          ecosystem_id?: string | null
          eligibility?: string
          id?: string
          name?: string
          price_points?: number
          price_social?: number
          priority?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_promotion_tiers_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      social_reports: {
        Row: {
          created_at: string
          ecosystem_id: string
          handled_at: string | null
          handled_by: string | null
          id: string
          reason: string
          reporter_id: string
          status: string
          target_id: string
          target_type: string
          target_user_id: string | null
        }
        Insert: {
          created_at?: string
          ecosystem_id: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          reason: string
          reporter_id: string
          status?: string
          target_id: string
          target_type: string
          target_user_id?: string | null
        }
        Update: {
          created_at?: string
          ecosystem_id?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          reason?: string
          reporter_id?: string
          status?: string
          target_id?: string
          target_type?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_reports_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      social_settings: {
        Row: {
          ad_daily_limit: number
          ad_provider: string
          ad_reward_amount: number
          ads_enabled: boolean
          allow_admin_overrides: boolean
          comment_cost: number
          created_at: string
          credit_exchange_rate: number
          daily_allowance: number
          id: number
          image_max_kb: number
          image_max_px: number
          max_daily_allowance: number
          max_exchange_rate: number
          points_exchange_rate: number
          post_cost: number
          promotion_cost_points: number
          promotion_cost_social: number
          promotion_currency: string
          promotion_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ad_daily_limit?: number
          ad_provider?: string
          ad_reward_amount?: number
          ads_enabled?: boolean
          allow_admin_overrides?: boolean
          comment_cost?: number
          created_at?: string
          credit_exchange_rate?: number
          daily_allowance?: number
          id?: number
          image_max_kb?: number
          image_max_px?: number
          max_daily_allowance?: number
          max_exchange_rate?: number
          points_exchange_rate?: number
          post_cost?: number
          promotion_cost_points?: number
          promotion_cost_social?: number
          promotion_currency?: string
          promotion_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ad_daily_limit?: number
          ad_provider?: string
          ad_reward_amount?: number
          ads_enabled?: boolean
          allow_admin_overrides?: boolean
          comment_cost?: number
          created_at?: string
          credit_exchange_rate?: number
          daily_allowance?: number
          id?: number
          image_max_kb?: number
          image_max_px?: number
          max_daily_allowance?: number
          max_exchange_rate?: number
          points_exchange_rate?: number
          post_cost?: number
          promotion_cost_points?: number
          promotion_cost_social?: number
          promotion_currency?: string
          promotion_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      subscription_adjustments: {
        Row: {
          actor_id: string | null
          actor_name: string
          created_at: string
          direction: string
          ecosystem_id: string
          id: string
          new_period_end: string
          note: string | null
          previous_period_end: string | null
          reason: string
        }
        Insert: {
          actor_id?: string | null
          actor_name: string
          created_at?: string
          direction: string
          ecosystem_id: string
          id?: string
          new_period_end: string
          note?: string | null
          previous_period_end?: string | null
          reason: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          direction?: string
          ecosystem_id?: string
          id?: string
          new_period_end?: string
          note?: string | null
          previous_period_end?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_adjustments_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
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
          monthly_rate: number | null
          months_purchased: number | null
          payment_reference: string
          period_end: string | null
          period_start: string | null
          plan_name: string
          plan_price: number
          previous_period_end: string | null
          proof_path: string | null
          remainder_amount: number
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
          monthly_rate?: number | null
          months_purchased?: number | null
          payment_reference: string
          period_end?: string | null
          period_start?: string | null
          plan_name: string
          plan_price: number
          previous_period_end?: string | null
          proof_path?: string | null
          remainder_amount?: number
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
          monthly_rate?: number | null
          months_purchased?: number | null
          payment_reference?: string
          period_end?: string | null
          period_start?: string | null
          plan_name?: string
          plan_price?: number
          previous_period_end?: string | null
          proof_path?: string | null
          remainder_amount?: number
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
      test_data_resets: {
        Row: {
          actor_id: string | null
          actor_name: string
          counts: Json
          created_at: string
          ecosystem_id: string
          id: string
          reason: string
        }
        Insert: {
          actor_id?: string | null
          actor_name: string
          counts?: Json
          created_at?: string
          ecosystem_id: string
          id?: string
          reason: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          counts?: Json
          created_at?: string
          ecosystem_id?: string
          id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_data_resets_ecosystem_id_fkey"
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
      acting_as: { Args: never; Returns: string }
      adjust_ecosystem_expiration: {
        Args: {
          _confirm_shorten?: boolean
          _ecosystem_id: string
          _new_period_end: string
          _note?: string
          _reason: string
        }
        Returns: {
          actor_id: string | null
          actor_name: string
          created_at: string
          direction: string
          ecosystem_id: string
          id: string
          new_period_end: string
          note: string | null
          previous_period_end: string | null
          reason: string
        }
        SetofOptions: {
          from: "*"
          to: "subscription_adjustments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
      admin_load_credits: {
        Args: {
          _amount: number
          _reason?: string
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
      admin_sale_commission_rate_for: {
        Args: { _eco: string }
        Returns: number
      }
      admin_update_member_profile: {
        Args: {
          _email?: string
          _full_name?: string
          _phone?: string
          _user_id: string
        }
        Returns: Json
      }
      admin_voucher_discount_percent: { Args: never; Returns: number }
      archive_ecosystem: {
        Args: { _ecosystem_id: string; _reason?: string }
        Returns: string
      }
      assert_actor_active: { Args: never; Returns: undefined }
      can_impersonate: {
        Args: { _operator: string; _target: string }
        Returns: boolean
      }
      can_load_credits: {
        Args: { _actor: string; _target: string }
        Returns: boolean
      }
      can_manage_member_profile: {
        Args: { _actor: string; _target: string }
        Returns: boolean
      }
      can_review_applications: {
        Args: { _ecosystem_id: string; _user_id: string }
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
      create_credit_purchase_order: {
        Args: {
          _note?: string
          _package_id: string
          _payment_reference: string
          _quantity: number
        }
        Returns: {
          amount_due: number
          buyer_id: string
          buyer_name: string
          created_at: string
          credit_ledger_id: string | null
          credits: number
          decision_reason: string | null
          discount_percent: number
          ecosystem_id: string
          freeze_ledger_id: string | null
          id: string
          list_php: number
          note: string | null
          package_id: string | null
          package_name: string
          payment_reference: string
          quantity: number
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
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
          admin_sale_commission_percent: number
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
          facebook_page_name: string | null
          facebook_page_url: string | null
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
      delete_credit_package: { Args: { _id: string }; Returns: undefined }
      delete_customer_account: {
        Args: { _reason?: string; _user_id: string }
        Returns: undefined
      }
      delete_social_promotion_tier: {
        Args: { _tier_id: string }
        Returns: undefined
      }
      delete_voucher_batch: { Args: { _import_id: string }; Returns: number }
      delete_voucher_code: { Args: { _code_id: string }; Returns: undefined }
      dm_messages_for: {
        Args: { _thread_id: string }
        Returns: {
          body: string
          created_at: string
          id: string
          image_path: string
          mine: boolean
          sender_id: string
        }[]
      }
      dm_open_thread: { Args: { _member_id: string }; Returns: string }
      dm_send:
        | { Args: { _body: string; _member_id: string }; Returns: Json }
        | {
            Args: { _body: string; _image_path?: string; _member_id: string }
            Returns: Json
          }
      dm_thread_list: {
        Args: never
        Returns: {
          blocked: boolean
          last_message_at: string
          member_avatar: string
          member_handle: string
          member_id: string
          member_name: string
          preview: string
          thread_id: string
          unread: number
        }[]
      }
      dm_unread_count: { Args: never; Returns: number }
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
      ecosystem_monthly_rate: {
        Args: { _ecosystem_id: string }
        Returns: number
      }
      effective_uid: { Args: never; Returns: string }
      end_impersonation: { Args: never; Returns: undefined }
      expire_stale_invitations: { Args: never; Returns: undefined }
      expire_stale_subscriptions: { Args: never; Returns: number }
      freeze_credit_purchase_order: {
        Args: { _order_id: string; _reason: string }
        Returns: {
          amount_due: number
          buyer_id: string
          buyer_name: string
          created_at: string
          credit_ledger_id: string | null
          credits: number
          decision_reason: string | null
          discount_percent: number
          ecosystem_id: string
          freeze_ledger_id: string | null
          id: string
          list_php: number
          note: string | null
          package_id: string | null
          package_name: string
          payment_reference: string
          quantity: number
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_signup_ecosystem: {
        Args: { _slug: string }
        Returns: {
          description: string
          id: string
          name: string
          slug: string
        }[]
      }
      handle_available: {
        Args: { _ecosystem_id?: string; _handle: string }
        Returns: boolean
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
      list_voucher_batches: {
        Args: { _ecosystem_id: string }
        Returns: {
          actor_name: string
          batch_id: string
          created_at: string
          deletable: boolean
          product_id: string
          product_name: string
          sold_count: number
          source: string
          total_codes: number
          unused_count: number
        }[]
      }
      log_operator_action: {
        Args: {
          _action: string
          _details?: Json
          _eco: string
          _entity: string
          _entity_id: string
          _target: string
        }
        Returns: undefined
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
          avatar_path: string
          full_name: string
          handle: string
          id: string
          masked_email: string
          phone: string
        }[]
      }
      member_email_taken: {
        Args: { _email: string; _exclude?: string }
        Returns: boolean
      }
      months_for_payment: {
        Args: { _amount: number; _rate: number }
        Returns: number
      }
      my_impersonation: {
        Args: never
        Returns: {
          ecosystem_id: string
          expires_at: string
          id: string
          reason: string
          started_at: string
          target_id: string
          target_name: string
          target_role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      my_membership_application: {
        Args: never
        Returns: {
          created_at: string
          decision_reason: string
          ecosystem_name: string
          status: string
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
      normalize_handle: { Args: { _handle: string }; Returns: string }
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
      public_social_links: {
        Args: { _user_id: string }
        Returns: {
          id: string
          label: string
          platform: string
          sort_order: number
          url: string
        }[]
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
      purge_ecosystem: {
        Args: { _confirm_name: string; _ecosystem_id: string; _reason: string }
        Returns: Json
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
      reset_ecosystem_test_data: {
        Args: { _dry_run?: boolean; _ecosystem_id: string; _reason: string }
        Returns: Json
      }
      restructure_member_role: {
        Args: {
          _child_reassignments?: Json
          _new_role: Database["public"]["Enums"]["app_role"]
          _parent_reseller_id?: string
          _reason: string
          _user_id: string
        }
        Returns: Json
      }
      reverse_credit_transfer: {
        Args: {
          _amount: number
          _note?: string
          _reason: string
          _tx_id: string
        }
        Returns: Json
      }
      reverse_sale_commission: {
        Args: { _reason?: string; _sale_id: string }
        Returns: number
      }
      reverse_sale_points: {
        Args: { _reason: string; _sale_id: string }
        Returns: string
      }
      review_credit_purchase_order: {
        Args: { _approve: boolean; _order_id: string; _reason?: string }
        Returns: {
          amount_due: number
          buyer_id: string
          buyer_name: string
          created_at: string
          credit_ledger_id: string | null
          credits: number
          decision_reason: string | null
          discount_percent: number
          ecosystem_id: string
          freeze_ledger_id: string | null
          id: string
          list_php: number
          note: string | null
          package_id: string | null
          package_name: string
          payment_reference: string
          quantity: number
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_membership_application: {
        Args: { _application_id: string; _approve: boolean; _reason?: string }
        Returns: undefined
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
          monthly_rate: number | null
          months_purchased: number | null
          payment_reference: string
          period_end: string | null
          period_start: string | null
          plan_name: string
          plan_price: number
          previous_period_end: string | null
          proof_path: string | null
          remainder_amount: number
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
      role_restructure_check: { Args: { _user_id: string }; Returns: Json }
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
      save_credit_package: {
        Args: {
          _active: boolean
          _credits: number
          _id: string
          _name: string
          _price_php: number
          _sort_order: number
        }
        Returns: {
          active: boolean
          created_at: string
          credits: number
          id: string
          name: string
          price_php: number
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_packages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_members: {
        Args: { _ecosystem_id?: string; _query: string }
        Returns: {
          avatar_path: string
          credit_balance: number
          ecosystem_id: string
          ecosystem_name: string
          email: string
          full_name: string
          handle: string
          id: string
          masked_email: string
          phone: string
          points_balance: number
          role: string
          status: string
        }[]
      }
      set_admin_sale_commission: {
        Args: { _ecosystem_id: string; _percent: number }
        Returns: number
      }
      set_ecosystem_commission: {
        Args: { _ecosystem_id: string; _percent: number }
        Returns: number
      }
      set_ecosystem_facebook: {
        Args: { _ecosystem_id: string; _page_name?: string; _url?: string }
        Returns: {
          admin_sale_commission_percent: number
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
          facebook_page_name: string | null
          facebook_page_url: string | null
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
      set_ecosystem_freeze: {
        Args: { _ecosystem_id: string; _frozen: boolean; _reason?: string }
        Returns: {
          admin_sale_commission_percent: number
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
          facebook_page_name: string | null
          facebook_page_url: string | null
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
          admin_sale_commission_percent: number
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
          facebook_page_name: string | null
          facebook_page_url: string | null
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
      social_admin_activity: {
        Args: { _ecosystem_id?: string; _limit?: number }
        Returns: {
          amount: number
          balance_after: number
          created_at: string
          direction: string
          reason: string
          source: string
          user_id: string
          user_name: string
        }[]
      }
      social_admin_reports: {
        Args: { _ecosystem_id?: string }
        Returns: {
          content: string
          created_at: string
          id: string
          reason: string
          reporter_name: string
          status: string
          target_id: string
          target_name: string
          target_type: string
        }[]
      }
      social_can_moderate: {
        Args: { _eco: string; _user: string }
        Returns: boolean
      }
      social_claim_ad_reward: {
        Args: { _provider: string; _provider_event_id: string }
        Returns: Json
      }
      social_create_comment: {
        Args: { _body: string; _post_id: string }
        Returns: Json
      }
      social_create_post:
        | {
            Args: { _body: string; _image_path?: string; _promote?: boolean }
            Returns: Json
          }
        | {
            Args: {
              _body: string
              _currency?: string
              _image_path?: string
              _promote?: boolean
              _tier_id?: string
            }
            Returns: Json
          }
        | {
            Args: {
              _audience?: string
              _body: string
              _currency?: string
              _image_path?: string
              _promote?: boolean
              _tier_id?: string
            }
            Returns: Json
          }
      social_delete_comment: {
        Args: { _comment_id: string; _reason?: string }
        Returns: undefined
      }
      social_delete_post: {
        Args: { _post_id: string; _reason?: string }
        Returns: undefined
      }
      social_effective_settings: { Args: { _eco: string }; Returns: Json }
      social_exchange: {
        Args: { _amount: number; _kind: string }
        Returns: Json
      }
      social_feed: {
        Args: { _before?: string; _limit?: number }
        Returns: {
          audience: string
          author_avatar: string
          author_handle: string
          author_id: string
          author_name: string
          body: string
          can_delete: boolean
          comment_count: number
          created_at: string
          id: string
          image_path: string
          like_count: number
          liked_by_me: boolean
          origin_ecosystem_name: string
          promoted: boolean
          promotion_expires_at: string
          promotion_tier_name: string
        }[]
      }
      social_general_queue: {
        Args: { _eco?: string; _status?: string }
        Returns: {
          author_avatar: string
          author_handle: string
          author_name: string
          body: string
          created_at: string
          ecosystem_id: string
          id: string
          image_path: string
          note: string
          origin_ecosystem_name: string
          post_created_at: string
          post_id: string
          reviewed_at: string
          reviewed_by_name: string
          status: string
        }[]
      }
      social_move: {
        Args: {
          _amount: number
          _direction: string
          _reason: string
          _reference?: string
          _source: string
          _user: string
        }
        Returns: number
      }
      social_post_comments: {
        Args: { _post_id: string }
        Returns: {
          author_avatar: string
          author_handle: string
          author_id: string
          author_name: string
          body: string
          can_delete: boolean
          created_at: string
          id: string
        }[]
      }
      social_post_distribution_status: {
        Args: { _post_id: string }
        Returns: {
          ecosystem_name: string
          reviewed_at: string
          status: string
        }[]
      }
      social_post_visible_in: {
        Args: { _eco: string; _post_id: string }
        Returns: boolean
      }
      social_rate_limit: {
        Args: {
          _max: number
          _sources: string[]
          _user: string
          _window: string
        }
        Returns: undefined
      }
      social_refund_promotion: {
        Args: { _post_id: string; _reason: string }
        Returns: Json
      }
      social_report: {
        Args: { _reason: string; _target_id: string; _target_type: string }
        Returns: undefined
      }
      social_review_distribution: {
        Args: { _id: string; _note?: string; _status: string }
        Returns: undefined
      }
      social_review_report: {
        Args: { _report_id: string; _status: string }
        Returns: undefined
      }
      social_set_block: {
        Args: { _blocked: boolean; _member_id: string }
        Returns: undefined
      }
      social_state: { Args: never; Returns: Json }
      social_tiers_for: {
        Args: { _eco: string }
        Returns: {
          active: boolean
          currency: string
          description: string
          duration_hours: number
          eligibility: string
          id: string
          is_default: boolean
          name: string
          price_points: number
          price_social: number
          priority: number
          sort_order: number
        }[]
      }
      social_toggle_like: { Args: { _post_id: string }; Returns: Json }
      social_wallet: {
        Args: { _user: string }
        Returns: {
          balance: number
          created_at: string
          ecosystem_id: string
          id: string
          last_allowance_on: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "social_credit_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_impersonation: {
        Args: { _reason?: string; _target: string }
        Returns: string
      }
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
          monthly_rate: number | null
          months_purchased: number | null
          payment_reference: string
          period_end: string | null
          period_start: string | null
          plan_name: string
          plan_price: number
          previous_period_end: string | null
          proof_path: string | null
          remainder_amount: number
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
      top_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      transfer_credits: {
        Args: { _amount: number; _note?: string; _recipient_id: string }
        Returns: string
      }
      transfer_reversal_info: { Args: { _tx_id: string }; Returns: Json }
      update_credit_purchase_settings:
        | {
            Args: {
              _admin_credit_discount_percent: number
              _credit_gcash_account_name: string
              _credit_gcash_number: string
              _credit_payment_instructions: string
              _credit_release_mode: string
              _default_admin_sale_commission_percent: number
            }
            Returns: {
              admin_credit_discount_percent: number
              admin_voucher_discount_percent: number
              billing_period: string
              created_at: string
              credit_gcash_account_name: string
              credit_gcash_number: string
              credit_payment_instructions: string
              credit_release_mode: string
              currency: string
              default_admin_sale_commission_percent: number
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
        | {
            Args: {
              _admin_credit_discount_percent: number
              _admin_voucher_discount_percent?: number
              _credit_gcash_account_name: string
              _credit_gcash_number: string
              _credit_payment_instructions: string
              _credit_release_mode: string
              _default_admin_sale_commission_percent: number
            }
            Returns: {
              admin_credit_discount_percent: number
              admin_voucher_discount_percent: number
              billing_period: string
              created_at: string
              credit_gcash_account_name: string
              credit_gcash_number: string
              credit_payment_instructions: string
              credit_release_mode: string
              currency: string
              default_admin_sale_commission_percent: number
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
          admin_sale_commission_percent: number
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
          facebook_page_name: string | null
          facebook_page_url: string | null
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
          admin_sale_commission_percent: number
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
          facebook_page_name: string | null
          facebook_page_url: string | null
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
      update_ecosystem_social_settings: {
        Args: {
          _comment_cost?: number
          _credit_exchange_rate?: number
          _daily_allowance?: number
          _ecosystem_id?: string
          _points_exchange_rate?: number
          _post_cost?: number
          _promotion_enabled?: boolean
          _social_enabled: boolean
        }
        Returns: Json
      }
      update_own_contact: {
        Args: { _email: string; _phone: string }
        Returns: Json
      }
      update_own_profile: {
        Args: {
          _avatar_path?: string
          _bio?: string
          _clear_avatar?: boolean
          _full_name?: string
          _handle?: string
          _preferences?: Json
        }
        Returns: Json
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
          admin_credit_discount_percent: number
          admin_voucher_discount_percent: number
          billing_period: string
          created_at: string
          credit_gcash_account_name: string
          credit_gcash_number: string
          credit_payment_instructions: string
          credit_release_mode: string
          currency: string
          default_admin_sale_commission_percent: number
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
      update_social_settings: {
        Args: {
          _ad_daily_limit: number
          _ad_provider?: string
          _ad_reward_amount: number
          _ads_enabled: boolean
          _allow_admin_overrides?: boolean
          _comment_cost: number
          _credit_exchange_rate: number
          _daily_allowance: number
          _image_max_kb?: number
          _image_max_px?: number
          _max_daily_allowance?: number
          _max_exchange_rate?: number
          _points_exchange_rate: number
          _post_cost: number
          _promotion_cost_points: number
          _promotion_cost_social: number
          _promotion_currency: string
          _promotion_enabled: boolean
        }
        Returns: {
          ad_daily_limit: number
          ad_provider: string
          ad_reward_amount: number
          ads_enabled: boolean
          allow_admin_overrides: boolean
          comment_cost: number
          created_at: string
          credit_exchange_rate: number
          daily_allowance: number
          id: number
          image_max_kb: number
          image_max_px: number
          max_daily_allowance: number
          max_exchange_rate: number
          points_exchange_rate: number
          post_cost: number
          promotion_cost_points: number
          promotion_cost_social: number
          promotion_currency: string
          promotion_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "social_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upline_commission_rate_for: {
        Args: { _ecosystem_id: string }
        Returns: number
      }
      upsert_social_promotion_tier: {
        Args: {
          _active: boolean
          _currency: string
          _description: string
          _duration_hours: number
          _ecosystem_id?: string
          _eligibility: string
          _name: string
          _price_points: number
          _price_social: number
          _priority: number
          _sort_order?: number
          _tier_id?: string
        }
        Returns: string
      }
      voucher_discount_percent_for: {
        Args: { _user_id: string }
        Returns: number
      }
      wallet_integrity_check: {
        Args: never
        Returns: {
          account_id: string
          balance: number
          difference: number
          ecosystem_id: string
          kind: string
          ledger_sum: number
          member_name: string
          oldest_entry: string
          purge_explained: boolean
          user_id: string
        }[]
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
