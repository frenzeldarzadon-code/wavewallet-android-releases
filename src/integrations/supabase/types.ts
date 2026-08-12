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
          id: string
          reason: string
          reference: string | null
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
          id?: string
          reason: string
          reference?: string | null
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
          id?: string
          reason?: string
          reference?: string | null
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
        ]
      }
      ecosystems: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credits_per_point: number
          current_period_end: string | null
          description: string | null
          grace_period_days: number
          id: string
          name: string
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
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          credits_per_point?: number
          current_period_end?: string | null
          description?: string | null
          grace_period_days?: number
          id?: string
          name: string
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
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          credits_per_point?: number
          current_period_end?: string | null
          description?: string | null
          grace_period_days?: number
          id?: string
          name?: string
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
          ecosystem_id: string | null
          email: string
          full_name: string
          id: string
          joined_at: string
          phone: string
          reseller_commission_percent: number
          reseller_discount_percent: number
          reseller_id: string | null
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          ecosystem_id?: string | null
          email?: string
          full_name?: string
          id: string
          joined_at?: string
          phone?: string
          reseller_commission_percent?: number
          reseller_discount_percent?: number
          reseller_id?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          ecosystem_id?: string | null
          email?: string
          full_name?: string
          id?: string
          joined_at?: string
          phone?: string
          reseller_commission_percent?: number
          reseller_discount_percent?: number
          reseller_id?: string | null
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
          created_at: string
          credits_per_point_used: number | null
          discount_amount: number
          discount_percent: number
          ecosystem_id: string
          id: string
          list_price: number
          payment_method: string
          points_earned: number
          points_price: number | null
          points_rule_version: number | null
          points_spent: number
          product_id: string
          product_name: string
          reseller_id: string | null
          sale_price: number
          tx_id: string
        }
        Insert: {
          buyer_id: string
          buyer_role: Database["public"]["Enums"]["app_role"]
          created_at?: string
          credits_per_point_used?: number | null
          discount_amount?: number
          discount_percent?: number
          ecosystem_id: string
          id?: string
          list_price: number
          payment_method?: string
          points_earned?: number
          points_price?: number | null
          points_rule_version?: number | null
          points_spent?: number
          product_id: string
          product_name: string
          reseller_id?: string | null
          sale_price: number
          tx_id: string
        }
        Update: {
          buyer_id?: string
          buyer_role?: Database["public"]["Enums"]["app_role"]
          created_at?: string
          credits_per_point_used?: number | null
          discount_amount?: number
          discount_percent?: number
          ecosystem_id?: string
          id?: string
          list_price?: number
          payment_method?: string
          points_earned?: number
          points_price?: number | null
          points_rule_version?: number | null
          points_spent?: number
          product_id?: string
          product_name?: string
          reseller_id?: string | null
          sale_price?: number
          tx_id?: string
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
      commission_rate_for: {
        Args: { _recipient: string; _sender: string }
        Returns: number
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
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credits_per_point: number
          current_period_end: string | null
          description: string | null
          grace_period_days: number
          id: string
          name: string
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
      ecosystem_dashboard: {
        Args: { _ecosystem_id: string }
        Returns: {
          credits_outstanding: number
          customer_count: number
          member_count: number
          points_outstanding: number
          reseller_count: number
          suspended_count: number
        }[]
      }
      expire_stale_invitations: { Args: never; Returns: undefined }
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
          contact_email: string
          contact_phone: string
          created_at: string
          current_period_end: string
          description: string
          grace_period_days: number
          id: string
          member_count: number
          name: string
          payment_reference: string
          plan_name: string
          plan_price: number
          reseller_count: number
          reviewed_at: string
          signup_enabled: boolean
          signup_token: string
          slug: string
          submitted_at: string
          subscription_state: Database["public"]["Enums"]["subscription_state"]
        }[]
      }
      promote_to_reseller: {
        Args: { _discount: number; _user_id: string }
        Returns: undefined
      }
      promote_to_subreseller: {
        Args: { _discount: number; _user_id: string }
        Returns: undefined
      }
      purchase_voucher: {
        Args: { _product_id: string }
        Returns: {
          code: string
          points_earned: number
          product_name: string
          sale_id: string
          sale_price: number
          tx_id: string
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
      regenerate_signup_token: {
        Args: { _ecosystem_id: string }
        Returns: string
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
      reseller_load_credits: {
        Args: { _amount: number; _customer_id: string; _reference?: string }
        Returns: string
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
      revoke_admin_invitation: { Args: { _id: string }; Returns: undefined }
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
      slugify: { Args: { _value: string }; Returns: string }
      submit_subscription_payment: {
        Args: { _ecosystem_id: string; _reference: string }
        Returns: undefined
      }
      subscription_ok: { Args: { _ecosystem_id: string }; Returns: boolean }
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
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credits_per_point: number
          current_period_end: string | null
          description: string | null
          grace_period_days: number
          id: string
          name: string
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
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credits_per_point: number
          current_period_end: string | null
          description: string | null
          grace_period_days: number
          id: string
          name: string
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
