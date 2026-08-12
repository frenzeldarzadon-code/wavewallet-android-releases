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
      bootstrap_roles: {
        Row: {
          consumed_at: string | null
          created_at: string
          ecosystem_id: string | null
          email: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          ecosystem_id?: string | null
          email: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          ecosystem_id?: string | null
          email?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "bootstrap_roles_ecosystem_id_fkey"
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
          created_at: string
          direction: string
          ecosystem_id: string
          id: string
          reason: string
          reference: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          actor_id?: string | null
          amount: number
          balance_after: number
          created_at?: string
          direction: string
          ecosystem_id: string
          id?: string
          reason: string
          reference?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          actor_id?: string | null
          amount?: number
          balance_after?: number
          created_at?: string
          direction?: string
          ecosystem_id?: string
          id?: string
          reason?: string
          reference?: string | null
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
          current_period_end: string | null
          description: string | null
          grace_period_days: number
          id: string
          name: string
          payment_reference: string | null
          plan_name: string
          plan_price: number
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
          current_period_end?: string | null
          description?: string | null
          grace_period_days?: number
          id?: string
          name: string
          payment_reference?: string | null
          plan_name?: string
          plan_price?: number
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
          current_period_end?: string | null
          description?: string | null
          grace_period_days?: number
          id?: string
          name?: string
          payment_reference?: string | null
          plan_name?: string
          plan_price?: number
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
          direction: string
          ecosystem_id: string
          id: string
          reason: string
          reference: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          actor_id?: string | null
          amount: number
          balance_after: number
          created_at?: string
          direction: string
          ecosystem_id: string
          id?: string
          reason: string
          reference?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          actor_id?: string | null
          amount?: number
          balance_after?: number
          created_at?: string
          direction?: string
          ecosystem_id?: string
          id?: string
          reason?: string
          reference?: string | null
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
      current_ecosystem: { Args: { _user_id: string }; Returns: string }
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
      promote_to_reseller: {
        Args: { _discount: number; _user_id: string }
        Returns: undefined
      }
      regenerate_signup_token: {
        Args: { _ecosystem_id: string }
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
      set_reseller_discount: {
        Args: { _discount: number; _user_id: string }
        Returns: undefined
      }
      submit_subscription_payment: {
        Args: { _ecosystem_id: string; _reference: string }
        Returns: undefined
      }
      subscription_ok: { Args: { _ecosystem_id: string }; Returns: boolean }
    }
    Enums: {
      account_status: "active" | "suspended"
      app_role: "super_admin" | "admin" | "reseller" | "customer"
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
      app_role: ["super_admin", "admin", "reseller", "customer"],
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
