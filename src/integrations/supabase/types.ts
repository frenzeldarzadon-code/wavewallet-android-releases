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
    PostgrestVersion: "14.5"
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_invitations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      app_release: {
        Row: {
          android_download_count: number
          android_download_url: string
          android_enabled: boolean
          android_min_os: string
          android_release_date: string | null
          android_release_notes: string
          android_sha256: string
          android_size_bytes: number
          android_version: string
          created_at: string
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          android_download_count?: number
          android_download_url?: string
          android_enabled?: boolean
          android_min_os?: string
          android_release_date?: string | null
          android_release_notes?: string
          android_sha256?: string
          android_size_bytes?: number
          android_version?: string
          created_at?: string
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          android_download_count?: number
          android_download_url?: string
          android_enabled?: boolean
          android_min_os?: string
          android_release_date?: string | null
          android_release_notes?: string
          android_sha256?: string
          android_size_bytes?: number
          android_version?: string
          created_at?: string
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      business_expenses: {
        Row: {
          amount: number
          category: string | null
          category_id: string | null
          client_ref: string | null
          created_at: string
          created_by: string
          created_by_name: string | null
          currency: string
          description: string
          ecosystem_id: string | null
          id: string
          notes: string | null
          provider: string | null
          provider_reference: string | null
          scope: string
          spent_at: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string | null
          category_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by: string
          created_by_name?: string | null
          currency?: string
          description: string
          ecosystem_id?: string | null
          id?: string
          notes?: string | null
          provider?: string | null
          provider_reference?: string | null
          scope: string
          spent_at?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string | null
          category_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by?: string
          created_by_name?: string | null
          currency?: string
          description?: string
          ecosystem_id?: string | null
          id?: string
          notes?: string | null
          provider?: string | null
          provider_reference?: string | null
          scope?: string
          spent_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "spending_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_expenses_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_expenses_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_in_auto_rules: {
        Row: {
          amount_tolerance_php: number
          ecosystem_id: string | null
          enabled: boolean
          expected_amount_php: number | null
          id: string
          layer1_require_amount: boolean
          layer1_require_sender_number: boolean
          layer1_require_time_window: boolean
          layer2_require_amount_match: boolean
          layer2_require_listener_reference: boolean
          layer2_require_sender_match: boolean
          max_auto_amount_php: number | null
          require_listener_match: boolean
          require_receipt_match: boolean
          require_reference_match: boolean
          updated_at: string
          updated_by: string | null
          verification_mode: string
        }
        Insert: {
          amount_tolerance_php?: number
          ecosystem_id?: string | null
          enabled?: boolean
          expected_amount_php?: number | null
          id?: string
          layer1_require_amount?: boolean
          layer1_require_sender_number?: boolean
          layer1_require_time_window?: boolean
          layer2_require_amount_match?: boolean
          layer2_require_listener_reference?: boolean
          layer2_require_sender_match?: boolean
          max_auto_amount_php?: number | null
          require_listener_match?: boolean
          require_receipt_match?: boolean
          require_reference_match?: boolean
          updated_at?: string
          updated_by?: string | null
          verification_mode?: string
        }
        Update: {
          amount_tolerance_php?: number
          ecosystem_id?: string | null
          enabled?: boolean
          expected_amount_php?: number | null
          id?: string
          layer1_require_amount?: boolean
          layer1_require_sender_number?: boolean
          layer1_require_time_window?: boolean
          layer2_require_amount_match?: boolean
          layer2_require_listener_reference?: boolean
          layer2_require_sender_match?: boolean
          max_auto_amount_php?: number | null
          require_listener_match?: boolean
          require_receipt_match?: boolean
          require_reference_match?: boolean
          updated_at?: string
          updated_by?: string | null
          verification_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_in_auto_rules_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_auto_rules_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_auto_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_in_reference_conflicts: {
        Row: {
          created_at: string
          credited_at: string | null
          credited_first: string | null
          ecosystem_id: string | null
          id: string
          new_request_id: string
          new_snapshot: Json
          old_request_id: string | null
          old_snapshot: Json
          reference: string | null
          reference_key: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          credited_at?: string | null
          credited_first?: string | null
          ecosystem_id?: string | null
          id?: string
          new_request_id: string
          new_snapshot?: Json
          old_request_id?: string | null
          old_snapshot?: Json
          reference?: string | null
          reference_key: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          credited_at?: string | null
          credited_first?: string | null
          ecosystem_id?: string | null
          id?: string
          new_request_id?: string
          new_snapshot?: Json
          old_request_id?: string | null
          old_snapshot?: Json
          reference?: string | null
          reference_key?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_in_reference_conflicts_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_reference_conflicts_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_reference_conflicts_new_request_id_fkey"
            columns: ["new_request_id"]
            isOneToOne: true
            referencedRelation: "cash_in_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_reference_conflicts_old_request_id_fkey"
            columns: ["old_request_id"]
            isOneToOne: false
            referencedRelation: "cash_in_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_reference_conflicts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_in_requests: {
        Row: {
          amount_php: number
          approval_method: string
          authentication_checked_at: string | null
          authentication_reason: string | null
          auto_match_note: string | null
          created_at: string
          credits: number
          decision_reason: string | null
          duplicate_of: string | null
          duplicate_receipt: boolean
          duplicate_receipt_of: string | null
          duplicate_reference: boolean
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          funding_account_id: string | null
          funding_admin_id: string | null
          funding_ledger_id: string | null
          funding_source: string
          id: string
          ledger_id: string | null
          listener_event_id: string | null
          method_details: Json
          method_id: string | null
          method_name: string
          method_type: string
          net_php: number | null
          notes: string | null
          ocr_amount_php: number | null
          ocr_details: Json | null
          ocr_paid_at: string | null
          ocr_reference: string | null
          ocr_reference_key: string | null
          ocr_sender_number: string | null
          ocr_sender_number_key: string | null
          paid_at: string | null
          paid_at_edited: boolean
          payer_number: string | null
          payer_number_key: string | null
          payer_reference: string | null
          payer_reference_key: string | null
          payment_authenticated: boolean
          proof_hash: string | null
          proof_path: string | null
          provider_id: string | null
          provider_source: string | null
          rate_credits: number
          rate_php: number
          receipt_amount_php: number | null
          receipt_check: string
          receipt_checked_at: string | null
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_account_masked: string | null
          receipt_receiving_number: string | null
          receipt_receiving_number_key: string | null
          receipt_reference: string | null
          receipt_reference_key: string | null
          receipt_sender_account_masked: string | null
          receipt_sender_name: string | null
          receipt_sender_number: string | null
          receipt_sender_number_key: string | null
          receipt_verified: boolean
          reference: string
          reference_edited: boolean
          reference_source: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          sender_number: string | null
          sender_number_key: string | null
          staged_at: string | null
          staged_result: string | null
          status: string
          updated_at: string
          user_id: string
          verified_payment_id: string | null
          wallet_scope: string
        }
        Insert: {
          amount_php: number
          approval_method?: string
          authentication_checked_at?: string | null
          authentication_reason?: string | null
          auto_match_note?: string | null
          created_at?: string
          credits: number
          decision_reason?: string | null
          duplicate_of?: string | null
          duplicate_receipt?: boolean
          duplicate_receipt_of?: string | null
          duplicate_reference?: boolean
          ecosystem_id?: string | null
          fee_percent?: number
          fee_php?: number
          funding_account_id?: string | null
          funding_admin_id?: string | null
          funding_ledger_id?: string | null
          funding_source?: string
          id?: string
          ledger_id?: string | null
          listener_event_id?: string | null
          method_details?: Json
          method_id?: string | null
          method_name: string
          method_type: string
          net_php?: number | null
          notes?: string | null
          ocr_amount_php?: number | null
          ocr_details?: Json | null
          ocr_paid_at?: string | null
          ocr_reference?: string | null
          ocr_reference_key?: string | null
          ocr_sender_number?: string | null
          ocr_sender_number_key?: string | null
          paid_at?: string | null
          paid_at_edited?: boolean
          payer_number?: string | null
          payer_number_key?: string | null
          payer_reference?: string | null
          payer_reference_key?: string | null
          payment_authenticated?: boolean
          proof_hash?: string | null
          proof_path?: string | null
          provider_id?: string | null
          provider_source?: string | null
          rate_credits: number
          rate_php: number
          receipt_amount_php?: number | null
          receipt_check?: string
          receipt_checked_at?: string | null
          receipt_details?: Json | null
          receipt_paid_at?: string | null
          receipt_receiving_account_masked?: string | null
          receipt_receiving_number?: string | null
          receipt_receiving_number_key?: string | null
          receipt_reference?: string | null
          receipt_reference_key?: string | null
          receipt_sender_account_masked?: string | null
          receipt_sender_name?: string | null
          receipt_sender_number?: string | null
          receipt_sender_number_key?: string | null
          receipt_verified?: boolean
          reference: string
          reference_edited?: boolean
          reference_source?: string | null
          request_key?: string | null
          requester_name: string
          requester_role: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_name?: string | null
          sender_number?: string | null
          sender_number_key?: string | null
          staged_at?: string | null
          staged_result?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verified_payment_id?: string | null
          wallet_scope?: string
        }
        Update: {
          amount_php?: number
          approval_method?: string
          authentication_checked_at?: string | null
          authentication_reason?: string | null
          auto_match_note?: string | null
          created_at?: string
          credits?: number
          decision_reason?: string | null
          duplicate_of?: string | null
          duplicate_receipt?: boolean
          duplicate_receipt_of?: string | null
          duplicate_reference?: boolean
          ecosystem_id?: string | null
          fee_percent?: number
          fee_php?: number
          funding_account_id?: string | null
          funding_admin_id?: string | null
          funding_ledger_id?: string | null
          funding_source?: string
          id?: string
          ledger_id?: string | null
          listener_event_id?: string | null
          method_details?: Json
          method_id?: string | null
          method_name?: string
          method_type?: string
          net_php?: number | null
          notes?: string | null
          ocr_amount_php?: number | null
          ocr_details?: Json | null
          ocr_paid_at?: string | null
          ocr_reference?: string | null
          ocr_reference_key?: string | null
          ocr_sender_number?: string | null
          ocr_sender_number_key?: string | null
          paid_at?: string | null
          paid_at_edited?: boolean
          payer_number?: string | null
          payer_number_key?: string | null
          payer_reference?: string | null
          payer_reference_key?: string | null
          payment_authenticated?: boolean
          proof_hash?: string | null
          proof_path?: string | null
          provider_id?: string | null
          provider_source?: string | null
          rate_credits?: number
          rate_php?: number
          receipt_amount_php?: number | null
          receipt_check?: string
          receipt_checked_at?: string | null
          receipt_details?: Json | null
          receipt_paid_at?: string | null
          receipt_receiving_account_masked?: string | null
          receipt_receiving_number?: string | null
          receipt_receiving_number_key?: string | null
          receipt_reference?: string | null
          receipt_reference_key?: string | null
          receipt_sender_account_masked?: string | null
          receipt_sender_name?: string | null
          receipt_sender_number?: string | null
          receipt_sender_number_key?: string | null
          receipt_verified?: boolean
          reference?: string
          reference_edited?: boolean
          reference_source?: string | null
          request_key?: string | null
          requester_name?: string
          requester_role?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_name?: string | null
          sender_number?: string | null
          sender_number_key?: string | null
          staged_at?: string | null
          staged_result?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verified_payment_id?: string | null
          wallet_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_in_requests_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "cash_in_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_requests_duplicate_receipt_of_fkey"
            columns: ["duplicate_receipt_of"]
            isOneToOne: false
            referencedRelation: "cash_in_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_requests_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_requests_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_requests_funding_account_id_fkey"
            columns: ["funding_account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_requests_funding_admin_id_fkey"
            columns: ["funding_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_requests_funding_ledger_id_fkey"
            columns: ["funding_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_requests_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_requests_listener_event_id_fkey"
            columns: ["listener_event_id"]
            isOneToOne: false
            referencedRelation: "listener_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_requests_method_id_fkey"
            columns: ["method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_in_requests_verified_payment_id_fkey"
            columns: ["verified_payment_id"]
            isOneToOne: false
            referencedRelation: "verified_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_accounts: {
        Row: {
          balance: number
          created_at: string
          ecosystem_id: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_accounts_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
          ecosystem_id: string | null
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
          ecosystem_id?: string | null
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
          ecosystem_id?: string | null
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
            referencedRelation: "discoverable_shops"
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
          ecosystem_id: string | null
          id: string
          ledger_id: string
          lot_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          ledger_id: string
          lot_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          ecosystem_id?: string | null
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
          ecosystem_id: string | null
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
          ecosystem_id?: string | null
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
          ecosystem_id?: string | null
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "discoverable_shops"
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
      demo_ledger: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          direction: string
          ecosystem_id: string
          entry_kind: string
          id: string
          member_key: string
          reason: string
          tx_id: string | null
        }
        Insert: {
          amount: number
          balance_after?: number
          created_at?: string
          direction: string
          ecosystem_id: string
          entry_kind?: string
          id?: string
          member_key: string
          reason?: string
          tx_id?: string | null
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          direction?: string
          ecosystem_id?: string
          entry_kind?: string
          id?: string
          member_key?: string
          reason?: string
          tx_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demo_ledger_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_ledger_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_vouchers: {
        Row: {
          created_at: string
          description: string
          display_order: number
          ecosystem_id: string
          id: string
          name: string
          price: number
          stock: number
        }
        Insert: {
          created_at?: string
          description?: string
          display_order?: number
          ecosystem_id: string
          id?: string
          name: string
          price: number
          stock?: number
        }
        Update: {
          created_at?: string
          description?: string
          display_order?: number
          ecosystem_id?: string
          id?: string
          name?: string
          price?: number
          stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "demo_vouchers_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_vouchers_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_wallets: {
        Row: {
          balance: number
          created_at: string
          display_name: string
          ecosystem_id: string
          id: string
          member_key: string
          parent_key: string | null
          points: number
          role: string
        }
        Insert: {
          balance?: number
          created_at?: string
          display_name: string
          ecosystem_id: string
          id?: string
          member_key: string
          parent_key?: string | null
          points?: number
          role: string
        }
        Update: {
          balance?: number
          created_at?: string
          display_name?: string
          ecosystem_id?: string
          id?: string
          member_key?: string
          parent_key?: string | null
          points?: number
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_wallets_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_wallets_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_messages: {
        Row: {
          body: string
          created_at: string
          ecosystem_id: string | null
          id: string
          image_path: string | null
          read_at: string | null
          recipient_id: string | null
          sender_id: string
          thread_id: string
        }
        Insert: {
          body: string
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          image_path?: string | null
          read_at?: string | null
          recipient_id?: string | null
          sender_id: string
          thread_id: string
        }
        Update: {
          body?: string
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          image_path?: string | null
          read_at?: string | null
          recipient_id?: string | null
          sender_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_messages_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
      dm_thread_members: {
        Row: {
          added_at: string
          last_read_at: string | null
          member_role: string
          removed_at: string | null
          thread_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          last_read_at?: string | null
          member_role?: string
          removed_at?: string | null
          thread_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          last_read_at?: string | null
          member_role?: string
          removed_at?: string | null
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_thread_members_thread_id_fkey"
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
          ecosystem_id: string | null
          id: string
          kind: string
          last_message_at: string | null
          last_message_preview: string | null
          order_id: string | null
          title: string | null
          user_a: string | null
          user_b: string | null
        }
        Insert: {
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          order_id?: string | null
          title?: string | null
          user_a?: string | null
          user_b?: string | null
        }
        Update: {
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          order_id?: string | null
          title?: string | null
          user_a?: string | null
          user_b?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dm_threads_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_threads_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_threads_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "retail_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      earnings_reconciliation_adjustments: {
        Row: {
          actor_id: string | null
          corrected_amount: number
          corrected_percent: number | null
          correction_tx_id: string
          created_at: string
          delta: number
          id: string
          kind: string
          previous_amount: number
          previous_percent: number | null
          reason: string
          recipient_id: string
          sale_id: string | null
        }
        Insert: {
          actor_id?: string | null
          corrected_amount: number
          corrected_percent?: number | null
          correction_tx_id: string
          created_at?: string
          delta: number
          id?: string
          kind: string
          previous_amount: number
          previous_percent?: number | null
          reason: string
          recipient_id: string
          sale_id?: string | null
        }
        Update: {
          actor_id?: string | null
          corrected_amount?: number
          corrected_percent?: number | null
          correction_tx_id?: string
          created_at?: string
          delta?: number
          id?: string
          kind?: string
          previous_amount?: number
          previous_percent?: number | null
          reason?: string
          recipient_id?: string
          sale_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "earnings_reconciliation_adjustments_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_reconciliation_adjustments_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_reconciliation_adjustments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "voucher_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      ecosystem_invitations: {
        Row: {
          cancelled_by: string | null
          created_at: string
          ecosystem_id: string
          expires_at: string | null
          id: string
          invited_by: string | null
          inviter_name: string
          inviter_role: Database["public"]["Enums"]["app_role"] | null
          message: string | null
          responded_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_by?: string | null
          created_at?: string
          ecosystem_id: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          inviter_name?: string
          inviter_role?: Database["public"]["Enums"]["app_role"] | null
          message?: string | null
          responded_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_by?: string | null
          created_at?: string
          ecosystem_id?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          inviter_name?: string
          inviter_role?: Database["public"]["Enums"]["app_role"] | null
          message?: string | null
          responded_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecosystem_invitations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecosystem_invitations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      ecosystem_memberships: {
        Row: {
          created_at: string
          ecosystem_id: string
          handle: string | null
          id: string
          joined_at: string
          membership_state: string
          reseller_commission_percent: number | null
          reseller_discount_percent: number
          reseller_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          sale_commission_percent: number | null
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ecosystem_id: string
          handle?: string | null
          id?: string
          joined_at?: string
          membership_state?: string
          reseller_commission_percent?: number | null
          reseller_discount_percent?: number
          reseller_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          sale_commission_percent?: number | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ecosystem_id?: string
          handle?: string | null
          id?: string
          joined_at?: string
          membership_state?: string
          reseller_commission_percent?: number | null
          reseller_discount_percent?: number
          reseller_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          sale_commission_percent?: number | null
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecosystem_memberships_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecosystem_memberships_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      ecosystem_reviews: {
        Row: {
          author_name: string
          comment: string | null
          created_at: string
          ecosystem_id: string
          id: string
          rating: number
          updated_at: string
          user_id: string
        }
        Insert: {
          author_name: string
          comment?: string | null
          created_at?: string
          ecosystem_id: string
          id?: string
          rating: number
          updated_at?: string
          user_id: string
        }
        Update: {
          author_name?: string
          comment?: string | null
          created_at?: string
          ecosystem_id?: string
          id?: string
          rating?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecosystem_reviews_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecosystem_reviews_ecosystem_id_fkey"
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
          free_posts_per_day: number | null
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
          free_posts_per_day?: number | null
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
          free_posts_per_day?: number | null
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
          admin_assigned_at: string | null
          admin_assigned_by: string | null
          admin_sale_commission_percent: number
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          cash_in_gcash_number: string | null
          contact_email: string | null
          contact_name: string | null
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
          is_review: boolean
          is_test: boolean
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          public_storefront_enabled: boolean
          retail_accepting_orders: boolean
          retail_cash_enabled: boolean
          retail_cod_enabled: boolean
          retail_cover_path: string | null
          retail_credit_enabled: boolean
          retail_delivery_enabled: boolean
          retail_delivery_fee: number
          retail_delivery_split_collector_pct: number
          retail_delivery_split_delivery_pct: number
          retail_logo_path: string | null
          retail_paused_note: string | null
          retail_pickup_enabled: boolean
          retail_storefront_theme: string
          review_ends_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_barangay: string | null
          shop_city_municipality: string | null
          shop_code: string | null
          shop_kind: string
          shop_province: string | null
          shop_street: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          store_retail_enabled: boolean
          store_voucher_enabled: boolean
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
          use_platform_payment_methods: boolean
        }
        Insert: {
          admin_assigned_at?: string | null
          admin_assigned_by?: string | null
          admin_sale_commission_percent?: number
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          cash_in_gcash_number?: string | null
          contact_email?: string | null
          contact_name?: string | null
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
          is_review?: boolean
          is_test?: boolean
          last_activity_at?: string | null
          name: string
          operations_frozen?: boolean
          payment_reference?: string | null
          plan_name?: string
          plan_price?: number
          points_rule_updated_at?: string
          points_rule_version?: number
          public_storefront_enabled?: boolean
          retail_accepting_orders?: boolean
          retail_cash_enabled?: boolean
          retail_cod_enabled?: boolean
          retail_cover_path?: string | null
          retail_credit_enabled?: boolean
          retail_delivery_enabled?: boolean
          retail_delivery_fee?: number
          retail_delivery_split_collector_pct?: number
          retail_delivery_split_delivery_pct?: number
          retail_logo_path?: string | null
          retail_paused_note?: string | null
          retail_pickup_enabled?: boolean
          retail_storefront_theme?: string
          review_ends_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shop_barangay?: string | null
          shop_city_municipality?: string | null
          shop_code?: string | null
          shop_kind?: string
          shop_province?: string | null
          shop_street?: string | null
          signup_enabled?: boolean
          signup_token?: string
          slug: string
          store_retail_enabled?: boolean
          store_voucher_enabled?: boolean
          submitted_at?: string | null
          subscription_state?: Database["public"]["Enums"]["subscription_state"]
          updated_at?: string
          use_platform_payment_methods?: boolean
        }
        Update: {
          admin_assigned_at?: string | null
          admin_assigned_by?: string | null
          admin_sale_commission_percent?: number
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          cash_in_gcash_number?: string | null
          contact_email?: string | null
          contact_name?: string | null
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
          is_review?: boolean
          is_test?: boolean
          last_activity_at?: string | null
          name?: string
          operations_frozen?: boolean
          payment_reference?: string | null
          plan_name?: string
          plan_price?: number
          points_rule_updated_at?: string
          points_rule_version?: number
          public_storefront_enabled?: boolean
          retail_accepting_orders?: boolean
          retail_cash_enabled?: boolean
          retail_cod_enabled?: boolean
          retail_cover_path?: string | null
          retail_credit_enabled?: boolean
          retail_delivery_enabled?: boolean
          retail_delivery_fee?: number
          retail_delivery_split_collector_pct?: number
          retail_delivery_split_delivery_pct?: number
          retail_logo_path?: string | null
          retail_paused_note?: string | null
          retail_pickup_enabled?: boolean
          retail_storefront_theme?: string
          review_ends_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shop_barangay?: string | null
          shop_city_municipality?: string | null
          shop_code?: string | null
          shop_kind?: string
          shop_province?: string | null
          shop_street?: string | null
          signup_enabled?: boolean
          signup_token?: string
          slug?: string
          store_retail_enabled?: boolean
          store_voucher_enabled?: boolean
          submitted_at?: string | null
          subscription_state?: Database["public"]["Enums"]["subscription_state"]
          updated_at?: string
          use_platform_payment_methods?: boolean
        }
        Relationships: []
      }
      guide_faqs: {
        Row: {
          answer: string
          created_at: string
          display_order: number
          id: string
          published: boolean
          question: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          answer: string
          created_at?: string
          display_order?: number
          id?: string
          published?: boolean
          question: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          answer?: string
          created_at?: string
          display_order?: number
          id?: string
          published?: boolean
          question?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      guide_questions: {
        Row: {
          answer: string | null
          answered_at: string | null
          contact: string | null
          created_at: string
          id: string
          question: string
          status: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          question: string
          status?: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          question?: string
          status?: string
        }
        Relationships: []
      }
      guide_sections: {
        Row: {
          body: string
          created_at: string
          display_order: number
          heading: string
          id: string
          image_url: string | null
          published: boolean
          section_key: string
          subheading: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body?: string
          created_at?: string
          display_order?: number
          heading: string
          id?: string
          image_url?: string | null
          published?: boolean
          section_key: string
          subheading?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          display_order?: number
          heading?: string
          id?: string
          image_url?: string | null
          published?: boolean
          section_key?: string
          subheading?: string | null
          updated_at?: string
          updated_by?: string | null
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_sessions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      listener_devices: {
        Row: {
          app_version: string | null
          created_at: string
          created_by: string | null
          ecosystem_id: string | null
          id: string
          label: string
          last_event_at: string | null
          last_received_at: string | null
          last_seen_at: string | null
          listener_connected: boolean | null
          listener_state_at: string | null
          match_window_minutes: number
          notification_access: boolean | null
          offline_after_minutes: number
          owner_role: string
          package_name: string
          received_count: number
          receiving_number: string | null
          receiving_number_key: string | null
          revoked_at: string | null
          revoked_by: string | null
          secret_key_hash: string
          status: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          created_by?: string | null
          ecosystem_id?: string | null
          id?: string
          label: string
          last_event_at?: string | null
          last_received_at?: string | null
          last_seen_at?: string | null
          listener_connected?: boolean | null
          listener_state_at?: string | null
          match_window_minutes?: number
          notification_access?: boolean | null
          offline_after_minutes?: number
          owner_role?: string
          package_name?: string
          received_count?: number
          receiving_number?: string | null
          receiving_number_key?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          secret_key_hash: string
          status?: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          created_by?: string | null
          ecosystem_id?: string | null
          id?: string
          label?: string
          last_event_at?: string | null
          last_received_at?: string | null
          last_seen_at?: string | null
          listener_connected?: boolean | null
          listener_state_at?: string | null
          match_window_minutes?: number
          notification_access?: boolean | null
          offline_after_minutes?: number
          owner_role?: string
          package_name?: string
          received_count?: number
          receiving_number?: string | null
          receiving_number_key?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          secret_key_hash?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "listener_devices_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listener_devices_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      listener_events: {
        Row: {
          amount_php: number | null
          app_label: string | null
          category: string | null
          channel_id: string | null
          consumed_cash_in_id: string | null
          consumed_subscription_request_id: string | null
          created_at: string
          destination_note: string | null
          details: Json | null
          device_id: string
          event_uid: string
          gcash_reference: string | null
          id: string
          last_match_attempt_at: string | null
          match_attempts: number
          match_result: string | null
          outcome: string
          package_name: string | null
          parser_version: string | null
          posted_at: string | null
          provider_id: string | null
          raw_text: string | null
          recorded_by: string | null
          reference_key: string | null
          review_note: string | null
          review_state: string
          reviewed_at: string | null
          reviewed_by: string | null
          sender_name: string | null
          sender_number: string | null
          sender_number_key: string | null
          source: string
        }
        Insert: {
          amount_php?: number | null
          app_label?: string | null
          category?: string | null
          channel_id?: string | null
          consumed_cash_in_id?: string | null
          consumed_subscription_request_id?: string | null
          created_at?: string
          destination_note?: string | null
          details?: Json | null
          device_id: string
          event_uid: string
          gcash_reference?: string | null
          id?: string
          last_match_attempt_at?: string | null
          match_attempts?: number
          match_result?: string | null
          outcome?: string
          package_name?: string | null
          parser_version?: string | null
          posted_at?: string | null
          provider_id?: string | null
          raw_text?: string | null
          recorded_by?: string | null
          reference_key?: string | null
          review_note?: string | null
          review_state?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender_name?: string | null
          sender_number?: string | null
          sender_number_key?: string | null
          source?: string
        }
        Update: {
          amount_php?: number | null
          app_label?: string | null
          category?: string | null
          channel_id?: string | null
          consumed_cash_in_id?: string | null
          consumed_subscription_request_id?: string | null
          created_at?: string
          destination_note?: string | null
          details?: Json | null
          device_id?: string
          event_uid?: string
          gcash_reference?: string | null
          id?: string
          last_match_attempt_at?: string | null
          match_attempts?: number
          match_result?: string | null
          outcome?: string
          package_name?: string | null
          parser_version?: string | null
          posted_at?: string | null
          provider_id?: string | null
          raw_text?: string | null
          recorded_by?: string | null
          reference_key?: string | null
          review_note?: string | null
          review_state?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender_name?: string | null
          sender_number?: string | null
          sender_number_key?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "listener_events_consumed_cash_in_id_fkey"
            columns: ["consumed_cash_in_id"]
            isOneToOne: false
            referencedRelation: "cash_in_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listener_events_consumed_subscription_request_id_fkey"
            columns: ["consumed_subscription_request_id"]
            isOneToOne: false
            referencedRelation: "subscription_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listener_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "listener_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      listener_nonces: {
        Row: {
          device_id: string
          nonce: string
          seen_at: string
        }
        Insert: {
          device_id: string
          nonce: string
          seen_at?: string
        }
        Update: {
          device_id?: string
          nonce?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listener_nonces_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "listener_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      listener_source_rules: {
        Row: {
          created_at: string
          created_by: string | null
          device_id: string | null
          ecosystem_id: string | null
          id: string
          mode: string
          note: string | null
          package_name: string
          provider_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          ecosystem_id?: string | null
          id?: string
          mode: string
          note?: string | null
          package_name: string
          provider_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          ecosystem_id?: string | null
          id?: string
          mode?: string
          note?: string | null
          package_name?: string
          provider_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listener_source_rules_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "listener_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listener_source_rules_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listener_source_rules_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listener_source_rules_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          attempted_at: string
          id: number
          succeeded: boolean
          username: string
        }
        Insert: {
          attempted_at?: string
          id?: number
          succeeded?: boolean
          username: string
        }
        Update: {
          attempted_at?: string
          id?: number
          succeeded?: boolean
          username?: string
        }
        Relationships: []
      }
      login_usernames: {
        Row: {
          created_at: string
          created_by: string | null
          ecosystem_id: string | null
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ecosystem_id?: string | null
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ecosystem_id?: string | null
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "login_usernames_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "login_usernames_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "login_usernames_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_notifications: {
        Row: {
          body: string | null
          category: string
          created_at: string
          ecosystem_id: string | null
          event_key: string | null
          id: string
          kind: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category?: string
          created_at?: string
          ecosystem_id?: string | null
          event_key?: string | null
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string
          created_at?: string
          ecosystem_id?: string | null
          event_key?: string | null
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_notifications_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_notifications_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      member_presence: {
        Row: {
          last_seen_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_applications_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          created_at: string
          device_id: string | null
          id: string
          notification_id: string
          reason: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          id?: string
          notification_id: string
          reason?: string | null
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          id?: string
          notification_id?: string
          reason?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "push_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "member_notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          disabled_kinds: string[]
          push_enabled: boolean
          push_show_details: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          disabled_kinds?: string[]
          push_enabled?: boolean
          push_show_details?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          disabled_kinds?: string[]
          push_enabled?: boolean
          push_show_details?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      omada_connections: {
        Row: {
          access_token_ciphertext: string | null
          base_url: string
          client_id: string
          client_secret_ciphertext: string
          consecutive_failures: number
          created_at: string
          created_by: string | null
          ecosystem_id: string
          health_state: string
          hotspot_operator_secret_ciphertext: string | null
          hotspot_operator_user: string | null
          id: string
          last_checked_at: string | null
          last_error: string | null
          last_failure_at: string | null
          last_failure_reason: string | null
          last_recovered_at: string | null
          last_status: string
          last_success_at: string | null
          monitoring_enabled: boolean
          next_check_at: string
          offline_since: string | null
          omadac_id: string
          site_id: string | null
          site_name: string | null
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token_ciphertext?: string | null
          base_url: string
          client_id: string
          client_secret_ciphertext: string
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          ecosystem_id: string
          health_state?: string
          hotspot_operator_secret_ciphertext?: string | null
          hotspot_operator_user?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_recovered_at?: string | null
          last_status?: string
          last_success_at?: string | null
          monitoring_enabled?: boolean
          next_check_at?: string
          offline_since?: string | null
          omadac_id: string
          site_id?: string | null
          site_name?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token_ciphertext?: string | null
          base_url?: string
          client_id?: string
          client_secret_ciphertext?: string
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          ecosystem_id?: string
          health_state?: string
          hotspot_operator_secret_ciphertext?: string | null
          hotspot_operator_user?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_recovered_at?: string | null
          last_status?: string
          last_success_at?: string | null
          monitoring_enabled?: boolean
          next_check_at?: string
          offline_since?: string | null
          omadac_id?: string
          site_id?: string | null
          site_name?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "omada_connections_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: true
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_connections_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: true
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      omada_device_assignments: {
        Row: {
          active: boolean
          assigned_by: string | null
          assigned_user_id: string
          created_at: string
          device_id: string | null
          device_mac: string
          device_name: string | null
          device_type: string | null
          ecosystem_id: string
          id: string
          last_seen_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          assigned_by?: string | null
          assigned_user_id: string
          created_at?: string
          device_id?: string | null
          device_mac: string
          device_name?: string | null
          device_type?: string | null
          ecosystem_id: string
          id?: string
          last_seen_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          assigned_by?: string | null
          assigned_user_id?: string
          created_at?: string
          device_id?: string | null
          device_mac?: string
          device_name?: string | null
          device_type?: string | null
          ecosystem_id?: string
          id?: string
          last_seen_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "omada_device_assignments_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_device_assignments_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      omada_portal_base_templates: {
        Row: {
          analysis: Json
          archive_files: Json
          checksum: string
          created_at: string
          file_name: string
          id: string
          is_active: boolean
          is_valid: boolean
          notes: string | null
          original_bytes: number | null
          original_checksum: string | null
          original_content: string | null
          original_file_name: string | null
          source_kind: string
          template_bytes: number
          template_html: string
          updated_at: string
          uploaded_by: string | null
          version: number
          warnings: Json
        }
        Insert: {
          analysis?: Json
          archive_files?: Json
          checksum: string
          created_at?: string
          file_name: string
          id?: string
          is_active?: boolean
          is_valid?: boolean
          notes?: string | null
          original_bytes?: number | null
          original_checksum?: string | null
          original_content?: string | null
          original_file_name?: string | null
          source_kind?: string
          template_bytes: number
          template_html: string
          updated_at?: string
          uploaded_by?: string | null
          version: number
          warnings?: Json
        }
        Update: {
          analysis?: Json
          archive_files?: Json
          checksum?: string
          created_at?: string
          file_name?: string
          id?: string
          is_active?: boolean
          is_valid?: boolean
          notes?: string | null
          original_bytes?: number | null
          original_checksum?: string | null
          original_content?: string | null
          original_file_name?: string | null
          source_kind?: string
          template_bytes?: number
          template_html?: string
          updated_at?: string
          uploaded_by?: string | null
          version?: number
          warnings?: Json
        }
        Relationships: []
      }
      omada_portal_mappings: {
        Row: {
          auto_config_at: string | null
          auto_config_detail: string | null
          auto_config_snapshot: Json | null
          auto_config_status: string | null
          auto_config_url: string | null
          created_at: string
          created_by: string | null
          ecosystem_id: string
          enabled: boolean
          id: string
          last_test_at: string | null
          last_test_detail: string | null
          last_test_status: string | null
          portal_id: string
          portal_name: string | null
          settings: Json
          site_id: string
          site_name: string | null
          ssid_info: string | null
          updated_at: string
        }
        Insert: {
          auto_config_at?: string | null
          auto_config_detail?: string | null
          auto_config_snapshot?: Json | null
          auto_config_status?: string | null
          auto_config_url?: string | null
          created_at?: string
          created_by?: string | null
          ecosystem_id: string
          enabled?: boolean
          id?: string
          last_test_at?: string | null
          last_test_detail?: string | null
          last_test_status?: string | null
          portal_id: string
          portal_name?: string | null
          settings?: Json
          site_id: string
          site_name?: string | null
          ssid_info?: string | null
          updated_at?: string
        }
        Update: {
          auto_config_at?: string | null
          auto_config_detail?: string | null
          auto_config_snapshot?: Json | null
          auto_config_status?: string | null
          auto_config_url?: string | null
          created_at?: string
          created_by?: string | null
          ecosystem_id?: string
          enabled?: boolean
          id?: string
          last_test_at?: string | null
          last_test_detail?: string | null
          last_test_status?: string | null
          portal_id?: string
          portal_name?: string | null
          settings?: Json
          site_id?: string
          site_name?: string | null
          ssid_info?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "omada_portal_mappings_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_portal_mappings_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      omada_portal_templates: {
        Row: {
          analysis: Json
          base_template_id: string | null
          base_version: number | null
          created_at: string
          created_by: string | null
          downloaded_at: string | null
          ecosystem_id: string
          features: Json
          file_name: string | null
          generated_at: string | null
          generated_checksum: string | null
          generated_html: string | null
          id: string
          import_detail: string | null
          import_status: string
          import_verified_at: string | null
          mapping_id: string
          template_bytes: number | null
          template_html: string | null
          theme_slug: string
          updated_at: string
        }
        Insert: {
          analysis?: Json
          base_template_id?: string | null
          base_version?: number | null
          created_at?: string
          created_by?: string | null
          downloaded_at?: string | null
          ecosystem_id: string
          features?: Json
          file_name?: string | null
          generated_at?: string | null
          generated_checksum?: string | null
          generated_html?: string | null
          id?: string
          import_detail?: string | null
          import_status?: string
          import_verified_at?: string | null
          mapping_id: string
          template_bytes?: number | null
          template_html?: string | null
          theme_slug?: string
          updated_at?: string
        }
        Update: {
          analysis?: Json
          base_template_id?: string | null
          base_version?: number | null
          created_at?: string
          created_by?: string | null
          downloaded_at?: string | null
          ecosystem_id?: string
          features?: Json
          file_name?: string | null
          generated_at?: string | null
          generated_checksum?: string | null
          generated_html?: string | null
          id?: string
          import_detail?: string | null
          import_status?: string
          import_verified_at?: string | null
          mapping_id?: string
          template_bytes?: number | null
          template_html?: string | null
          theme_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "omada_portal_templates_base_template_id_fkey"
            columns: ["base_template_id"]
            isOneToOne: false
            referencedRelation: "omada_portal_base_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_portal_templates_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_portal_templates_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_portal_templates_mapping_id_fkey"
            columns: ["mapping_id"]
            isOneToOne: true
            referencedRelation: "omada_portal_mappings"
            referencedColumns: ["id"]
          },
        ]
      }
      omada_portal_themes: {
        Row: {
          category: string
          created_at: string
          decor: string
          description: string
          font_stack: string
          id: string
          is_active: boolean
          layout: string
          motion: string
          name: string
          slug: string
          sort_order: number
          tokens: Json
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          decor?: string
          description?: string
          font_stack?: string
          id?: string
          is_active?: boolean
          layout?: string
          motion?: string
          name: string
          slug: string
          sort_order?: number
          tokens?: Json
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          decor?: string
          description?: string
          font_stack?: string
          id?: string
          is_active?: boolean
          layout?: string
          motion?: string
          name?: string
          slug?: string
          sort_order?: number
          tokens?: Json
          updated_at?: string
        }
        Relationships: []
      }
      omada_voucher_batches: {
        Row: {
          amount: number
          calibration_id: string | null
          calibration_version: number | null
          controller_identity: Json
          created_at: string
          created_by: string | null
          ecosystem_id: string
          extracted_count: number
          group_id: string | null
          group_name: string
          id: string
          import_id: string | null
          imported_count: number
          product_id: string | null
          request: Json
          response: Json | null
          updated_at: string
        }
        Insert: {
          amount: number
          calibration_id?: string | null
          calibration_version?: number | null
          controller_identity?: Json
          created_at?: string
          created_by?: string | null
          ecosystem_id: string
          extracted_count?: number
          group_id?: string | null
          group_name: string
          id?: string
          import_id?: string | null
          imported_count?: number
          product_id?: string | null
          request?: Json
          response?: Json | null
          updated_at?: string
        }
        Update: {
          amount?: number
          calibration_id?: string | null
          calibration_version?: number | null
          controller_identity?: Json
          created_at?: string
          created_by?: string | null
          ecosystem_id?: string
          extracted_count?: number
          group_id?: string | null
          group_name?: string
          id?: string
          import_id?: string | null
          imported_count?: number
          product_id?: string | null
          request?: Json
          response?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "omada_voucher_batches_calibration_id_fkey"
            columns: ["calibration_id"]
            isOneToOne: false
            referencedRelation: "omada_voucher_calibrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_voucher_batches_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_voucher_batches_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_voucher_batches_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "voucher_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_voucher_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "voucher_products"
            referencedColumns: ["id"]
          },
        ]
      }
      omada_voucher_calibrations: {
        Row: {
          controller_identity: Json
          created_at: string
          created_by: string | null
          ecosystem_id: string
          id: string
          is_current: boolean
          payload: Json
          product_id: string
          updated_at: string
          version: number
        }
        Insert: {
          controller_identity?: Json
          created_at?: string
          created_by?: string | null
          ecosystem_id: string
          id?: string
          is_current?: boolean
          payload: Json
          product_id: string
          updated_at?: string
          version: number
        }
        Update: {
          controller_identity?: Json
          created_at?: string
          created_by?: string | null
          ecosystem_id?: string
          id?: string
          is_current?: boolean
          payload?: Json
          product_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "omada_voucher_calibrations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_voucher_calibrations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omada_voucher_calibrations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "voucher_products"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_feed_sources: {
        Row: {
          created_at: string
          id: string
          label: string
          last_error: string | null
          last_event_at: string | null
          payment_method_id: string | null
          provider: string
          secret_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          last_error?: string | null
          last_event_at?: string | null
          payment_method_id?: string | null
          provider: string
          secret_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_error?: string | null
          last_event_at?: string | null
          payment_method_id?: string | null
          provider?: string
          secret_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_feed_sources_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_match_records: {
        Row: {
          cash_in_id: string
          decision: string
          ecosystem_id: string | null
          id: string
          listener_event_id: string | null
          matched_at: string
          notification_snapshot: Json
          provider_id: string | null
          receipt_snapshot: Json
          reference_hash: string | null
          signal_count: number
          signals: Json
          strong_signal: boolean
          timing: Json
        }
        Insert: {
          cash_in_id: string
          decision: string
          ecosystem_id?: string | null
          id?: string
          listener_event_id?: string | null
          matched_at?: string
          notification_snapshot?: Json
          provider_id?: string | null
          receipt_snapshot?: Json
          reference_hash?: string | null
          signal_count?: number
          signals?: Json
          strong_signal?: boolean
          timing?: Json
        }
        Update: {
          cash_in_id?: string
          decision?: string
          ecosystem_id?: string | null
          id?: string
          listener_event_id?: string | null
          matched_at?: string
          notification_snapshot?: Json
          provider_id?: string | null
          receipt_snapshot?: Json
          reference_hash?: string | null
          signal_count?: number
          signals?: Json
          strong_signal?: boolean
          timing?: Json
        }
        Relationships: [
          {
            foreignKeyName: "payment_match_records_cash_in_id_fkey"
            columns: ["cash_in_id"]
            isOneToOne: false
            referencedRelation: "cash_in_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_match_records_listener_event_id_fkey"
            columns: ["listener_event_id"]
            isOneToOne: false
            referencedRelation: "listener_events"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          account_name: string | null
          account_number: string | null
          active: boolean
          created_at: string
          ecosystem_id: string | null
          id: string
          instructions: string
          label: string | null
          metadata: Json
          method_type: string
          name: string
          notes: string | null
          provider_id: string | null
          qr_content: string | null
          qr_path: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          active?: boolean
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          instructions?: string
          label?: string | null
          metadata?: Json
          method_type: string
          name: string
          notes?: string | null
          provider_id?: string | null
          qr_content?: string | null
          qr_path?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          active?: boolean
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          instructions?: string
          label?: string | null
          metadata?: Json
          method_type?: string
          name?: string
          notes?: string | null
          provider_id?: string | null
          qr_content?: string | null
          qr_path?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_methods_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_methods_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_provider_registry: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          packages: string[]
          text_markers: string[]
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id: string
          name: string
          packages?: string[]
          text_markers?: string[]
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          packages?: string[]
          text_markers?: string[]
        }
        Relationships: []
      }
      payment_reference_salt: {
        Row: {
          id: boolean
          salt: string
        }
        Insert: {
          id?: boolean
          salt?: string
        }
        Update: {
          id?: boolean
          salt?: string
        }
        Relationships: []
      }
      payment_reference_seen: {
        Row: {
          cash_in_id: string | null
          ecosystem_id: string | null
          first_seen_at: string
          provider_id: string | null
          reference_hash: string
        }
        Insert: {
          cash_in_id?: string | null
          ecosystem_id?: string | null
          first_seen_at?: string
          provider_id?: string | null
          reference_hash: string
        }
        Update: {
          cash_in_id?: string | null
          ecosystem_id?: string | null
          first_seen_at?: string
          provider_id?: string | null
          reference_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reference_seen_cash_in_id_fkey"
            columns: ["cash_in_id"]
            isOneToOne: false
            referencedRelation: "cash_in_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reference_seen_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reference_seen_ecosystem_id_fkey"
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
      platform_credit_issuances: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          category: string | null
          created_at: string
          ecosystem_id: string | null
          ecosystem_name: string | null
          id: string
          ledger_id: string | null
          operator_id: string
          operator_name: string
          reason: string
          recipient_id: string
          recipient_name: string
          recipient_role: Database["public"]["Enums"]["app_role"] | null
          reference: string | null
          request_key: string
          tx_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before: number
          category?: string | null
          created_at?: string
          ecosystem_id?: string | null
          ecosystem_name?: string | null
          id?: string
          ledger_id?: string | null
          operator_id: string
          operator_name: string
          reason: string
          recipient_id: string
          recipient_name: string
          recipient_role?: Database["public"]["Enums"]["app_role"] | null
          reference?: string | null
          request_key: string
          tx_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          category?: string | null
          created_at?: string
          ecosystem_id?: string | null
          ecosystem_name?: string | null
          id?: string
          ledger_id?: string | null
          operator_id?: string
          operator_name?: string
          reason?: string
          recipient_id?: string
          recipient_name?: string
          recipient_role?: Database["public"]["Enums"]["app_role"] | null
          reference?: string | null
          request_key?: string
          tx_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_credit_issuances_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_credit_issuances_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_credit_issuances_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_deletion_log: {
        Row: {
          actor_id: string | null
          actor_name: string
          counts: Json
          created_at: string
          deletion_kind: string
          ecosystem_id: string
          ecosystem_name: string
          ecosystem_slug: string
          id: string
          outstanding_snapshot: Json | null
          reason: string
        }
        Insert: {
          actor_id?: string | null
          actor_name: string
          counts?: Json
          created_at?: string
          deletion_kind?: string
          ecosystem_id: string
          ecosystem_name: string
          ecosystem_slug: string
          id?: string
          outstanding_snapshot?: Json | null
          reason: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          counts?: Json
          created_at?: string
          deletion_kind?: string
          ecosystem_id?: string
          ecosystem_name?: string
          ecosystem_slug?: string
          id?: string
          outstanding_snapshot?: Json | null
          reason?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          admin_credit_discount_percent: number
          admin_voucher_discount_percent: number
          billing_period: string
          cash_in_fee_percent: number
          cash_out_credits_per_unit: number
          cash_out_php_per_unit: number
          cashback_reseller_percent: number
          cashback_subreseller_percent: number
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
          member_invitation_expiry_days: number
          payment_instructions: string
          plan_name: string
          plan_price: number
          retail_platform_fee_percent: number
          shop_transfer_fee_credits: number
          support_message: string
          support_page_name: string
          support_page_url: string
          updated_at: string
          updated_by: string | null
          voucher_platform_fee_percent: number
          withdrawal_fee_percent: number
        }
        Insert: {
          admin_credit_discount_percent?: number
          admin_voucher_discount_percent?: number
          billing_period?: string
          cash_in_fee_percent?: number
          cash_out_credits_per_unit?: number
          cash_out_php_per_unit?: number
          cashback_reseller_percent?: number
          cashback_subreseller_percent?: number
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
          member_invitation_expiry_days?: number
          payment_instructions?: string
          plan_name?: string
          plan_price?: number
          retail_platform_fee_percent?: number
          shop_transfer_fee_credits?: number
          support_message?: string
          support_page_name?: string
          support_page_url?: string
          updated_at?: string
          updated_by?: string | null
          voucher_platform_fee_percent?: number
          withdrawal_fee_percent?: number
        }
        Update: {
          admin_credit_discount_percent?: number
          admin_voucher_discount_percent?: number
          billing_period?: string
          cash_in_fee_percent?: number
          cash_out_credits_per_unit?: number
          cash_out_php_per_unit?: number
          cashback_reseller_percent?: number
          cashback_subreseller_percent?: number
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
          member_invitation_expiry_days?: number
          payment_instructions?: string
          plan_name?: string
          plan_price?: number
          retail_platform_fee_percent?: number
          shop_transfer_fee_credits?: number
          support_message?: string
          support_page_name?: string
          support_page_url?: string
          updated_at?: string
          updated_by?: string | null
          voucher_platform_fee_percent?: number
          withdrawal_fee_percent?: number
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "discoverable_shops"
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
      portal_authorizations: {
        Row: {
          authorized_at: string | null
          created_at: string
          duration_minutes: number | null
          ecosystem_id: string
          error: string | null
          id: string
          member_id: string | null
          sale_id: string | null
          session_id: string
          status: string
          updated_at: string
          voucher_code: string | null
        }
        Insert: {
          authorized_at?: string | null
          created_at?: string
          duration_minutes?: number | null
          ecosystem_id: string
          error?: string | null
          id?: string
          member_id?: string | null
          sale_id?: string | null
          session_id: string
          status?: string
          updated_at?: string
          voucher_code?: string | null
        }
        Update: {
          authorized_at?: string | null
          created_at?: string
          duration_minutes?: number | null
          ecosystem_id?: string
          error?: string | null
          id?: string
          member_id?: string | null
          sale_id?: string | null
          session_id?: string
          status?: string
          updated_at?: string
          voucher_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_authorizations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_authorizations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_authorizations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "portal_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_handoffs: {
        Row: {
          created_at: string
          ecosystem_id: string
          expires_at: string
          id: string
          mapping_id: string
          portal_id: string | null
          session_id: string | null
          site_id: string | null
          uses: number
        }
        Insert: {
          created_at?: string
          ecosystem_id: string
          expires_at?: string
          id?: string
          mapping_id: string
          portal_id?: string | null
          session_id?: string | null
          site_id?: string | null
          uses?: number
        }
        Update: {
          created_at?: string
          ecosystem_id?: string
          expires_at?: string
          id?: string
          mapping_id?: string
          portal_id?: string | null
          session_id?: string | null
          site_id?: string | null
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "portal_handoffs_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_handoffs_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_handoffs_mapping_id_fkey"
            columns: ["mapping_id"]
            isOneToOne: false
            referencedRelation: "omada_portal_mappings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_handoffs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "portal_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_redemptions: {
        Row: {
          authorization_id: string | null
          claimed_at: string | null
          created_at: string
          ecosystem_id: string
          error: string | null
          expires_at: string
          id: string
          sale_id: string | null
          session_id: string
          status: string
          token: string
          updated_at: string
          voucher_code: string
        }
        Insert: {
          authorization_id?: string | null
          claimed_at?: string | null
          created_at?: string
          ecosystem_id: string
          error?: string | null
          expires_at: string
          id?: string
          sale_id?: string | null
          session_id: string
          status?: string
          token: string
          updated_at?: string
          voucher_code: string
        }
        Update: {
          authorization_id?: string | null
          claimed_at?: string | null
          created_at?: string
          ecosystem_id?: string
          error?: string | null
          expires_at?: string
          id?: string
          sale_id?: string | null
          session_id?: string
          status?: string
          token?: string
          updated_at?: string
          voucher_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_redemptions_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "portal_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_redemptions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_redemptions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_redemptions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "portal_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_sessions: {
        Row: {
          ap_mac: string | null
          client_ip: string | null
          client_mac: string | null
          created_at: string
          ecosystem_id: string
          expires_at: string
          id: string
          mapping_id: string
          member_id: string | null
          page_url: string | null
          radio_id: string | null
          raw_query: Json | null
          redirect_url: string | null
          site_ref: string | null
          ssid: string | null
          updated_at: string
        }
        Insert: {
          ap_mac?: string | null
          client_ip?: string | null
          client_mac?: string | null
          created_at?: string
          ecosystem_id: string
          expires_at?: string
          id?: string
          mapping_id: string
          member_id?: string | null
          page_url?: string | null
          radio_id?: string | null
          raw_query?: Json | null
          redirect_url?: string | null
          site_ref?: string | null
          ssid?: string | null
          updated_at?: string
        }
        Update: {
          ap_mac?: string | null
          client_ip?: string | null
          client_mac?: string | null
          created_at?: string
          ecosystem_id?: string
          expires_at?: string
          id?: string
          mapping_id?: string
          member_id?: string | null
          page_url?: string | null
          radio_id?: string | null
          raw_query?: Json | null
          redirect_url?: string | null
          site_ref?: string | null
          ssid?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_sessions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_sessions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_sessions_mapping_id_fkey"
            columns: ["mapping_id"]
            isOneToOne: false
            referencedRelation: "omada_portal_mappings"
            referencedColumns: ["id"]
          },
        ]
      }
      product_ratings: {
        Row: {
          comment: string | null
          created_at: string
          ecosystem_id: string
          id: string
          product_id: string
          rating: number
          sale_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          ecosystem_id: string
          id?: string
          product_id: string
          rating: number
          sale_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          ecosystem_id?: string
          id?: string
          product_id?: string
          rating?: number
          sale_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_ratings_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_ratings_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_ratings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "voucher_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_ratings_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "voucher_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_ecosystem_id: string | null
          avatar_path: string | null
          barangay: string | null
          bio: string | null
          city_municipality: string | null
          cover_path: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          ecosystem_id: string | null
          email: string
          full_name: string
          handle: string | null
          house_number: string | null
          id: string
          is_demo: boolean
          joined_at: string
          phone: string
          preferences: Json
          province: string | null
          reseller_commission_percent: number | null
          reseller_discount_percent: number
          reseller_id: string | null
          sale_commission_percent: number | null
          status: Database["public"]["Enums"]["account_status"]
          street: string | null
          updated_at: string
        }
        Insert: {
          active_ecosystem_id?: string | null
          avatar_path?: string | null
          barangay?: string | null
          bio?: string | null
          city_municipality?: string | null
          cover_path?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          ecosystem_id?: string | null
          email?: string
          full_name?: string
          handle?: string | null
          house_number?: string | null
          id: string
          is_demo?: boolean
          joined_at?: string
          phone?: string
          preferences?: Json
          province?: string | null
          reseller_commission_percent?: number | null
          reseller_discount_percent?: number
          reseller_id?: string | null
          sale_commission_percent?: number | null
          status?: Database["public"]["Enums"]["account_status"]
          street?: string | null
          updated_at?: string
        }
        Update: {
          active_ecosystem_id?: string | null
          avatar_path?: string | null
          barangay?: string | null
          bio?: string | null
          city_municipality?: string | null
          cover_path?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          ecosystem_id?: string | null
          email?: string
          full_name?: string
          handle?: string | null
          house_number?: string | null
          id?: string
          is_demo?: boolean
          joined_at?: string
          phone?: string
          preferences?: Json
          province?: string | null
          reseller_commission_percent?: number | null
          reseller_discount_percent?: number
          reseller_id?: string | null
          sale_commission_percent?: number | null
          status?: Database["public"]["Enums"]["account_status"]
          street?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_ecosystem_id_fkey"
            columns: ["active_ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_active_ecosystem_id_fkey"
            columns: ["active_ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
      push_devices: {
        Row: {
          auth_secret: string | null
          created_at: string
          device_label: string | null
          endpoint: string
          expired_at: string | null
          failure_count: number
          id: string
          last_error: string | null
          last_seen_at: string
          p256dh: string | null
          push_enabled: boolean
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_secret?: string | null
          created_at?: string
          device_label?: string | null
          endpoint: string
          expired_at?: string | null
          failure_count?: number
          id?: string
          last_error?: string | null
          last_seen_at?: string
          p256dh?: string | null
          push_enabled?: boolean
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_secret?: string | null
          created_at?: string
          device_label?: string | null
          endpoint?: string
          expired_at?: string | null
          failure_count?: number
          id?: string
          last_error?: string | null
          last_seen_at?: string
          p256dh?: string | null
          push_enabled?: boolean
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      push_dispatch_config: {
        Row: {
          endpoint_url: string | null
          id: number
          last_wake_at: string | null
          secret: string | null
          updated_at: string
        }
        Insert: {
          endpoint_url?: string | null
          id: number
          last_wake_at?: string | null
          secret?: string | null
          updated_at?: string
        }
        Update: {
          endpoint_url?: string | null
          id?: number
          last_wake_at?: string | null
          secret?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      retail_catalog_templates: {
        Row: {
          active: boolean
          brand: string | null
          category: string
          created_at: string
          default_price: number
          default_wholesale_price: number
          description: string | null
          id: string
          image_path: string | null
          name: string
          size_label: string | null
          sku: string | null
          sort_order: number
          unit: string
          updated_at: string
          variant: string | null
          wholesale_min_qty: number
        }
        Insert: {
          active?: boolean
          brand?: string | null
          category: string
          created_at?: string
          default_price?: number
          default_wholesale_price?: number
          description?: string | null
          id?: string
          image_path?: string | null
          name: string
          size_label?: string | null
          sku?: string | null
          sort_order?: number
          unit?: string
          updated_at?: string
          variant?: string | null
          wholesale_min_qty?: number
        }
        Update: {
          active?: boolean
          brand?: string | null
          category?: string
          created_at?: string
          default_price?: number
          default_wholesale_price?: number
          description?: string | null
          id?: string
          image_path?: string | null
          name?: string
          size_label?: string | null
          sku?: string | null
          sort_order?: number
          unit?: string
          updated_at?: string
          variant?: string | null
          wholesale_min_qty?: number
        }
        Relationships: []
      }
      retail_order_items: {
        Row: {
          cashback_amount: number
          cashback_mode: string
          cashback_value: number
          created_at: string
          fee_amount: number | null
          id: string
          line_total: number
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          regular_unit_price: number | null
          seller_line_total: number | null
          unit_price: number
          wholesale_applied: boolean
        }
        Insert: {
          cashback_amount?: number
          cashback_mode?: string
          cashback_value?: number
          created_at?: string
          fee_amount?: number | null
          id?: string
          line_total: number
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          regular_unit_price?: number | null
          seller_line_total?: number | null
          unit_price: number
          wholesale_applied?: boolean
        }
        Update: {
          cashback_amount?: number
          cashback_mode?: string
          cashback_value?: number
          created_at?: string
          fee_amount?: number | null
          id?: string
          line_total?: number
          order_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          regular_unit_price?: number | null
          seller_line_total?: number | null
          unit_price?: number
          wholesale_applied?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "retail_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "retail_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "retail_products"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_orders: {
        Row: {
          buyer_charge: number | null
          cashback_ledger_id: string | null
          cashback_recipient_id: string | null
          cashback_total: number
          chat_thread_id: string | null
          client_ref: string | null
          cod_actual_cash: number | null
          cod_cash_received_at: string | null
          cod_discrepancy: boolean
          cod_expected_cash: number | null
          cod_hold_ledger_id: string | null
          cod_hold_tx: string | null
          cod_settled_at: string | null
          cod_settlement_kind: string | null
          collector_id: string | null
          collector_responded_at: string | null
          collector_share_ledger_id: string | null
          collector_status: string
          completed_at: string | null
          created_at: string
          credit_hold_tx: string | null
          credit_released: boolean
          customer_id: string
          customer_name: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          delivered_at: string | null
          delivery_address: string | null
          delivery_fee: number
          delivery_notes: string | null
          delivery_person_id: string | null
          delivery_share_ledger_id: string | null
          delivery_split_collector_pct: number | null
          delivery_split_delivery_pct: number | null
          ecosystem_id: string
          fulfillment: string
          fulfillment_status: string
          fulfillment_updated_at: string | null
          hold_ledger_id: string | null
          id: string
          notified_at: string | null
          order_no: string
          payment_method: string
          platform_fee_amount: number | null
          platform_fee_percent: number | null
          refund_ledger_id: string | null
          self_cashback: number
          self_delivery: boolean
          seller_id: string | null
          seller_total: number | null
          settled_to: string | null
          settlement_ledger_id: string | null
          status: string
          total: number
          updated_at: string
          wallet_account_id: string | null
        }
        Insert: {
          buyer_charge?: number | null
          cashback_ledger_id?: string | null
          cashback_recipient_id?: string | null
          cashback_total?: number
          chat_thread_id?: string | null
          client_ref?: string | null
          cod_actual_cash?: number | null
          cod_cash_received_at?: string | null
          cod_discrepancy?: boolean
          cod_expected_cash?: number | null
          cod_hold_ledger_id?: string | null
          cod_hold_tx?: string | null
          cod_settled_at?: string | null
          cod_settlement_kind?: string | null
          collector_id?: string | null
          collector_responded_at?: string | null
          collector_share_ledger_id?: string | null
          collector_status?: string
          completed_at?: string | null
          created_at?: string
          credit_hold_tx?: string | null
          credit_released?: boolean
          customer_id: string
          customer_name: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          delivery_notes?: string | null
          delivery_person_id?: string | null
          delivery_share_ledger_id?: string | null
          delivery_split_collector_pct?: number | null
          delivery_split_delivery_pct?: number | null
          ecosystem_id: string
          fulfillment: string
          fulfillment_status?: string
          fulfillment_updated_at?: string | null
          hold_ledger_id?: string | null
          id?: string
          notified_at?: string | null
          order_no: string
          payment_method: string
          platform_fee_amount?: number | null
          platform_fee_percent?: number | null
          refund_ledger_id?: string | null
          self_cashback?: number
          self_delivery?: boolean
          seller_id?: string | null
          seller_total?: number | null
          settled_to?: string | null
          settlement_ledger_id?: string | null
          status?: string
          total: number
          updated_at?: string
          wallet_account_id?: string | null
        }
        Update: {
          buyer_charge?: number | null
          cashback_ledger_id?: string | null
          cashback_recipient_id?: string | null
          cashback_total?: number
          chat_thread_id?: string | null
          client_ref?: string | null
          cod_actual_cash?: number | null
          cod_cash_received_at?: string | null
          cod_discrepancy?: boolean
          cod_expected_cash?: number | null
          cod_hold_ledger_id?: string | null
          cod_hold_tx?: string | null
          cod_settled_at?: string | null
          cod_settlement_kind?: string | null
          collector_id?: string | null
          collector_responded_at?: string | null
          collector_share_ledger_id?: string | null
          collector_status?: string
          completed_at?: string | null
          created_at?: string
          credit_hold_tx?: string | null
          credit_released?: boolean
          customer_id?: string
          customer_name?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          delivery_notes?: string | null
          delivery_person_id?: string | null
          delivery_share_ledger_id?: string | null
          delivery_split_collector_pct?: number | null
          delivery_split_delivery_pct?: number | null
          ecosystem_id?: string
          fulfillment?: string
          fulfillment_status?: string
          fulfillment_updated_at?: string | null
          hold_ledger_id?: string | null
          id?: string
          notified_at?: string | null
          order_no?: string
          payment_method?: string
          platform_fee_amount?: number | null
          platform_fee_percent?: number | null
          refund_ledger_id?: string | null
          self_cashback?: number
          self_delivery?: boolean
          seller_id?: string | null
          seller_total?: number | null
          settled_to?: string | null
          settlement_ledger_id?: string | null
          status?: string
          total?: number
          updated_at?: string
          wallet_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retail_orders_cashback_ledger_id_fkey"
            columns: ["cashback_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_orders_cod_hold_ledger_id_fkey"
            columns: ["cod_hold_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_orders_collector_share_ledger_id_fkey"
            columns: ["collector_share_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_orders_delivery_share_ledger_id_fkey"
            columns: ["delivery_share_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_orders_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_orders_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_orders_hold_ledger_id_fkey"
            columns: ["hold_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_orders_refund_ledger_id_fkey"
            columns: ["refund_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_orders_settlement_ledger_id_fkey"
            columns: ["settlement_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_orders_wallet_account_id_fkey"
            columns: ["wallet_account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_platform_fees: {
        Row: {
          created_at: string
          ecosystem_id: string
          fee_credits: number
          fee_percent: number
          id: string
          order_id: string
          seller_credits: number
          tx_id: string
        }
        Insert: {
          created_at?: string
          ecosystem_id: string
          fee_credits: number
          fee_percent: number
          id?: string
          order_id: string
          seller_credits: number
          tx_id: string
        }
        Update: {
          created_at?: string
          ecosystem_id?: string
          fee_credits?: number
          fee_percent?: number
          id?: string
          order_id?: string
          seller_credits?: number
          tx_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retail_platform_fees_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_platform_fees_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_platform_fees_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "retail_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_product_ratings: {
        Row: {
          comment: string | null
          created_at: string
          ecosystem_id: string
          id: string
          order_id: string
          product_id: string
          rating: number
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          ecosystem_id: string
          id?: string
          order_id: string
          product_id: string
          rating: number
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          ecosystem_id?: string
          id?: string
          order_id?: string
          product_id?: string
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retail_product_ratings_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_product_ratings_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_product_ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "retail_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_product_ratings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "retail_products"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_products: {
        Row: {
          active: boolean
          archived: boolean
          barcode: string | null
          brand: string | null
          cashback_mode: string
          cashback_value: number
          category: string | null
          created_at: string
          description: string | null
          ecosystem_id: string
          id: string
          image_path: string | null
          name: string
          price: number
          public_visible: boolean
          published: boolean
          size_label: string | null
          sku: string | null
          sold_count: number
          stock: number
          template_id: string | null
          unit: string
          updated_at: string
          variant: string | null
          wholesale_min_qty: number
          wholesale_price: number
        }
        Insert: {
          active?: boolean
          archived?: boolean
          barcode?: string | null
          brand?: string | null
          cashback_mode?: string
          cashback_value?: number
          category?: string | null
          created_at?: string
          description?: string | null
          ecosystem_id: string
          id?: string
          image_path?: string | null
          name: string
          price: number
          public_visible?: boolean
          published?: boolean
          size_label?: string | null
          sku?: string | null
          sold_count?: number
          stock?: number
          template_id?: string | null
          unit?: string
          updated_at?: string
          variant?: string | null
          wholesale_min_qty?: number
          wholesale_price?: number
        }
        Update: {
          active?: boolean
          archived?: boolean
          barcode?: string | null
          brand?: string | null
          cashback_mode?: string
          cashback_value?: number
          category?: string | null
          created_at?: string
          description?: string | null
          ecosystem_id?: string
          id?: string
          image_path?: string | null
          name?: string
          price?: number
          public_visible?: boolean
          published?: boolean
          size_label?: string | null
          sku?: string | null
          sold_count?: number
          stock?: number
          template_id?: string | null
          unit?: string
          updated_at?: string
          variant?: string | null
          wholesale_min_qty?: number
          wholesale_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "retail_products_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_products_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retail_products_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "retail_catalog_templates"
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_products_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_ratings: {
        Row: {
          comment: string | null
          created_at: string
          ecosystem_id: string
          id: string
          rating: number
          redemption_id: string
          reward_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          ecosystem_id: string
          id?: string
          rating: number
          redemption_id: string
          reward_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          ecosystem_id?: string
          id?: string
          rating?: number
          redemption_id?: string
          reward_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_ratings_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_ratings_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_ratings_redemption_id_fkey"
            columns: ["redemption_id"]
            isOneToOne: true
            referencedRelation: "reward_redemptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_ratings_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "reward_products"
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
      shop_seller_authorizations: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          ecosystem_id: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          ecosystem_id: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          ecosystem_id?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_seller_authorizations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_seller_authorizations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_seller_authorizations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_subscriptions: {
        Row: {
          allocation_total: number
          created_at: string
          demo_seed_credits: number
          ecosystem_id: string
          period_end: string | null
          period_start: string | null
          plan_id: string | null
          review_ends_at: string | null
          state: string
          updated_at: string
        }
        Insert: {
          allocation_total?: number
          created_at?: string
          demo_seed_credits?: number
          ecosystem_id: string
          period_end?: string | null
          period_start?: string | null
          plan_id?: string | null
          review_ends_at?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          allocation_total?: number
          created_at?: string
          demo_seed_credits?: number
          ecosystem_id?: string
          period_end?: string | null
          period_start?: string | null
          plan_id?: string | null
          review_ends_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_subscriptions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: true
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_subscriptions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: true
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_transfer_fees: {
        Row: {
          created_at: string
          fee_credits: number
          from_ecosystem_id: string | null
          gross_credits: number
          id: string
          net_credits: number
          to_ecosystem_id: string | null
          tx_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fee_credits: number
          from_ecosystem_id?: string | null
          gross_credits: number
          id?: string
          net_credits: number
          to_ecosystem_id?: string | null
          tx_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          fee_credits?: number
          from_ecosystem_id?: string | null
          gross_credits?: number
          id?: string
          net_credits?: number
          to_ecosystem_id?: string | null
          tx_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_transfer_fees_from_ecosystem_id_fkey"
            columns: ["from_ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_transfer_fees_from_ecosystem_id_fkey"
            columns: ["from_ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_transfer_fees_to_ecosystem_id_fkey"
            columns: ["to_ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_transfer_fees_to_ecosystem_id_fkey"
            columns: ["to_ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
          ecosystem_id: string | null
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          ecosystem_id?: string | null
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          ecosystem_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_blocks_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
          depth: number
          ecosystem_id: string | null
          id: string
          parent_id: string | null
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
          depth?: number
          ecosystem_id?: string | null
          id?: string
          parent_id?: string | null
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
          depth?: number
          ecosystem_id?: string | null
          id?: string
          parent_id?: string | null
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_comments_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "social_comments"
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
          ecosystem_id: string | null
          free_balance: number
          id: string
          last_allowance_on: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          ecosystem_id?: string | null
          free_balance?: number
          id?: string
          last_allowance_on?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          ecosystem_id?: string | null
          free_balance?: number
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "discoverable_shops"
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
      social_follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
          id: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
          id?: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_friendships: {
        Row: {
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          responded_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: string
          requester_id: string
          responded_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: string
          requester_id?: string
          responded_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_friendships_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_friendships_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_likes: {
        Row: {
          created_at: string
          ecosystem_id: string | null
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ecosystem_id?: string | null
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          ecosystem_id?: string | null
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_likes_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
          origin_ecosystem_id: string | null
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
          origin_ecosystem_id?: string | null
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
          origin_ecosystem_id?: string | null
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "discoverable_shops"
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
      social_post_shop_hides: {
        Row: {
          created_at: string
          ecosystem_id: string
          hidden_by: string
          hidden_by_name: string
          id: string
          post_id: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          ecosystem_id: string
          hidden_by: string
          hidden_by_name?: string
          id?: string
          post_id: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          ecosystem_id?: string
          hidden_by?: string
          hidden_by_name?: string
          id?: string
          post_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_post_shop_hides_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_shop_hides_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_shop_hides_post_id_fkey"
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
          ecosystem_id: string | null
          hashtags: string[]
          id: string
          image_path: string | null
          like_count: number
          meta: Json
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
          used_free_post: boolean
          video_path: string | null
        }
        Insert: {
          audience?: string
          author_id: string
          body: string
          comment_count?: number
          created_at?: string
          ecosystem_id?: string | null
          hashtags?: string[]
          id?: string
          image_path?: string | null
          like_count?: number
          meta?: Json
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
          used_free_post?: boolean
          video_path?: string | null
        }
        Update: {
          audience?: string
          author_id?: string
          body?: string
          comment_count?: number
          created_at?: string
          ecosystem_id?: string | null
          hashtags?: string[]
          id?: string
          image_path?: string | null
          like_count?: number
          meta?: Json
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
          used_free_post?: boolean
          video_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
          ecosystem_id: string | null
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
          ecosystem_id?: string | null
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
          ecosystem_id?: string | null
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
          free_posts_per_day: number
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
          free_posts_per_day?: number
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
          free_posts_per_day?: number
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
      spending_categories: {
        Row: {
          auto_key: string | null
          created_at: string
          ecosystem_id: string
          id: string
          kind: string
          member_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          auto_key?: string | null
          created_at?: string
          ecosystem_id: string
          id?: string
          kind: string
          member_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          auto_key?: string | null
          created_at?: string
          ecosystem_id?: string
          id?: string
          kind?: string
          member_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spending_categories_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spending_categories_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spending_categories_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      spending_income_entries: {
        Row: {
          amount: number
          category_id: string | null
          client_ref: string | null
          created_at: string
          created_by: string
          created_by_name: string | null
          description: string
          ecosystem_id: string
          id: string
          notes: string | null
          occurred_at: string
          updated_at: string
        }
        Insert: {
          amount: number
          category_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by: string
          created_by_name?: string | null
          description: string
          ecosystem_id: string
          id?: string
          notes?: string | null
          occurred_at?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by?: string
          created_by_name?: string | null
          description?: string
          ecosystem_id?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spending_income_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "spending_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spending_income_entries_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spending_income_entries_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_adjustments_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          additional_allocation: number
          allocation_granted: number
          amount_php: number | null
          created_at: string
          ecosystem_id: string
          event_type: string
          id: string
          new_plan_id: string | null
          notes: string | null
          payment_reference: string | null
          period_end: string | null
          period_start: string | null
          previous_plan_id: string | null
          proration_daily_value: number | null
          proration_days_remaining: number | null
          proration_unused_value: number | null
          tx_id: string | null
          verification_status: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          additional_allocation?: number
          allocation_granted?: number
          amount_php?: number | null
          created_at?: string
          ecosystem_id: string
          event_type: string
          id?: string
          new_plan_id?: string | null
          notes?: string | null
          payment_reference?: string | null
          period_end?: string | null
          period_start?: string | null
          previous_plan_id?: string | null
          proration_daily_value?: number | null
          proration_days_remaining?: number | null
          proration_unused_value?: number | null
          tx_id?: string | null
          verification_status?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          additional_allocation?: number
          allocation_granted?: number
          amount_php?: number | null
          created_at?: string
          ecosystem_id?: string
          event_type?: string
          id?: string
          new_plan_id?: string | null
          notes?: string | null
          payment_reference?: string | null
          period_end?: string | null
          period_start?: string | null
          previous_plan_id?: string | null
          proration_daily_value?: number | null
          proration_days_remaining?: number | null
          proration_unused_value?: number | null
          tx_id?: string | null
          verification_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_new_plan_id_fkey"
            columns: ["new_plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_previous_plan_id_fkey"
            columns: ["previous_plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          active: boolean
          billing_period: string
          code: string
          coin_allocation: number
          created_at: string
          description: string
          display_order: number
          id: string
          monthly_price: number
          name: string
          price_configurable: boolean
          recommended: boolean
          tagline: string | null
          updated_at: string
          upgrade_hint: string | null
          who_for: string | null
          wifi_use_case: string | null
        }
        Insert: {
          active?: boolean
          billing_period?: string
          code: string
          coin_allocation?: number
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          monthly_price?: number
          name: string
          price_configurable?: boolean
          recommended?: boolean
          tagline?: string | null
          updated_at?: string
          upgrade_hint?: string | null
          who_for?: string | null
          wifi_use_case?: string | null
        }
        Update: {
          active?: boolean
          billing_period?: string
          code?: string
          coin_allocation?: number
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          monthly_price?: number
          name?: string
          price_configurable?: boolean
          recommended?: boolean
          tagline?: string | null
          updated_at?: string
          upgrade_hint?: string | null
          who_for?: string | null
          wifi_use_case?: string | null
        }
        Relationships: []
      }
      subscription_requests: {
        Row: {
          amount_due: number
          amount_paid: number | null
          auto_reason: string | null
          auto_state: string
          billing_period: string
          created_at: string
          currency: string
          decision_reason: string | null
          ecosystem_id: string
          entitlement_hold: boolean
          id: string
          listener_event_id: string | null
          monthly_rate: number | null
          months_purchased: number | null
          payer_number: string | null
          payer_number_key: string | null
          payer_reference_key: string | null
          payment_method_id: string | null
          payment_method_name: string | null
          payment_override: boolean
          payment_override_at: string | null
          payment_override_by: string | null
          payment_override_reason: string | null
          payment_reference: string
          period_end: string | null
          period_start: string | null
          plan_id: string | null
          plan_name: string
          plan_price: number
          previous_period_end: string | null
          proof_path: string | null
          purpose: string
          receipt_amount_php: number | null
          receipt_check: string
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_key: string | null
          receipt_reference_key: string | null
          receipt_sender_key: string | null
          remainder_amount: number
          requested_by: string | null
          requested_by_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          super_review_reason: string | null
          super_review_state: string
          super_reviewed_at: string | null
          super_reviewed_by: string | null
          super_reviewed_by_name: string | null
          updated_at: string
        }
        Insert: {
          amount_due: number
          amount_paid?: number | null
          auto_reason?: string | null
          auto_state?: string
          billing_period: string
          created_at?: string
          currency?: string
          decision_reason?: string | null
          ecosystem_id: string
          entitlement_hold?: boolean
          id?: string
          listener_event_id?: string | null
          monthly_rate?: number | null
          months_purchased?: number | null
          payer_number?: string | null
          payer_number_key?: string | null
          payer_reference_key?: string | null
          payment_method_id?: string | null
          payment_method_name?: string | null
          payment_override?: boolean
          payment_override_at?: string | null
          payment_override_by?: string | null
          payment_override_reason?: string | null
          payment_reference: string
          period_end?: string | null
          period_start?: string | null
          plan_id?: string | null
          plan_name: string
          plan_price: number
          previous_period_end?: string | null
          proof_path?: string | null
          purpose?: string
          receipt_amount_php?: number | null
          receipt_check?: string
          receipt_details?: Json | null
          receipt_paid_at?: string | null
          receipt_receiving_key?: string | null
          receipt_reference_key?: string | null
          receipt_sender_key?: string | null
          remainder_amount?: number
          requested_by?: string | null
          requested_by_name?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          super_review_reason?: string | null
          super_review_state?: string
          super_reviewed_at?: string | null
          super_reviewed_by?: string | null
          super_reviewed_by_name?: string | null
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number | null
          auto_reason?: string | null
          auto_state?: string
          billing_period?: string
          created_at?: string
          currency?: string
          decision_reason?: string | null
          ecosystem_id?: string
          entitlement_hold?: boolean
          id?: string
          listener_event_id?: string | null
          monthly_rate?: number | null
          months_purchased?: number | null
          payer_number?: string | null
          payer_number_key?: string | null
          payer_reference_key?: string | null
          payment_method_id?: string | null
          payment_method_name?: string | null
          payment_override?: boolean
          payment_override_at?: string | null
          payment_override_by?: string | null
          payment_override_reason?: string | null
          payment_reference?: string
          period_end?: string | null
          period_start?: string | null
          plan_id?: string | null
          plan_name?: string
          plan_price?: number
          previous_period_end?: string | null
          proof_path?: string | null
          purpose?: string
          receipt_amount_php?: number | null
          receipt_check?: string
          receipt_details?: Json | null
          receipt_paid_at?: string | null
          receipt_receiving_key?: string | null
          receipt_reference_key?: string | null
          receipt_sender_key?: string | null
          remainder_amount?: number
          requested_by?: string | null
          requested_by_name?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          super_review_reason?: string | null
          super_review_state?: string
          super_reviewed_at?: string | null
          super_reviewed_by?: string | null
          super_reviewed_by_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_requests_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_requests_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_requests_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_requests_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_data_resets_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      ui_layout_audit: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          created_at: string
          ecosystem_id: string | null
          id: string
          next_payload: Json | null
          previous_payload: Json | null
          role: Database["public"]["Enums"]["app_role"]
          target_id: string | null
          target_kind: string
          target_label: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          next_payload?: Json | null
          previous_payload?: Json | null
          role: Database["public"]["Enums"]["app_role"]
          target_id?: string | null
          target_kind?: string
          target_label?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          next_payload?: Json | null
          previous_payload?: Json | null
          role?: Database["public"]["Enums"]["app_role"]
          target_id?: string | null
          target_kind?: string
          target_label?: string | null
        }
        Relationships: []
      }
      ui_layout_configs: {
        Row: {
          created_at: string
          ecosystem_id: string | null
          id: string
          payload: Json
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          payload?: Json
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          ecosystem_id?: string | null
          id?: string
          payload?: Json
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ui_layout_configs_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ui_layout_configs_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      universe_product_views: {
        Row: {
          ecosystem_id: string
          id: string
          product_id: string
          product_kind: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          ecosystem_id: string
          id?: string
          product_id: string
          product_kind: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          ecosystem_id?: string
          id?: string
          product_id?: string
          product_kind?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "universe_product_views_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_product_views_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      universe_wallet_consolidations: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          ecosystem_id: string
          global_account_id: string
          global_ledger_id: string | null
          id: string
          shop_account_id: string
          shop_ledger_id: string | null
          tx_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          ecosystem_id: string
          global_account_id: string
          global_ledger_id?: string | null
          id?: string
          shop_account_id: string
          shop_ledger_id?: string | null
          tx_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          ecosystem_id?: string
          global_account_id?: string
          global_ledger_id?: string | null
          id?: string
          shop_account_id?: string
          shop_ledger_id?: string | null
          tx_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "universe_wallet_consolidations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_wallet_consolidations_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_wallet_consolidations_global_account_id_fkey"
            columns: ["global_account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_wallet_consolidations_global_ledger_id_fkey"
            columns: ["global_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_wallet_consolidations_shop_account_id_fkey"
            columns: ["shop_account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_wallet_consolidations_shop_ledger_id_fkey"
            columns: ["shop_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "universe_wallet_consolidations_user_id_fkey"
            columns: ["user_id"]
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      verified_payments: {
        Row: {
          account_ref: string | null
          amount_php: number
          consumed_at: string | null
          consumed_cash_in_id: string | null
          id: string
          paid_at: string
          payer_name: string | null
          payer_reference: string | null
          payer_reference_key: string | null
          payment_method_id: string | null
          provider: string
          provider_txn_id: string
          raw: Json
          received_at: string
          source_id: string | null
          status: string
        }
        Insert: {
          account_ref?: string | null
          amount_php: number
          consumed_at?: string | null
          consumed_cash_in_id?: string | null
          id?: string
          paid_at?: string
          payer_name?: string | null
          payer_reference?: string | null
          payer_reference_key?: string | null
          payment_method_id?: string | null
          provider: string
          provider_txn_id: string
          raw?: Json
          received_at?: string
          source_id?: string | null
          status?: string
        }
        Update: {
          account_ref?: string | null
          amount_php?: number
          consumed_at?: string | null
          consumed_cash_in_id?: string | null
          id?: string
          paid_at?: string
          payer_name?: string | null
          payer_reference?: string | null
          payer_reference_key?: string | null
          payment_method_id?: string | null
          provider?: string
          provider_txn_id?: string
          raw?: Json
          received_at?: string
          source_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "verified_payments_consumed_cash_in_id_fkey"
            columns: ["consumed_cash_in_id"]
            isOneToOne: false
            referencedRelation: "cash_in_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verified_payments_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verified_payments_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "payment_feed_sources"
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
      voucher_device_tracers: {
        Row: {
          created_by: string | null
          device_mac: string
          ecosystem_id: string
          id: string
          in_conflict: boolean
          is_primary: boolean
          recorded_at: string
          resolved_at: string | null
          resolved_by: string | null
          tracer: string
          voucher_code: string
        }
        Insert: {
          created_by?: string | null
          device_mac: string
          ecosystem_id: string
          id?: string
          in_conflict?: boolean
          is_primary?: boolean
          recorded_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          tracer: string
          voucher_code: string
        }
        Update: {
          created_by?: string | null
          device_mac?: string
          ecosystem_id?: string
          id?: string
          in_conflict?: boolean
          is_primary?: boolean
          recorded_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          tracer?: string
          voucher_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_device_tracers_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_device_tracers_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
      voucher_monitors: {
        Row: {
          code: string
          created_at: string
          ecosystem_id: string
          id: string
          monitoring: boolean
          product_id: string | null
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          ecosystem_id: string
          id?: string
          monitoring?: boolean
          product_id?: string | null
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          ecosystem_id?: string
          id?: string
          monitoring?: boolean
          product_id?: string | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_monitors_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_monitors_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_monitors_product_id_fkey"
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
          platform_fee_percent: number
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
          platform_fee_percent?: number
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
          platform_fee_percent?: number
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_products_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_replenishment_runs: {
        Row: {
          available_before: number
          batch_id: string | null
          calibration_id: string | null
          calibration_version: number | null
          created_at: string
          ecosystem_id: string
          error: string | null
          finished_at: string | null
          generated_count: number
          id: string
          imported_count: number
          product_id: string
          requested_count: number
          status: string
          trigger_source: string
          updated_at: string
        }
        Insert: {
          available_before?: number
          batch_id?: string | null
          calibration_id?: string | null
          calibration_version?: number | null
          created_at?: string
          ecosystem_id: string
          error?: string | null
          finished_at?: string | null
          generated_count?: number
          id?: string
          imported_count?: number
          product_id: string
          requested_count?: number
          status?: string
          trigger_source?: string
          updated_at?: string
        }
        Update: {
          available_before?: number
          batch_id?: string | null
          calibration_id?: string | null
          calibration_version?: number | null
          created_at?: string
          ecosystem_id?: string
          error?: string | null
          finished_at?: string | null
          generated_count?: number
          id?: string
          imported_count?: number
          product_id?: string
          requested_count?: number
          status?: string
          trigger_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_replenishment_runs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "omada_voucher_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_replenishment_runs_calibration_id_fkey"
            columns: ["calibration_id"]
            isOneToOne: false
            referencedRelation: "omada_voucher_calibrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_replenishment_runs_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_replenishment_runs_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_replenishment_runs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "voucher_products"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_sales: {
        Row: {
          buyer_charge: number | null
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
          platform_fee_amount: number
          platform_fee_percent: number
          points_earned: number
          points_price: number | null
          points_rule_version: number | null
          points_spent: number
          product_id: string | null
          product_name: string
          quantity: number
          refund_reason: string | null
          refund_tx: string | null
          refunded_at: string | null
          reseller_id: string | null
          sale_price: number
          self_cashback: number
          seller_amount: number | null
          seller_id: string | null
          tx_id: string
          unit_price: number | null
          upline_commission_amount: number
          upline_commission_percent: number
          upline_recipient_id: string | null
        }
        Insert: {
          buyer_charge?: number | null
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
          platform_fee_amount?: number
          platform_fee_percent?: number
          points_earned?: number
          points_price?: number | null
          points_rule_version?: number | null
          points_spent?: number
          product_id?: string | null
          product_name: string
          quantity?: number
          refund_reason?: string | null
          refund_tx?: string | null
          refunded_at?: string | null
          reseller_id?: string | null
          sale_price: number
          self_cashback?: number
          seller_amount?: number | null
          seller_id?: string | null
          tx_id: string
          unit_price?: number | null
          upline_commission_amount?: number
          upline_commission_percent?: number
          upline_recipient_id?: string | null
        }
        Update: {
          buyer_charge?: number | null
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
          platform_fee_amount?: number
          platform_fee_percent?: number
          points_earned?: number
          points_price?: number | null
          points_rule_version?: number | null
          points_spent?: number
          product_id?: string | null
          product_name?: string
          quantity?: number
          refund_reason?: string | null
          refund_tx?: string | null
          refunded_at?: string | null
          reseller_id?: string | null
          sale_price?: number
          self_cashback?: number
          seller_amount?: number | null
          seller_id?: string | null
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
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "voucher_sales_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_usage_sessions: {
        Row: {
          ap_identifier: string | null
          authorization_id: string | null
          authorized_until: string | null
          connected_at: string | null
          device_mac: string
          device_name: string | null
          duration_seconds: number | null
          ecosystem_id: string
          first_seen_at: string
          id: string
          ip_address: string | null
          last_seen_at: string
          network_name: string | null
          session_key: string
          site_id: string | null
          still_valid: boolean | null
          traffic_bytes: number | null
          voucher_code: string
          voucher_state: string | null
        }
        Insert: {
          ap_identifier?: string | null
          authorization_id?: string | null
          authorized_until?: string | null
          connected_at?: string | null
          device_mac: string
          device_name?: string | null
          duration_seconds?: number | null
          ecosystem_id: string
          first_seen_at?: string
          id?: string
          ip_address?: string | null
          last_seen_at?: string
          network_name?: string | null
          session_key?: string
          site_id?: string | null
          still_valid?: boolean | null
          traffic_bytes?: number | null
          voucher_code: string
          voucher_state?: string | null
        }
        Update: {
          ap_identifier?: string | null
          authorization_id?: string | null
          authorized_until?: string | null
          connected_at?: string | null
          device_mac?: string
          device_name?: string | null
          duration_seconds?: number | null
          ecosystem_id?: string
          first_seen_at?: string
          id?: string
          ip_address?: string | null
          last_seen_at?: string
          network_name?: string | null
          session_key?: string
          site_id?: string | null
          still_valid?: boolean | null
          traffic_bytes?: number | null
          voucher_code?: string
          voucher_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voucher_usage_sessions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_usage_sessions_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawal_requests: {
        Row: {
          account_id: string | null
          account_name: string | null
          account_number: string | null
          admin_id: string | null
          cashout_path: string
          created_at: string
          credits: number
          decision_reason: string | null
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          gross_php: number
          id: string
          net_php: number
          notes: string | null
          payment_mode: string
          rate_credits: number
          rate_php: number
          reference: string
          refund_ledger_id: string | null
          released_at: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reserve_ledger_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          settlement_ledger_id: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_scope: string
        }
        Insert: {
          account_id?: string | null
          account_name?: string | null
          account_number?: string | null
          admin_id?: string | null
          cashout_path?: string
          created_at?: string
          credits: number
          decision_reason?: string | null
          ecosystem_id?: string | null
          fee_percent: number
          fee_php: number
          gross_php: number
          id?: string
          net_php: number
          notes?: string | null
          payment_mode: string
          rate_credits: number
          rate_php: number
          reference: string
          refund_ledger_id?: string | null
          released_at?: string | null
          request_key?: string | null
          requester_name: string
          requester_role: string
          reserve_ledger_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_name?: string | null
          settlement_ledger_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          wallet_scope?: string
        }
        Update: {
          account_id?: string | null
          account_name?: string | null
          account_number?: string | null
          admin_id?: string | null
          cashout_path?: string
          created_at?: string
          credits?: number
          decision_reason?: string | null
          ecosystem_id?: string | null
          fee_percent?: number
          fee_php?: number
          gross_php?: number
          id?: string
          net_php?: number
          notes?: string | null
          payment_mode?: string
          rate_credits?: number
          rate_php?: number
          reference?: string
          refund_ledger_id?: string | null
          released_at?: string | null
          request_key?: string | null
          requester_name?: string
          requester_role?: string
          reserve_ledger_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_name?: string | null
          settlement_ledger_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          wallet_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_requests_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_requests_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "discoverable_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_requests_ecosystem_id_fkey"
            columns: ["ecosystem_id"]
            isOneToOne: false
            referencedRelation: "ecosystems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_requests_refund_ledger_id_fkey"
            columns: ["refund_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_requests_reserve_ledger_id_fkey"
            columns: ["reserve_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_requests_settlement_ledger_id_fkey"
            columns: ["settlement_ledger_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      discoverable_shops: {
        Row: {
          city_municipality: string | null
          id: string | null
          name: string | null
          province: string | null
          shop_code: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acting_as: { Args: never; Returns: string }
      activate_free_subscription: {
        Args: { _ecosystem_id: string; _months?: number; _plan_id: string }
        Returns: {
          allocation_total: number
          created_at: string
          demo_seed_credits: number
          ecosystem_id: string
          period_end: string | null
          period_start: string | null
          plan_id: string | null
          review_ends_at: string | null
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shop_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      activate_go_live_request: {
        Args: { _request_id: string }
        Returns: string
      }
      activate_subscription: {
        Args: {
          _amount_php?: number
          _ecosystem_id: string
          _months?: number
          _plan_id: string
          _reference?: string
        }
        Returns: {
          allocation_total: number
          created_at: string
          demo_seed_credits: number
          ecosystem_id: string
          period_end: string | null
          period_start: string | null
          plan_id: string | null
          review_ends_at: string | null
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shop_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      active_ecosystem: { Args: { _user_id: string }; Returns: string }
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
          _ecosystem_id?: string
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
      admin_cash_in_capacity: {
        Args: { _ecosystem: string }
        Returns: {
          admin_id: string
          admin_name: string
          available: number
          balance: number
          reserved: number
        }[]
      }
      admin_load_credits: {
        Args: {
          _amount: number
          _ecosystem_id?: string
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
      admin_set_member_handle: {
        Args: { _handle: string; _target: string }
        Returns: string
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
      answer_guide_question: {
        Args: { _answer: string; _id: string; _publish?: boolean }
        Returns: undefined
      }
      apply_cash_in_receipt_ocr: {
        Args: {
          _amount?: number
          _details?: Json
          _id: string
          _paid_at?: string
          _proof_hash?: string
          _provider?: string
          _readable?: boolean
          _receiving?: string
          _receiving_account?: string
          _reference?: string
          _sender?: string
          _sender_account?: string
          _sender_name?: string
        }
        Returns: string
      }
      apply_go_live_receipt_ocr: {
        Args: {
          _amount: number
          _details?: Json
          _id: string
          _paid_at?: string
          _readable: boolean
          _reference: string
          _sender: string
        }
        Returns: string
      }
      apply_subscription_plan: {
        Args: {
          _amount_php?: number
          _ecosystem_id: string
          _months?: number
          _notes?: string
          _plan_id: string
          _reference?: string
        }
        Returns: {
          allocation_total: number
          created_at: string
          demo_seed_credits: number
          ecosystem_id: string
          period_end: string | null
          period_start: string | null
          plan_id: string | null
          review_ends_at: string | null
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shop_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_ecosystem: {
        Args: { _ecosystem_id: string; _reason?: string }
        Returns: string
      }
      assert_actor_active: { Args: never; Returns: undefined }
      assert_voucher_tracer_member: {
        Args: { _ecosystem_id: string }
        Returns: undefined
      }
      assign_shop_admin: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: undefined
      }
      auto_approved_payments: {
        Args: { _state?: string }
        Returns: {
          amount_due: number
          amount_paid: number
          auto_approved_at: string
          auto_reason: string
          ecosystem_id: string
          entitlement_hold: boolean
          frozen_reason: string
          id: string
          listener_amount: number
          listener_posted_at: string
          listener_provider: string
          listener_reference: string
          listener_sender: string
          monthly_rate: number
          months_purchased: number
          operations_frozen: boolean
          operator_name: string
          payer_number: string
          payment_method_name: string
          payment_reference: string
          plan_name: string
          purpose: string
          review_reason: string
          review_state: string
          reviewed_at: string
          reviewed_by_name: string
          shop_name: string
          submitted_at: string
        }[]
      }
      auto_disapprove_cash_in: {
        Args: {
          _duplicate_of?: string
          _id: string
          _kind?: string
          _reason: string
        }
        Returns: {
          amount_php: number
          approval_method: string
          authentication_checked_at: string | null
          authentication_reason: string | null
          auto_match_note: string | null
          created_at: string
          credits: number
          decision_reason: string | null
          duplicate_of: string | null
          duplicate_receipt: boolean
          duplicate_receipt_of: string | null
          duplicate_reference: boolean
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          funding_account_id: string | null
          funding_admin_id: string | null
          funding_ledger_id: string | null
          funding_source: string
          id: string
          ledger_id: string | null
          listener_event_id: string | null
          method_details: Json
          method_id: string | null
          method_name: string
          method_type: string
          net_php: number | null
          notes: string | null
          ocr_amount_php: number | null
          ocr_details: Json | null
          ocr_paid_at: string | null
          ocr_reference: string | null
          ocr_reference_key: string | null
          ocr_sender_number: string | null
          ocr_sender_number_key: string | null
          paid_at: string | null
          paid_at_edited: boolean
          payer_number: string | null
          payer_number_key: string | null
          payer_reference: string | null
          payer_reference_key: string | null
          payment_authenticated: boolean
          proof_hash: string | null
          proof_path: string | null
          provider_id: string | null
          provider_source: string | null
          rate_credits: number
          rate_php: number
          receipt_amount_php: number | null
          receipt_check: string
          receipt_checked_at: string | null
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_account_masked: string | null
          receipt_receiving_number: string | null
          receipt_receiving_number_key: string | null
          receipt_reference: string | null
          receipt_reference_key: string | null
          receipt_sender_account_masked: string | null
          receipt_sender_name: string | null
          receipt_sender_number: string | null
          receipt_sender_number_key: string | null
          receipt_verified: boolean
          reference: string
          reference_edited: boolean
          reference_source: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          sender_number: string | null
          sender_number_key: string | null
          staged_at: string | null
          staged_result: string | null
          status: string
          updated_at: string
          user_id: string
          verified_payment_id: string | null
          wallet_scope: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_in_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      auto_process_membership_application: {
        Args: { _application_id: string }
        Returns: boolean
      }
      can_impersonate: {
        Args: { _operator: string; _target: string }
        Returns: boolean
      }
      can_invite_members: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: boolean
      }
      can_load_credits: {
        Args: { _actor: string; _target: string }
        Returns: boolean
      }
      can_manage_login_credential: {
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
      can_review_shop: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: boolean
      }
      can_see_test_shop: { Args: { _ecosystem_id: string }; Returns: boolean }
      can_view_role: {
        Args: { _subject: string; _viewer: string }
        Returns: boolean
      }
      cancel_cash_in: {
        Args: { _id: string }
        Returns: {
          amount_php: number
          approval_method: string
          authentication_checked_at: string | null
          authentication_reason: string | null
          auto_match_note: string | null
          created_at: string
          credits: number
          decision_reason: string | null
          duplicate_of: string | null
          duplicate_receipt: boolean
          duplicate_receipt_of: string | null
          duplicate_reference: boolean
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          funding_account_id: string | null
          funding_admin_id: string | null
          funding_ledger_id: string | null
          funding_source: string
          id: string
          ledger_id: string | null
          listener_event_id: string | null
          method_details: Json
          method_id: string | null
          method_name: string
          method_type: string
          net_php: number | null
          notes: string | null
          ocr_amount_php: number | null
          ocr_details: Json | null
          ocr_paid_at: string | null
          ocr_reference: string | null
          ocr_reference_key: string | null
          ocr_sender_number: string | null
          ocr_sender_number_key: string | null
          paid_at: string | null
          paid_at_edited: boolean
          payer_number: string | null
          payer_number_key: string | null
          payer_reference: string | null
          payer_reference_key: string | null
          payment_authenticated: boolean
          proof_hash: string | null
          proof_path: string | null
          provider_id: string | null
          provider_source: string | null
          rate_credits: number
          rate_php: number
          receipt_amount_php: number | null
          receipt_check: string
          receipt_checked_at: string | null
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_account_masked: string | null
          receipt_receiving_number: string | null
          receipt_receiving_number_key: string | null
          receipt_reference: string | null
          receipt_reference_key: string | null
          receipt_sender_account_masked: string | null
          receipt_sender_name: string | null
          receipt_sender_number: string | null
          receipt_sender_number_key: string | null
          receipt_verified: boolean
          reference: string
          reference_edited: boolean
          reference_source: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          sender_number: string | null
          sender_number_key: string | null
          staged_at: string | null
          staged_result: string | null
          status: string
          updated_at: string
          user_id: string
          verified_payment_id: string | null
          wallet_scope: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_in_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_go_live_payment: {
        Args: { _request_id: string }
        Returns: {
          amount_due: number
          amount_paid: number | null
          auto_reason: string | null
          auto_state: string
          billing_period: string
          created_at: string
          currency: string
          decision_reason: string | null
          ecosystem_id: string
          entitlement_hold: boolean
          id: string
          listener_event_id: string | null
          monthly_rate: number | null
          months_purchased: number | null
          payer_number: string | null
          payer_number_key: string | null
          payer_reference_key: string | null
          payment_method_id: string | null
          payment_method_name: string | null
          payment_override: boolean
          payment_override_at: string | null
          payment_override_by: string | null
          payment_override_reason: string | null
          payment_reference: string
          period_end: string | null
          period_start: string | null
          plan_id: string | null
          plan_name: string
          plan_price: number
          previous_period_end: string | null
          proof_path: string | null
          purpose: string
          receipt_amount_php: number | null
          receipt_check: string
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_key: string | null
          receipt_reference_key: string | null
          receipt_sender_key: string | null
          remainder_amount: number
          requested_by: string | null
          requested_by_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          super_review_reason: string | null
          super_review_state: string
          super_reviewed_at: string | null
          super_reviewed_by: string | null
          super_reviewed_by_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "subscription_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_member_invitation: {
        Args: { _invitation_id: string }
        Returns: undefined
      }
      cancel_retail_order: { Args: { _order_id: string }; Returns: undefined }
      cancel_withdrawal: {
        Args: { _id: string }
        Returns: {
          account_id: string | null
          account_name: string | null
          account_number: string | null
          admin_id: string | null
          cashout_path: string
          created_at: string
          credits: number
          decision_reason: string | null
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          gross_php: number
          id: string
          net_php: number
          notes: string | null
          payment_mode: string
          rate_credits: number
          rate_php: number
          reference: string
          refund_ledger_id: string | null
          released_at: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reserve_ledger_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          settlement_ledger_id: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_scope: string
        }
        SetofOptions: {
          from: "*"
          to: "withdrawal_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cash_in_account_tail: {
        Args: { _row: Database["public"]["Tables"]["cash_in_requests"]["Row"] }
        Returns: string
      }
      cash_in_auth_blockers: { Args: { _id: string }; Returns: string[] }
      cash_in_auth_explain: { Args: { _codes: string[] }; Returns: string }
      cash_in_auto_rule: {
        Args: { _ecosystem: string }
        Returns: {
          amount_tolerance_php: number
          enabled: boolean
          expected_amount_php: number
          layer1_require_amount: boolean
          layer1_require_sender_number: boolean
          layer1_require_time_window: boolean
          layer2_require_amount_match: boolean
          layer2_require_listener_reference: boolean
          layer2_require_sender_match: boolean
          max_auto_amount_php: number
          require_listener_match: boolean
          require_receipt_match: boolean
          require_reference_match: boolean
          scope: string
          verification_mode: string
        }[]
      }
      cash_in_auto_status: { Args: never; Returns: Json }
      cash_in_conflict_snapshot: { Args: { _id: string }; Returns: Json }
      cash_in_credited_duplicate: {
        Args: {
          _id: string
          _proof_hash: string
          _provider: string
          _refkey: string
        }
        Returns: string
      }
      cash_in_duplicate_indicator: { Args: { _id: string }; Returns: Json }
      cash_in_enforce_receiver_account: {
        Args: { _id: string }
        Returns: string
      }
      cash_in_established_reference_key: {
        Args: { _row: Database["public"]["Tables"]["cash_in_requests"]["Row"] }
        Returns: string
      }
      cash_in_expected_receiving_accounts: {
        Args: { _row: Database["public"]["Tables"]["cash_in_requests"]["Row"] }
        Returns: {
          account: string
          label: string
          source: string
        }[]
      }
      cash_in_match_explanation: { Args: { _id: string }; Returns: Json }
      cash_in_pending_diagnostics: { Args: { _limit?: number }; Returns: Json }
      cash_in_receiver_account_check: {
        Args: {
          _ev: Database["public"]["Tables"]["listener_events"]["Row"]
          _row: Database["public"]["Tables"]["cash_in_requests"]["Row"]
        }
        Returns: Json
      }
      cash_in_receiving_number: {
        Args: { _ecosystem: string; _method: string }
        Returns: string
      }
      cash_in_receiving_tail: {
        Args: { _row: Database["public"]["Tables"]["cash_in_requests"]["Row"] }
        Returns: string
      }
      cash_in_reference_conflict_list: {
        Args: { _status?: string }
        Returns: {
          created_at: string
          credited_at: string | null
          credited_first: string | null
          ecosystem_id: string | null
          id: string
          new_request_id: string
          new_snapshot: Json
          old_request_id: string | null
          old_snapshot: Json
          reference: string | null
          reference_key: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "cash_in_reference_conflicts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cash_in_reference_duplicate: {
        Args: { _id: string; _key: string; _paid_at?: string }
        Returns: string
      }
      cash_in_sender_key: {
        Args: { _row: Database["public"]["Tables"]["cash_in_requests"]["Row"] }
        Returns: string
      }
      cashback_chain: {
        Args: { _ecosystem_id: string; _source: string }
        Returns: {
          kind: string
          pct: number
          recipient_id: string
        }[]
      }
      cashback_sale_sources: {
        Args: { _sale_ids: string[] }
        Returns: {
          buyer_role: Database["public"]["Enums"]["app_role"]
          quantity: number
          sale_id: string
        }[]
      }
      cashback_split_preview: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: Json
      }
      claim_push_deliveries: {
        Args: { _limit?: number }
        Returns: {
          auth_secret: string
          body: string
          category: string
          created_at: string
          delivery_id: string
          device_id: string
          ecosystem_id: string
          endpoint: string
          kind: string
          link: string
          notification_id: string
          p256dh: string
          show_details: boolean
          title: string
          user_id: string
        }[]
      }
      claim_super_admin_bootstrap: {
        Args: { _email: string; _source: string }
        Returns: string
      }
      clear_login_username: { Args: { _target: string }; Returns: boolean }
      commission_rate_for: {
        Args: { _recipient: string; _sender: string }
        Returns: number
      }
      consolidate_universe_wallets: {
        Args: { _dry_run?: boolean; _ecosystem_id: string }
        Returns: {
          amount: number
          detail: string
          ecosystem_id: string
          outcome: string
          user_id: string
        }[]
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
          _shop_type?: string
          _signup_enabled?: boolean
          _slug?: string
        }
        Returns: {
          admin_assigned_at: string | null
          admin_assigned_by: string | null
          admin_sale_commission_percent: number
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          cash_in_gcash_number: string | null
          contact_email: string | null
          contact_name: string | null
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
          is_review: boolean
          is_test: boolean
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          public_storefront_enabled: boolean
          retail_accepting_orders: boolean
          retail_cash_enabled: boolean
          retail_cod_enabled: boolean
          retail_cover_path: string | null
          retail_credit_enabled: boolean
          retail_delivery_enabled: boolean
          retail_delivery_fee: number
          retail_delivery_split_collector_pct: number
          retail_delivery_split_delivery_pct: number
          retail_logo_path: string | null
          retail_paused_note: string | null
          retail_pickup_enabled: boolean
          retail_storefront_theme: string
          review_ends_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_barangay: string | null
          shop_city_municipality: string | null
          shop_code: string | null
          shop_kind: string
          shop_province: string | null
          shop_street: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          store_retail_enabled: boolean
          store_voucher_enabled: boolean
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
          use_platform_payment_methods: boolean
        }
        SetofOptions: {
          from: "*"
          to: "ecosystems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_review_shop: {
        Args: { _description?: string; _name: string }
        Returns: {
          admin_assigned_at: string | null
          admin_assigned_by: string | null
          admin_sale_commission_percent: number
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          cash_in_gcash_number: string | null
          contact_email: string | null
          contact_name: string | null
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
          is_review: boolean
          is_test: boolean
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          public_storefront_enabled: boolean
          retail_accepting_orders: boolean
          retail_cash_enabled: boolean
          retail_cod_enabled: boolean
          retail_cover_path: string | null
          retail_credit_enabled: boolean
          retail_delivery_enabled: boolean
          retail_delivery_fee: number
          retail_delivery_split_collector_pct: number
          retail_delivery_split_delivery_pct: number
          retail_logo_path: string | null
          retail_paused_note: string | null
          retail_pickup_enabled: boolean
          retail_storefront_theme: string
          review_ends_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_barangay: string | null
          shop_city_municipality: string | null
          shop_code: string | null
          shop_kind: string
          shop_province: string | null
          shop_street: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          store_retail_enabled: boolean
          store_voucher_enabled: boolean
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
          use_platform_payment_methods: boolean
        }
        SetofOptions: {
          from: "*"
          to: "ecosystems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_universe_shop: {
        Args: { _description?: string; _name: string; _shop_type: string }
        Returns: {
          admin_assigned_at: string | null
          admin_assigned_by: string | null
          admin_sale_commission_percent: number
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          cash_in_gcash_number: string | null
          contact_email: string | null
          contact_name: string | null
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
          is_review: boolean
          is_test: boolean
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          public_storefront_enabled: boolean
          retail_accepting_orders: boolean
          retail_cash_enabled: boolean
          retail_cod_enabled: boolean
          retail_cover_path: string | null
          retail_credit_enabled: boolean
          retail_delivery_enabled: boolean
          retail_delivery_fee: number
          retail_delivery_split_collector_pct: number
          retail_delivery_split_delivery_pct: number
          retail_logo_path: string | null
          retail_paused_note: string | null
          retail_pickup_enabled: boolean
          retail_storefront_theme: string
          review_ends_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_barangay: string | null
          shop_city_municipality: string | null
          shop_code: string | null
          shop_kind: string
          shop_province: string | null
          shop_street: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          store_retail_enabled: boolean
          store_voucher_enabled: boolean
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
          use_platform_payment_methods: boolean
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
      delete_expense: { Args: { _id: string }; Returns: boolean }
      delete_listener_source_rule: { Args: { _rule: string }; Returns: boolean }
      delete_own_shop: {
        Args: { _confirm_name: string; _ecosystem_id: string; _reason: string }
        Returns: Json
      }
      delete_payment_method: { Args: { _id: string }; Returns: undefined }
      delete_social_promotion_tier: {
        Args: { _tier_id: string }
        Returns: undefined
      }
      delete_voucher_batch: { Args: { _import_id: string }; Returns: number }
      delete_voucher_batch_unused: {
        Args: { _import_id: string }
        Returns: number
      }
      delete_voucher_code: { Args: { _code_id: string }; Returns: undefined }
      delete_voucher_product: {
        Args: { _confirm_name: string; _product_id: string }
        Returns: Json
      }
      demo_guard: { Args: { _ecosystem_id: string }; Returns: undefined }
      demo_reset: { Args: { _ecosystem_id: string }; Returns: undefined }
      demo_sell_voucher: {
        Args: {
          _ecosystem_id: string
          _quantity?: number
          _reseller_rate?: number
          _subreseller_rate?: number
          _voucher_id: string
        }
        Returns: Json
      }
      demo_shop_state: { Args: { _ecosystem_id: string }; Returns: Json }
      demo_transfer: {
        Args: {
          _amount: number
          _ecosystem_id: string
          _from: string
          _to: string
        }
        Returns: Json
      }
      dismiss_listener_event: {
        Args: { _event: string; _note?: string }
        Returns: Json
      }
      dm_is_active_member: {
        Args: { _thread_id: string; _user_id: string }
        Returns: boolean
      }
      dm_messages_for: {
        Args: { _thread_id: string }
        Returns: {
          body: string
          created_at: string
          id: string
          image_path: string
          mine: boolean
          sender_id: string
          sender_name: string
        }[]
      }
      dm_open_thread: { Args: { _member_id: string }; Returns: string }
      dm_order_chat_context: {
        Args: { _thread_ids: string[] }
        Returns: {
          fulfillment_status: string
          order_no: string
          shop_name: string
          shop_slug: string
          status: string
          thread_id: string
        }[]
      }
      dm_send:
        | { Args: { _body: string; _member_id: string }; Returns: Json }
        | {
            Args: { _body: string; _image_path?: string; _member_id: string }
            Returns: Json
          }
      dm_send_thread: {
        Args: { _body: string; _image_path?: string; _thread_id: string }
        Returns: Json
      }
      dm_thread_list: {
        Args: never
        Returns: {
          blocked: boolean
          kind: string
          last_message_at: string
          member_avatar: string
          member_handle: string
          member_id: string
          member_name: string
          member_online: boolean
          order_id: string
          participants: Json
          preview: string
          thread_id: string
          title: string
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
      ecosystem_has_admin: { Args: { _ecosystem_id: string }; Returns: boolean }
      ecosystem_last_activity: {
        Args: { _ecosystem_id: string }
        Returns: string
      }
      ecosystem_monthly_rate: {
        Args: { _ecosystem_id: string }
        Returns: number
      }
      ecosystem_platform_payment_option: {
        Args: { _ecosystem: string }
        Returns: Json
      }
      effective_uid: { Args: never; Returns: string }
      end_impersonation: { Args: never; Returns: undefined }
      ensure_credit_account: {
        Args: { _ecosystem_id?: string; _user_id: string }
        Returns: string
      }
      ensure_global_wallet: { Args: { _user_id: string }; Returns: string }
      ensure_membership_wallets: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: undefined
      }
      expire_push_device: {
        Args: { _id: string; _reason?: string }
        Returns: undefined
      }
      expire_stale_invitations: { Args: never; Returns: undefined }
      expire_stale_member_invitations: { Args: never; Returns: number }
      expire_stale_subscriptions: { Args: never; Returns: number }
      find_shop_by_code: {
        Args: { _code: string }
        Returns: {
          city_municipality: string
          id: string
          name: string
          province: string
          shop_code: string
        }[]
      }
      finish_push_delivery: {
        Args: {
          _delivery_id: string
          _device_gone?: boolean
          _reason?: string
          _status: string
        }
        Returns: undefined
      }
      follow_member: {
        Args: { _follow?: boolean; _user: string }
        Returns: undefined
      }
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
      generate_shop_code: { Args: never; Returns: string }
      get_signup_ecosystem: {
        Args: { _slug: string }
        Returns: {
          description: string
          id: string
          name: string
          slug: string
        }[]
      }
      go_live_has_strong_signal: {
        Args: {
          _ev: Database["public"]["Tables"]["listener_events"]["Row"]
          _req: Database["public"]["Tables"]["subscription_requests"]["Row"]
        }
        Returns: boolean
      }
      go_live_match_anchor: {
        Args: {
          _req: Database["public"]["Tables"]["subscription_requests"]["Row"]
        }
        Returns: string
      }
      go_live_match_signals: {
        Args: {
          _ev: Database["public"]["Tables"]["listener_events"]["Row"]
          _req: Database["public"]["Tables"]["subscription_requests"]["Row"]
        }
        Returns: number
      }
      go_live_receiving_matches: {
        Args: {
          _ev: Database["public"]["Tables"]["listener_events"]["Row"]
          _req: Database["public"]["Tables"]["subscription_requests"]["Row"]
        }
        Returns: boolean
      }
      go_live_reference_duplicate: {
        Args: { _id?: string; _key: string }
        Returns: string
      }
      guide_questions_admin: {
        Args: never
        Returns: {
          answer: string | null
          answered_at: string | null
          contact: string | null
          created_at: string
          id: string
          question: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "guide_questions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      guide_questions_public: {
        Args: { _limit?: number }
        Returns: {
          answer: string
          id: string
          question: string
        }[]
      }
      handle_available: {
        Args: { _ecosystem_id?: string; _handle: string }
        Returns: boolean
      }
      handle_candidate: {
        Args: { _email?: string; _name: string }
        Returns: string
      }
      has_membership: {
        Args: { _ecosystem_id: string; _user_id: string }
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
      invite_universe_member: {
        Args: { _ecosystem_id: string; _message?: string; _user_id: string }
        Returns: string
      }
      is_ecosystem_admin: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: boolean
      }
      is_legacy_shop: { Args: { _ecosystem_id: string }; Returns: boolean }
      is_new_generation_shop: {
        Args: { _ecosystem_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_universe_member: { Args: { _user: string }; Returns: boolean }
      is_universe_shop: { Args: { _ecosystem_id: string }; Returns: boolean }
      join_shop_by_code: { Args: { _code: string }; Returns: string }
      joinable_ecosystems: {
        Args: never
        Returns: {
          description: string
          id: string
          name: string
          pending: boolean
          slug: string
        }[]
      }
      leave_shop: {
        Args: { _ecosystem_id: string; _step_down?: boolean }
        Returns: Json
      }
      leave_shop_preview: { Args: { _ecosystem_id: string }; Returns: Json }
      link_cash_in_listener_event: { Args: { _id: string }; Returns: string }
      link_listener_event: {
        Args: { _cash_in: string; _event: string; _note?: string }
        Returns: Json
      }
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
      list_ecosystem_invitations: {
        Args: { _ecosystem_id: string; _status?: string }
        Returns: {
          avatar_path: string
          created_at: string
          expires_at: string
          full_name: string
          handle: string
          id: string
          inviter_name: string
          inviter_role: Database["public"]["Enums"]["app_role"]
          message: string
          responded_at: string
          status: string
          user_id: string
        }[]
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
      list_public_shops: {
        Args: { _limit?: number; _q?: string }
        Returns: {
          description: string
          id: string
          member_count: number
          name: string
          rating_avg: number
          rating_count: number
          retail_enabled: boolean
          slug: string
          voucher_enabled: boolean
        }[]
      }
      list_retail_orders: {
        Args: { _ecosystem_id: string; _status?: string }
        Returns: {
          cashback_amount: number
          chat_thread_id: string
          cod_actual_cash: number
          cod_cash_received_at: string
          cod_discrepancy: boolean
          cod_expected_cash: number
          cod_settled_at: string
          cod_settlement_kind: string
          collector_id: string
          collector_name: string
          collector_share_amount: number
          collector_status: string
          completed_at: string
          created_at: string
          customer_id: string
          customer_name: string
          decision_note: string
          delivered_at: string
          delivery_address: string
          delivery_fee: number
          delivery_notes: string
          delivery_person_id: string
          delivery_person_name: string
          delivery_share_amount: number
          delivery_split_collector_pct: number
          delivery_split_delivery_pct: number
          fulfillment: string
          fulfillment_status: string
          hold_held: boolean
          id: string
          items: Json
          order_no: string
          payment_method: string
          platform_fee_amount: number
          platform_fee_percent: number
          self_delivery: boolean
          seller_amount: number
          seller_id: string
          seller_name: string
          seller_total: number
          status: string
          total: number
        }[]
      }
      list_retail_products: {
        Args: { _ecosystem_id: string }
        Returns: {
          brand: string
          category: string
          description: string
          id: string
          image_path: string
          name: string
          price: number
          public_visible: boolean
          rating_avg: number
          rating_count: number
          size_label: string
          sold_count: number
          stock: number
          unit: string
          variant: string
          wholesale_min_qty: number
          wholesale_price: number
        }[]
      }
      list_rewards: {
        Args: { _ecosystem_id?: string }
        Returns: {
          available: number
          description: string
          id: string
          image_path: string
          name: string
          points_price: number
          rating_avg: number
          rating_count: number
          redeemed_count: number
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
          rating_avg: number
          rating_count: number
          sold_count: number
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
      listener_auth_material: { Args: { _device: string }; Returns: Json }
      listener_claim_nonce: {
        Args: { _device: string; _nonce: string }
        Returns: boolean
      }
      listener_detected_sources: {
        Args: { _ecosystem?: string }
        Returns: Json
      }
      listener_device_source_rules: { Args: { _device: string }; Returns: Json }
      listener_device_status: { Args: never; Returns: Json }
      listener_event_account_tail: {
        Args: { _ev: Database["public"]["Tables"]["listener_events"]["Row"] }
        Returns: string
      }
      listener_event_fits_cash_in: {
        Args: {
          _ev: Database["public"]["Tables"]["listener_events"]["Row"]
          _row: Database["public"]["Tables"]["cash_in_requests"]["Row"]
        }
        Returns: boolean
      }
      listener_event_receiving_tail: {
        Args: { _ev: Database["public"]["Tables"]["listener_events"]["Row"] }
        Returns: string
      }
      listener_has_strong_signal: {
        Args: {
          _ev: Database["public"]["Tables"]["listener_events"]["Row"]
          _row: Database["public"]["Tables"]["cash_in_requests"]["Row"]
        }
        Returns: boolean
      }
      listener_heartbeat: {
        Args: {
          _app_version?: string
          _device: string
          _last_received_at?: string
          _listener_connected?: boolean
          _notification_access?: boolean
          _received_count?: number
        }
        Returns: {
          app_version: string | null
          created_at: string
          created_by: string | null
          ecosystem_id: string | null
          id: string
          label: string
          last_event_at: string | null
          last_received_at: string | null
          last_seen_at: string | null
          listener_connected: boolean | null
          listener_state_at: string | null
          match_window_minutes: number
          notification_access: boolean | null
          offline_after_minutes: number
          owner_role: string
          package_name: string
          received_count: number
          receiving_number: string | null
          receiving_number_key: string | null
          revoked_at: string | null
          revoked_by: string | null
          secret_key_hash: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "listener_devices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      listener_match_signal_details: {
        Args: {
          _ev: Database["public"]["Tables"]["listener_events"]["Row"]
          _row: Database["public"]["Tables"]["cash_in_requests"]["Row"]
        }
        Returns: Json
      }
      listener_match_signals: {
        Args: {
          _ev: Database["public"]["Tables"]["listener_events"]["Row"]
          _row: Database["public"]["Tables"]["cash_in_requests"]["Row"]
        }
        Returns: number
      }
      listener_receiving_number_matches: {
        Args: { _device: string; _ecosystem: string; _method: string }
        Returns: boolean
      }
      listener_serves_destination: {
        Args: { _device: string; _ecosystem: string; _method: string }
        Returns: boolean
      }
      listener_source_allowed: {
        Args: { _device: string; _package: string }
        Returns: boolean
      }
      listener_source_effective_mode: {
        Args: { _device?: string; _ecosystem?: string; _package: string }
        Returns: string
      }
      listener_source_rules_list: {
        Args: { _ecosystem?: string }
        Returns: Json
      }
      listener_unmatched_events: { Args: { _limit?: number }; Returns: Json }
      live_shop_name: { Args: { _name: string }; Returns: string }
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
      lookup_universe_recipient: {
        Args: { _limit?: number; _query: string }
        Returns: {
          avatar_path: string
          full_name: string
          handle: string
          id: string
        }[]
      }
      mark_notifications_read: { Args: { _ids?: string[] }; Returns: undefined }
      match_listener_event: { Args: { _event: string }; Returns: string }
      member_cashback_rate: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: number
      }
      member_ecosystem_scope: {
        Args: { _ecosystem_id?: string; _user_id: string }
        Returns: string
      }
      member_email_taken: {
        Args: { _email: string; _exclude?: string }
        Returns: boolean
      }
      member_shop_wallets: {
        Args: { _user_id: string }
        Returns: {
          balance: number
          ecosystem_id: string
          ecosystem_name: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      membership_review_balances: {
        Args: { _application_ids: string[] }
        Returns: {
          application_id: string
          balance: number
        }[]
      }
      membership_role: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      money_settings: {
        Args: never
        Returns: {
          cash_in_fee_percent: number
          cashback_reseller: number
          cashback_subreseller: number
          credits_per_unit: number
          fee_percent: number
          php_per_unit: number
        }[]
      }
      months_for_payment: {
        Args: { _amount: number; _rate: number }
        Returns: number
      }
      my_applications: {
        Args: never
        Returns: {
          created_at: string
          decision_reason: string
          ecosystem_id: string
          ecosystem_name: string
          status: string
        }[]
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
      my_memberships: {
        Args: never
        Returns: {
          ecosystem_id: string
          ecosystem_name: string
          ecosystem_slug: string
          is_active: boolean
          membership_state: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["account_status"]
        }[]
      }
      my_notifications: {
        Args: { _limit?: number }
        Returns: {
          body: string
          category: string
          created_at: string
          delivery_status: string
          id: string
          kind: string
          link: string
          read_at: string
          title: string
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
      my_push_devices: {
        Args: never
        Returns: {
          created_at: string
          device_label: string
          endpoint: string
          expired_at: string
          id: string
          last_error: string
          last_seen_at: string
          push_capable: boolean
          push_enabled: boolean
          user_agent: string
        }[]
      }
      my_rating_eligibility: {
        Args: never
        Returns: {
          item_id: string
          item_name: string
          kind: string
          my_rating: number
          transacted_at: string
          transaction_id: string
        }[]
      }
      my_retail_orders: {
        Args: { _ecosystem_id: string }
        Returns: {
          buyer_charge: number
          chat_thread_id: string
          cod_settled_at: string
          collector_name: string
          collector_status: string
          completed_at: string
          created_at: string
          decision_note: string
          delivered_at: string
          delivery_address: string
          delivery_fee: number
          delivery_notes: string
          delivery_person_name: string
          fulfillment: string
          fulfillment_status: string
          hold_held: boolean
          id: string
          items: Json
          order_no: string
          payment_method: string
          platform_fee_amount: number
          platform_fee_percent: number
          self_cashback: number
          self_delivery: boolean
          seller_name: string
          seller_total: number
          shop_name: string
          status: string
          total: number
        }[]
      }
      my_review_shop: { Args: never; Returns: Json }
      my_sent_shop_invitations: {
        Args: { _ecosystem_id: string }
        Returns: {
          avatar_path: string
          created_at: string
          expires_at: string
          full_name: string
          handle: string
          id: string
          inviter_name: string
          inviter_role: Database["public"]["Enums"]["app_role"]
          message: string
          responded_at: string
          status: string
          user_id: string
        }[]
      }
      my_shop_invitations: {
        Args: never
        Returns: {
          created_at: string
          ecosystem_id: string
          ecosystem_name: string
          expires_at: string
          id: string
          inviter_name: string
          inviter_role: Database["public"]["Enums"]["app_role"]
          message: string
          status: string
        }[]
      }
      my_shop_wallets: {
        Args: never
        Returns: {
          balance: number
          ecosystem_id: string
          ecosystem_name: string
        }[]
      }
      my_social_graph: {
        Args: never
        Returns: {
          avatar_path: string
          created_at: string
          full_name: string
          handle: string
          kind: string
          relation_id: string
          status: string
          user_id: string
        }[]
      }
      new_tx_id: { Args: never; Returns: string }
      normalize_handle: { Args: { _handle: string }; Returns: string }
      normalize_payment_reference: { Args: { _ref: string }; Returns: string }
      normalize_ph_mobile: { Args: { _n: string }; Returns: string }
      normalize_sender_identifier: { Args: { _raw: string }; Returns: string }
      notify_financial: {
        Args: {
          _body?: string
          _ecosystem: string
          _event_key?: string
          _kind: string
          _link?: string
          _title: string
          _user: string
        }
        Returns: string
      }
      notify_financial_safe: {
        Args: {
          _body?: string
          _ecosystem: string
          _event_key?: string
          _kind: string
          _link?: string
          _title: string
          _user: string
        }
        Returns: undefined
      }
      notify_handle_mentions: {
        Args: {
          _actor: string
          _body: string
          _kind: string
          _link: string
          _title: string
        }
        Returns: undefined
      }
      notify_member: {
        Args: {
          _body: string
          _ecosystem_id: string
          _kind: string
          _link?: string
          _title: string
          _user_id: string
        }
        Returns: undefined
      }
      notify_universe: {
        Args: {
          _body: string
          _kind: string
          _link?: string
          _title: string
          _user: string
        }
        Returns: undefined
      }
      override_subscription_payment: {
        Args: { _ecosystem_id: string; _reason: string }
        Returns: Json
      }
      payment_account_matches: {
        Args: { _configured: string; _evidence: string }
        Returns: boolean
      }
      payment_account_tail: { Args: { _value: string }; Returns: string }
      payment_name_key: { Args: { _value: string }; Returns: string }
      payment_provider_by_name: { Args: { _name: string }; Returns: string }
      payment_provider_for: {
        Args: { _package: string; _text?: string }
        Returns: string
      }
      payment_qr_scope: { Args: { _folder: string }; Returns: string }
      payment_reference_hash: {
        Args: { _key: string; _provider: string }
        Returns: string
      }
      payment_reference_used_elsewhere: {
        Args: { _cash_in: string; _key: string; _provider: string }
        Returns: boolean
      }
      platform_cash_in_readiness: { Args: never; Returns: Json }
      platform_credit_supply: {
        Args: never
        Returns: {
          issuance_count: number
          last_issued_at: string
          total_issued: number
        }[]
      }
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
      platform_unassigned_users: {
        Args: { _search?: string }
        Returns: {
          avatar_path: string
          credit_total: number
          email: string
          full_name: string
          handle: string
          joined_at: string
          phone: string
          points_total: number
          user_id: string
        }[]
      }
      platform_user_deletion_check: {
        Args: { _override?: boolean; _user: string }
        Returns: {
          credit_total: number
          eligible: boolean
          points_total: number
          reason: string
          social_purchased: number
        }[]
      }
      presence_online_window: { Args: never; Returns: string }
      profile_media_visible: {
        Args: { _name: string; _user: string }
        Returns: boolean
      }
      promote_to_reseller: {
        Args: { _discount: number; _ecosystem_id?: string; _user_id: string }
        Returns: undefined
      }
      promote_to_subreseller: {
        Args: {
          _discount: number
          _ecosystem_id?: string
          _parent_reseller_id?: string
          _user_id: string
        }
        Returns: undefined
      }
      public_shop_overview: {
        Args: { _slug: string }
        Returns: {
          accepting_orders: boolean
          admin_name: string
          contact_email: string
          contact_phone: string
          cover_path: string
          description: string
          facebook_page_url: string
          has_admin: boolean
          id: string
          is_member: boolean
          logo_path: string
          member_count: number
          name: string
          paused_note: string
          pending_application: boolean
          product_count: number
          rating_avg: number
          rating_count: number
          retail_enabled: boolean
          sales_count: number
          slug: string
          storefront_public: boolean
          storefront_theme: string
          voucher_enabled: boolean
        }[]
      }
      public_shop_products: {
        Args: { _slug: string }
        Returns: {
          available: number
          description: string
          id: string
          image_path: string
          kind: string
          name: string
          price: number
          rating_avg: number
          rating_count: number
        }[]
      }
      public_shop_reviews: {
        Args: { _limit?: number; _slug: string }
        Returns: {
          author_name: string
          comment: string
          created_at: string
          id: string
          rating: number
        }[]
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
      public_support_contact: {
        Args: never
        Returns: {
          support_message: string
          support_page_name: string
          support_page_url: string
        }[]
      }
      purchase_voucher: {
        Args: { _product_id: string; _quantity?: number; _seller_id?: string }
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
        Args: { _product_id: string; _seller_id?: string }
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
      purge_ecosystem_internal: {
        Args: {
          _actor: string
          _deletion_kind: string
          _ecosystem_id: string
          _outstanding?: Json
          _reason: string
        }
        Returns: Json
      }
      rate_retail_product: {
        Args: {
          _comment?: string
          _order_id: string
          _product_id: string
          _rating: number
        }
        Returns: undefined
      }
      rate_reward_redemption: {
        Args: { _comment?: string; _rating: number; _redemption_id: string }
        Returns: string
      }
      rate_shop: {
        Args: { _comment?: string; _ecosystem_id: string; _rating: number }
        Returns: undefined
      }
      rate_voucher_sale: {
        Args: { _comment?: string; _rating: number; _sale_id: string }
        Returns: string
      }
      real_super_admin_exists: { Args: never; Returns: boolean }
      recheck_pending_cash_ins: { Args: never; Returns: Json }
      reconcile_cash_in: { Args: { _id: string }; Returns: string }
      reconcile_go_live_payments: { Args: { _days?: number }; Returns: Json }
      reconcile_go_live_request: {
        Args: { _request_id: string }
        Returns: string
      }
      reconcile_listener_events: {
        Args: { _max_age_hours?: number }
        Returns: Json
      }
      reconcile_payments: { Args: { _days?: number }; Returns: Json }
      record_app_download: { Args: never; Returns: number }
      record_cash_in_reference_conflict: {
        Args: { _new: string }
        Returns: string
      }
      record_expense:
        | {
            Args: {
              _amount: number
              _category?: string
              _description: string
              _ecosystem_id?: string
              _scope?: string
              _spent_at?: string
            }
            Returns: {
              amount: number
              category: string | null
              category_id: string | null
              client_ref: string | null
              created_at: string
              created_by: string
              created_by_name: string | null
              currency: string
              description: string
              ecosystem_id: string | null
              id: string
              notes: string | null
              provider: string | null
              provider_reference: string | null
              scope: string
              spent_at: string
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "business_expenses"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              _amount: number
              _category?: string
              _description: string
              _ecosystem_id?: string
              _provider?: string
              _provider_reference?: string
              _scope?: string
              _spent_at?: string
            }
            Returns: {
              amount: number
              category: string | null
              category_id: string | null
              client_ref: string | null
              created_at: string
              created_by: string
              created_by_name: string | null
              currency: string
              description: string
              ecosystem_id: string | null
              id: string
              notes: string | null
              provider: string | null
              provider_reference: string | null
              scope: string
              spent_at: string
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "business_expenses"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      record_listener_event: {
        Args: {
          _amount?: number
          _app_label?: string
          _category?: string
          _channel?: string
          _details?: Json
          _device: string
          _event_uid: string
          _gcash_reference?: string
          _package: string
          _parser_version?: string
          _posted_at?: string
          _provider?: string
          _raw_text?: string
          _sender_name?: string
          _sender_number?: string
        }
        Returns: Json
      }
      record_manual_gcash_payment: {
        Args: {
          _amount: number
          _ecosystem?: string
          _note?: string
          _received_at: string
          _receiving_number: string
          _reference: string
          _sender_name?: string
          _sender_number?: string
        }
        Returns: Json
      }
      record_payment_match: {
        Args: {
          _cash_in: string
          _decision: string
          _provider: string
          _reference_hash?: string
        }
        Returns: string
      }
      record_universe_product_view: {
        Args: { _kind: string; _product_id: string }
        Returns: undefined
      }
      record_verified_payment: {
        Args: {
          _account_ref?: string
          _amount_php: number
          _paid_at?: string
          _payer_name?: string
          _payer_reference?: string
          _provider: string
          _provider_txn_id: string
          _raw?: Json
        }
        Returns: Json
      }
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
      register_listener_device: {
        Args: {
          _ecosystem?: string
          _label: string
          _offline_minutes?: number
          _package?: string
          _receiving_number?: string
          _window_minutes?: number
        }
        Returns: Json
      }
      register_push_device: {
        Args: {
          _auth?: string
          _endpoint: string
          _label?: string
          _p256dh?: string
          _user_agent?: string
        }
        Returns: string
      }
      release_super_admin_bootstrap: {
        Args: { _email: string }
        Returns: undefined
      }
      remember_payment_reference: {
        Args: {
          _cash_in: string
          _ecosystem: string
          _key: string
          _provider: string
        }
        Returns: string
      }
      remove_friend: { Args: { _user: string }; Returns: undefined }
      remove_kept_shop_member: {
        Args: { _application_id: string; _reason?: string }
        Returns: undefined
      }
      remove_push_device: { Args: { _id: string }; Returns: undefined }
      repair_listener_device: { Args: { _device: string }; Returns: Json }
      request_cash_in: {
        Args: {
          _amount_php: number
          _funding_source?: string
          _method_id: string
          _notes?: string
          _ocr?: Json
          _paid_at?: string
          _payer_number?: string
          _payer_reference?: string
          _proof_path?: string
          _request_key?: string
          _wallet_scope?: string
        }
        Returns: {
          amount_php: number
          approval_method: string
          authentication_checked_at: string | null
          authentication_reason: string | null
          auto_match_note: string | null
          created_at: string
          credits: number
          decision_reason: string | null
          duplicate_of: string | null
          duplicate_receipt: boolean
          duplicate_receipt_of: string | null
          duplicate_reference: boolean
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          funding_account_id: string | null
          funding_admin_id: string | null
          funding_ledger_id: string | null
          funding_source: string
          id: string
          ledger_id: string | null
          listener_event_id: string | null
          method_details: Json
          method_id: string | null
          method_name: string
          method_type: string
          net_php: number | null
          notes: string | null
          ocr_amount_php: number | null
          ocr_details: Json | null
          ocr_paid_at: string | null
          ocr_reference: string | null
          ocr_reference_key: string | null
          ocr_sender_number: string | null
          ocr_sender_number_key: string | null
          paid_at: string | null
          paid_at_edited: boolean
          payer_number: string | null
          payer_number_key: string | null
          payer_reference: string | null
          payer_reference_key: string | null
          payment_authenticated: boolean
          proof_hash: string | null
          proof_path: string | null
          provider_id: string | null
          provider_source: string | null
          rate_credits: number
          rate_php: number
          receipt_amount_php: number | null
          receipt_check: string
          receipt_checked_at: string | null
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_account_masked: string | null
          receipt_receiving_number: string | null
          receipt_receiving_number_key: string | null
          receipt_reference: string | null
          receipt_reference_key: string | null
          receipt_sender_account_masked: string | null
          receipt_sender_name: string | null
          receipt_sender_number: string | null
          receipt_sender_number_key: string | null
          receipt_verified: boolean
          reference: string
          reference_edited: boolean
          reference_source: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          sender_number: string | null
          sender_number_key: string | null
          staged_at: string | null
          staged_result: string | null
          status: string
          updated_at: string
          user_id: string
          verified_payment_id: string | null
          wallet_scope: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_in_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_join_ecosystem: {
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
      request_withdrawal: {
        Args: {
          _account_name?: string
          _account_number?: string
          _cashout_path?: string
          _credits: number
          _notes?: string
          _payment_mode: string
          _request_key?: string
          _wallet_scope?: string
        }
        Returns: {
          account_id: string | null
          account_name: string | null
          account_number: string | null
          admin_id: string | null
          cashout_path: string
          created_at: string
          credits: number
          decision_reason: string | null
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          gross_php: number
          id: string
          net_php: number
          notes: string | null
          payment_mode: string
          rate_credits: number
          rate_php: number
          reference: string
          refund_ledger_id: string | null
          released_at: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reserve_ledger_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          settlement_ledger_id: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_scope: string
        }
        SetofOptions: {
          from: "*"
          to: "withdrawal_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      require_operational: { Args: never; Returns: undefined }
      reseller_list_subresellers: {
        Args: never
        Returns: {
          avatar_path: string
          balance: number
          full_name: string
          handle: string
          id: string
          joined_at: string
          masked_email: string
          phone: string
          status: Database["public"]["Enums"]["account_status"]
        }[]
      }
      reseller_load_credits: {
        Args: { _amount: number; _customer_id: string; _reference?: string }
        Returns: string
      }
      reseller_subreseller_ledger: {
        Args: { _limit?: number; _user_id: string }
        Returns: {
          amount: number
          balance_after: number
          created_at: string
          direction: string
          id: string
          reason: string
          reference: string
          tx_id: string
        }[]
      }
      reset_ecosystem_test_data: {
        Args: { _dry_run?: boolean; _ecosystem_id: string; _reason: string }
        Returns: Json
      }
      resolve_cash_in_reference_conflict: {
        Args: { _id: string; _note?: string }
        Returns: {
          created_at: string
          credited_at: string | null
          credited_first: string | null
          ecosystem_id: string | null
          id: string
          new_request_id: string
          new_snapshot: Json
          old_request_id: string | null
          old_snapshot: Json
          reference: string | null
          reference_key: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_in_reference_conflicts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_member_shop: {
        Args: { _ecosystem_id?: string; _user_id: string }
        Returns: string
      }
      resolve_voucher_tracer: { Args: { _id: string }; Returns: Json }
      respond_friend_request: {
        Args: { _accept: boolean; _id: string }
        Returns: undefined
      }
      respond_to_shop_invitation: {
        Args: { _accept: boolean; _invitation_id: string }
        Returns: undefined
      }
      restore_ui_layout: { Args: { _audit_id: string }; Returns: Json }
      restructure_member_role: {
        Args: {
          _child_reassignments?: Json
          _ecosystem_id?: string
          _new_role: Database["public"]["Enums"]["app_role"]
          _parent_reseller_id?: string
          _reason: string
          _user_id: string
        }
        Returns: Json
      }
      retail_assert_cart_items: { Args: { _items: Json }; Returns: undefined }
      retail_cashback_recipient: {
        Args: { _buyer: string; _ecosystem_id: string; _seller: string }
        Returns: string
      }
      retail_checkout_quote: {
        Args: {
          _ecosystem_id: string
          _items: Json
          _payment_method?: string
          _seller_id?: string
        }
        Returns: {
          buyer_charge: number
          self_cashback: number
          self_purchase: boolean
          total: number
        }[]
      }
      retail_cod_assign: {
        Args: {
          _collector_id: string
          _delivery_person_id: string
          _order_id: string
          _self_delivery: boolean
        }
        Returns: undefined
      }
      retail_cod_assignees: {
        Args: { _order_id: string }
        Returns: {
          avatar_path: string
          collector_eligible: boolean
          full_name: string
          handle: string
          user_id: string
        }[]
      }
      retail_cod_cancel_internal: {
        Args: {
          _actor: string
          _kind: string
          _note: string
          _order_id: string
        }
        Returns: undefined
      }
      retail_cod_cash_received: {
        Args: { _actual_cash: number; _order_id: string }
        Returns: undefined
      }
      retail_cod_collector_respond: {
        Args: { _accept: boolean; _order_id: string }
        Returns: undefined
      }
      retail_cod_fallback_days: { Args: never; Returns: number }
      retail_cod_held_total: { Args: never; Returns: number }
      retail_cod_manager: {
        Args: {
          _o: Database["public"]["Tables"]["retail_orders"]["Row"]
          _uid: string
        }
        Returns: boolean
      }
      retail_cod_quote: {
        Args: { _ecosystem_id: string; _seller_total: number }
        Returns: {
          available: boolean
          customer_total: number
          delivery_fee: number
          platform_fee: number
          reason: string
        }[]
      }
      retail_cod_resolve_discrepancy: {
        Args: { _action: string; _note?: string; _order_id: string }
        Returns: undefined
      }
      retail_cod_seller_cancel: {
        Args: { _note?: string; _order_id: string }
        Returns: undefined
      }
      retail_cod_seller_funded: {
        Args: { _ecosystem_id: string; _fee: number }
        Returns: boolean
      }
      retail_cod_seller_release: {
        Args: { _order_id: string }
        Returns: undefined
      }
      retail_cod_settle: {
        Args: {
          _actor: string
          _actual: number
          _kind: string
          _order_id: string
        }
        Returns: undefined
      }
      retail_fulfillment_step_ok: {
        Args: { _from: string; _fulfillment: string; _to: string }
        Returns: boolean
      }
      retail_image_visible: { Args: { _name: string }; Returns: boolean }
      retail_is_self_purchase: {
        Args: {
          _buyer: string
          _ecosystem_id: string
          _payment_method: string
          _seller: string
        }
        Returns: boolean
      }
      retail_line_cashback: {
        Args: {
          _mode: string
          _qty: number
          _seller_line: number
          _value: number
        }
        Returns: number
      }
      retail_my_cod_assignments: {
        Args: never
        Returns: {
          actual_cash: number
          cash_received_at: string
          chat_thread_id: string
          collector_status: string
          completed_at: string
          created_at: string
          customer_name: string
          delivery_address: string
          delivery_fee: number
          delivery_notes: string
          discrepancy: boolean
          expected_cash: number
          fulfillment_status: string
          hold_held: boolean
          id: string
          my_role: string
          my_share: number
          order_no: string
          self_delivery: boolean
          settled_at: string
          shop_name: string
          status: string
          total: number
        }[]
      }
      retail_order_chat: { Args: { _order_id: string }; Returns: string }
      retail_peso: { Args: { _amount: number }; Returns: string }
      retail_place_order: {
        Args: {
          _address?: string
          _client_ref?: string
          _ecosystem_id: string
          _fulfillment: string
          _items: Json
          _notes?: string
          _payment_method: string
          _seller_id?: string
        }
        Returns: {
          order_id: string
          order_no: string
          total: number
        }[]
      }
      retail_platform_fee_percent: { Args: never; Returns: number }
      retail_refund_hold: {
        Args: {
          _actor: string
          _order: Database["public"]["Tables"]["retail_orders"]["Row"]
        }
        Returns: string
      }
      retail_review_order: {
        Args: { _approve: boolean; _note?: string; _order_id: string }
        Returns: undefined
      }
      retail_seller_allowed: {
        Args: { _ecosystem_id: string; _seller: string }
        Returns: boolean
      }
      retail_settlement_recipient: {
        Args: { _ecosystem_id: string }
        Returns: string
      }
      retail_sync_order_chat: { Args: { _order_id: string }; Returns: string }
      retail_update_fulfillment: {
        Args: { _next: string; _order_id: string }
        Returns: undefined
      }
      retail_wallet_for: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: string
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
      review_admin_cash_in: {
        Args: { _action: string; _id: string; _reason?: string }
        Returns: {
          amount_php: number
          approval_method: string
          authentication_checked_at: string | null
          authentication_reason: string | null
          auto_match_note: string | null
          created_at: string
          credits: number
          decision_reason: string | null
          duplicate_of: string | null
          duplicate_receipt: boolean
          duplicate_receipt_of: string | null
          duplicate_reference: boolean
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          funding_account_id: string | null
          funding_admin_id: string | null
          funding_ledger_id: string | null
          funding_source: string
          id: string
          ledger_id: string | null
          listener_event_id: string | null
          method_details: Json
          method_id: string | null
          method_name: string
          method_type: string
          net_php: number | null
          notes: string | null
          ocr_amount_php: number | null
          ocr_details: Json | null
          ocr_paid_at: string | null
          ocr_reference: string | null
          ocr_reference_key: string | null
          ocr_sender_number: string | null
          ocr_sender_number_key: string | null
          paid_at: string | null
          paid_at_edited: boolean
          payer_number: string | null
          payer_number_key: string | null
          payer_reference: string | null
          payer_reference_key: string | null
          payment_authenticated: boolean
          proof_hash: string | null
          proof_path: string | null
          provider_id: string | null
          provider_source: string | null
          rate_credits: number
          rate_php: number
          receipt_amount_php: number | null
          receipt_check: string
          receipt_checked_at: string | null
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_account_masked: string | null
          receipt_receiving_number: string | null
          receipt_receiving_number_key: string | null
          receipt_reference: string | null
          receipt_reference_key: string | null
          receipt_sender_account_masked: string | null
          receipt_sender_name: string | null
          receipt_sender_number: string | null
          receipt_sender_number_key: string | null
          receipt_verified: boolean
          reference: string
          reference_edited: boolean
          reference_source: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          sender_number: string | null
          sender_number_key: string | null
          staged_at: string | null
          staged_result: string | null
          status: string
          updated_at: string
          user_id: string
          verified_payment_id: string | null
          wallet_scope: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_in_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_admin_cashout: {
        Args: { _action: string; _id: string; _reason?: string }
        Returns: {
          account_id: string | null
          account_name: string | null
          account_number: string | null
          admin_id: string | null
          cashout_path: string
          created_at: string
          credits: number
          decision_reason: string | null
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          gross_php: number
          id: string
          net_php: number
          notes: string | null
          payment_mode: string
          rate_credits: number
          rate_php: number
          reference: string
          refund_ledger_id: string | null
          released_at: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reserve_ledger_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          settlement_ledger_id: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_scope: string
        }
        SetofOptions: {
          from: "*"
          to: "withdrawal_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_auto_approved_payment: {
        Args: { _decision: string; _reason?: string; _request_id: string }
        Returns: string
      }
      review_cash_in: {
        Args: { _action: string; _id: string; _reason?: string }
        Returns: {
          amount_php: number
          approval_method: string
          authentication_checked_at: string | null
          authentication_reason: string | null
          auto_match_note: string | null
          created_at: string
          credits: number
          decision_reason: string | null
          duplicate_of: string | null
          duplicate_receipt: boolean
          duplicate_receipt_of: string | null
          duplicate_reference: boolean
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          funding_account_id: string | null
          funding_admin_id: string | null
          funding_ledger_id: string | null
          funding_source: string
          id: string
          ledger_id: string | null
          listener_event_id: string | null
          method_details: Json
          method_id: string | null
          method_name: string
          method_type: string
          net_php: number | null
          notes: string | null
          ocr_amount_php: number | null
          ocr_details: Json | null
          ocr_paid_at: string | null
          ocr_reference: string | null
          ocr_reference_key: string | null
          ocr_sender_number: string | null
          ocr_sender_number_key: string | null
          paid_at: string | null
          paid_at_edited: boolean
          payer_number: string | null
          payer_number_key: string | null
          payer_reference: string | null
          payer_reference_key: string | null
          payment_authenticated: boolean
          proof_hash: string | null
          proof_path: string | null
          provider_id: string | null
          provider_source: string | null
          rate_credits: number
          rate_php: number
          receipt_amount_php: number | null
          receipt_check: string
          receipt_checked_at: string | null
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_account_masked: string | null
          receipt_receiving_number: string | null
          receipt_receiving_number_key: string | null
          receipt_reference: string | null
          receipt_reference_key: string | null
          receipt_sender_account_masked: string | null
          receipt_sender_name: string | null
          receipt_sender_number: string | null
          receipt_sender_number_key: string | null
          receipt_verified: boolean
          reference: string
          reference_edited: boolean
          reference_source: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          sender_number: string | null
          sender_number_key: string | null
          staged_at: string | null
          staged_result: string | null
          status: string
          updated_at: string
          user_id: string
          verified_payment_id: string | null
          wallet_scope: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_in_requests"
          isOneToOne: true
          isSetofReturn: false
        }
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
          auto_reason: string | null
          auto_state: string
          billing_period: string
          created_at: string
          currency: string
          decision_reason: string | null
          ecosystem_id: string
          entitlement_hold: boolean
          id: string
          listener_event_id: string | null
          monthly_rate: number | null
          months_purchased: number | null
          payer_number: string | null
          payer_number_key: string | null
          payer_reference_key: string | null
          payment_method_id: string | null
          payment_method_name: string | null
          payment_override: boolean
          payment_override_at: string | null
          payment_override_by: string | null
          payment_override_reason: string | null
          payment_reference: string
          period_end: string | null
          period_start: string | null
          plan_id: string | null
          plan_name: string
          plan_price: number
          previous_period_end: string | null
          proof_path: string | null
          purpose: string
          receipt_amount_php: number | null
          receipt_check: string
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_key: string | null
          receipt_reference_key: string | null
          receipt_sender_key: string | null
          remainder_amount: number
          requested_by: string | null
          requested_by_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          super_review_reason: string | null
          super_review_state: string
          super_reviewed_at: string | null
          super_reviewed_by: string | null
          super_reviewed_by_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "subscription_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_withdrawal: {
        Args: { _action: string; _id: string; _reason?: string }
        Returns: {
          account_id: string | null
          account_name: string | null
          account_number: string | null
          admin_id: string | null
          cashout_path: string
          created_at: string
          credits: number
          decision_reason: string | null
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          gross_php: number
          id: string
          net_php: number
          notes: string | null
          payment_mode: string
          rate_credits: number
          rate_php: number
          reference: string
          refund_ledger_id: string | null
          released_at: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reserve_ledger_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          settlement_ledger_id: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_scope: string
        }
        SetofOptions: {
          from: "*"
          to: "withdrawal_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_admin_invitation: { Args: { _id: string }; Returns: undefined }
      revoke_listener_device: {
        Args: { _device: string }
        Returns: {
          app_version: string | null
          created_at: string
          created_by: string | null
          ecosystem_id: string | null
          id: string
          label: string
          last_event_at: string | null
          last_received_at: string | null
          last_seen_at: string | null
          listener_connected: boolean | null
          listener_state_at: string | null
          match_window_minutes: number
          notification_access: boolean | null
          offline_after_minutes: number
          owner_role: string
          package_name: string
          received_count: number
          receiving_number: string | null
          receiving_number_key: string | null
          revoked_at: string | null
          revoked_by: string | null
          secret_key_hash: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "listener_devices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
      run_subscription_expiry: {
        Args: { _dry?: boolean }
        Returns: {
          expired: number
          reviews_frozen: number
          warned: number
        }[]
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
      search_universe_members: {
        Args: { _ecosystem_id: string; _limit?: number; _q: string }
        Returns: {
          already_member: boolean
          avatar_path: string
          full_name: string
          handle: string
          masked_email: string
          pending_application: boolean
          pending_invitation: boolean
          phone: string
          user_id: string
        }[]
      }
      seed_retail_catalog: { Args: { _ecosystem_id: string }; Returns: number }
      seed_seller_authorizations: {
        Args: { _ecosystem_id: string }
        Returns: number
      }
      seller_storefront: {
        Args: { _handle: string }
        Returns: {
          available: number
          avatar_path: string
          credits_per_point: number
          description: string
          points_price: number
          price: number
          product_id: string
          product_name: string
          seller_handle: string
          seller_id: string
          seller_name: string
          shop_id: string
          shop_name: string
          shop_slug: string
          store_name: string
        }[]
      }
      seller_storefront_retail: {
        Args: { _handle: string }
        Returns: {
          accepting_orders: boolean
          avatar_path: string
          logo_path: string
          product_count: number
          seller_handle: string
          seller_id: string
          seller_name: string
          shop_description: string
          shop_id: string
          shop_name: string
          shop_slug: string
          store_name: string
        }[]
      }
      send_friend_request: { Args: { _user: string }; Returns: string }
      send_test_notification: { Args: never; Returns: string }
      set_admin_sale_commission: {
        Args: { _ecosystem_id: string; _percent: number }
        Returns: number
      }
      set_cash_in_auth_fields: {
        Args: {
          _ecosystem: string
          _layer1_sender?: boolean
          _layer1_time?: boolean
          _layer2_amount?: boolean
          _layer2_listener_reference?: boolean
          _layer2_sender?: boolean
          _require_receipt?: boolean
        }
        Returns: {
          amount_tolerance_php: number
          ecosystem_id: string | null
          enabled: boolean
          expected_amount_php: number | null
          id: string
          layer1_require_amount: boolean
          layer1_require_sender_number: boolean
          layer1_require_time_window: boolean
          layer2_require_amount_match: boolean
          layer2_require_listener_reference: boolean
          layer2_require_sender_match: boolean
          max_auto_amount_php: number | null
          require_listener_match: boolean
          require_receipt_match: boolean
          require_reference_match: boolean
          updated_at: string
          updated_by: string | null
          verification_mode: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_in_auto_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_cash_in_auto_approval: {
        Args: {
          _ecosystem: string
          _enabled: boolean
          _expected_amount?: number
          _max_amount?: number
          _require_listener?: boolean
          _require_receipt?: boolean
          _require_reference?: boolean
          _tolerance?: number
          _verification_mode?: string
        }
        Returns: {
          amount_tolerance_php: number
          ecosystem_id: string | null
          enabled: boolean
          expected_amount_php: number | null
          id: string
          layer1_require_amount: boolean
          layer1_require_sender_number: boolean
          layer1_require_time_window: boolean
          layer2_require_amount_match: boolean
          layer2_require_listener_reference: boolean
          layer2_require_sender_match: boolean
          max_auto_amount_php: number | null
          require_listener_match: boolean
          require_receipt_match: boolean
          require_reference_match: boolean
          updated_at: string
          updated_by: string | null
          verification_mode: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_in_auto_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_ecosystem_cash_in_number: {
        Args: { _ecosystem: string; _number: string }
        Returns: string
      }
      set_ecosystem_commission: {
        Args: { _ecosystem_id: string; _percent: number }
        Returns: number
      }
      set_ecosystem_facebook: {
        Args: { _ecosystem_id: string; _page_name?: string; _url?: string }
        Returns: {
          admin_assigned_at: string | null
          admin_assigned_by: string | null
          admin_sale_commission_percent: number
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          cash_in_gcash_number: string | null
          contact_email: string | null
          contact_name: string | null
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
          is_review: boolean
          is_test: boolean
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          public_storefront_enabled: boolean
          retail_accepting_orders: boolean
          retail_cash_enabled: boolean
          retail_cod_enabled: boolean
          retail_cover_path: string | null
          retail_credit_enabled: boolean
          retail_delivery_enabled: boolean
          retail_delivery_fee: number
          retail_delivery_split_collector_pct: number
          retail_delivery_split_delivery_pct: number
          retail_logo_path: string | null
          retail_paused_note: string | null
          retail_pickup_enabled: boolean
          retail_storefront_theme: string
          review_ends_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_barangay: string | null
          shop_city_municipality: string | null
          shop_code: string | null
          shop_kind: string
          shop_province: string | null
          shop_street: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          store_retail_enabled: boolean
          store_voucher_enabled: boolean
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
          use_platform_payment_methods: boolean
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
          admin_assigned_at: string | null
          admin_assigned_by: string | null
          admin_sale_commission_percent: number
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          cash_in_gcash_number: string | null
          contact_email: string | null
          contact_name: string | null
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
          is_review: boolean
          is_test: boolean
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          public_storefront_enabled: boolean
          retail_accepting_orders: boolean
          retail_cash_enabled: boolean
          retail_cod_enabled: boolean
          retail_cover_path: string | null
          retail_credit_enabled: boolean
          retail_delivery_enabled: boolean
          retail_delivery_fee: number
          retail_delivery_split_collector_pct: number
          retail_delivery_split_delivery_pct: number
          retail_logo_path: string | null
          retail_paused_note: string | null
          retail_pickup_enabled: boolean
          retail_storefront_theme: string
          review_ends_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_barangay: string | null
          shop_city_municipality: string | null
          shop_code: string | null
          shop_kind: string
          shop_province: string | null
          shop_street: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          store_retail_enabled: boolean
          store_voucher_enabled: boolean
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
          use_platform_payment_methods: boolean
        }
        SetofOptions: {
          from: "*"
          to: "ecosystems"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_ecosystem_platform_payment_methods: {
        Args: { _ecosystem: string; _enabled: boolean }
        Returns: boolean
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
          admin_assigned_at: string | null
          admin_assigned_by: string | null
          admin_sale_commission_percent: number
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          cash_in_gcash_number: string | null
          contact_email: string | null
          contact_name: string | null
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
          is_review: boolean
          is_test: boolean
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          public_storefront_enabled: boolean
          retail_accepting_orders: boolean
          retail_cash_enabled: boolean
          retail_cod_enabled: boolean
          retail_cover_path: string | null
          retail_credit_enabled: boolean
          retail_delivery_enabled: boolean
          retail_delivery_fee: number
          retail_delivery_split_collector_pct: number
          retail_delivery_split_delivery_pct: number
          retail_logo_path: string | null
          retail_paused_note: string | null
          retail_pickup_enabled: boolean
          retail_storefront_theme: string
          review_ends_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_barangay: string | null
          shop_city_municipality: string | null
          shop_code: string | null
          shop_kind: string
          shop_province: string | null
          shop_street: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          store_retail_enabled: boolean
          store_voucher_enabled: boolean
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
          use_platform_payment_methods: boolean
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
      set_listener_source_rule: {
        Args: {
          _device?: string
          _ecosystem?: string
          _mode: string
          _note?: string
          _package: string
        }
        Returns: Json
      }
      set_login_username: {
        Args: { _target: string; _username: string }
        Returns: string
      }
      set_member_cashback_rate: {
        Args: {
          _ecosystem_id: string
          _percent: number
          _reason?: string
          _user_id: string
        }
        Returns: number
      }
      set_member_status: {
        Args: {
          _status: Database["public"]["Enums"]["account_status"]
          _user_id: string
        }
        Returns: undefined
      }
      set_notification_preferences:
        | {
            Args: { _disabled_kinds: string[]; _push_enabled: boolean }
            Returns: undefined
          }
        | {
            Args: {
              _disabled_kinds: string[]
              _push_enabled: boolean
              _push_show_details: boolean
            }
            Returns: undefined
          }
      set_platform_money_settings: {
        Args: {
          _cash_in_fee?: number
          _cashback_reseller: number
          _cashback_subreseller: number
          _credits_per_unit: number
          _php_per_unit: number
          _retail_fee?: number
          _shop_transfer_fee?: number
          _voucher_fee?: number
          _withdrawal_fee: number
        }
        Returns: {
          admin_credit_discount_percent: number
          admin_voucher_discount_percent: number
          billing_period: string
          cash_in_fee_percent: number
          cash_out_credits_per_unit: number
          cash_out_php_per_unit: number
          cashback_reseller_percent: number
          cashback_subreseller_percent: number
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
          member_invitation_expiry_days: number
          payment_instructions: string
          plan_name: string
          plan_price: number
          retail_platform_fee_percent: number
          shop_transfer_fee_credits: number
          support_message: string
          support_page_name: string
          support_page_url: string
          updated_at: string
          updated_by: string | null
          voucher_platform_fee_percent: number
          withdrawal_fee_percent: number
        }
        SetofOptions: {
          from: "*"
          to: "platform_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_points_rule: {
        Args: { _credits_per_point: number; _ecosystem_id: string }
        Returns: number
      }
      set_push_device_enabled: {
        Args: { _enabled: boolean; _id: string }
        Returns: undefined
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
      set_shop_address: {
        Args: {
          _barangay?: string
          _city_municipality?: string
          _ecosystem_id: string
          _province?: string
          _street?: string
        }
        Returns: undefined
      }
      set_shop_type: {
        Args: { _ecosystem_id: string; _shop_type: string }
        Returns: string
      }
      set_subreseller_parent: {
        Args: { _ecosystem_id?: string; _reseller_id: string; _user_id: string }
        Returns: undefined
      }
      set_ui_layout: {
        Args: {
          _action?: string
          _ecosystem_id?: string
          _payload: Json
          _role: Database["public"]["Enums"]["app_role"]
          _target_id?: string
          _target_kind?: string
          _target_label?: string
        }
        Returns: Json
      }
      set_voucher_tracer: {
        Args: {
          _device_mac: string
          _ecosystem_id: string
          _tracer: string
          _voucher_code: string
        }
        Returns: Json
      }
      settle_cash_in_approval: {
        Args: {
          _actor: string
          _actor_name: string
          _approval_method: string
          _id: string
          _note?: string
          _payment?: string
          _reason?: string
        }
        Returns: {
          amount_php: number
          approval_method: string
          authentication_checked_at: string | null
          authentication_reason: string | null
          auto_match_note: string | null
          created_at: string
          credits: number
          decision_reason: string | null
          duplicate_of: string | null
          duplicate_receipt: boolean
          duplicate_receipt_of: string | null
          duplicate_reference: boolean
          ecosystem_id: string | null
          fee_percent: number
          fee_php: number
          funding_account_id: string | null
          funding_admin_id: string | null
          funding_ledger_id: string | null
          funding_source: string
          id: string
          ledger_id: string | null
          listener_event_id: string | null
          method_details: Json
          method_id: string | null
          method_name: string
          method_type: string
          net_php: number | null
          notes: string | null
          ocr_amount_php: number | null
          ocr_details: Json | null
          ocr_paid_at: string | null
          ocr_reference: string | null
          ocr_reference_key: string | null
          ocr_sender_number: string | null
          ocr_sender_number_key: string | null
          paid_at: string | null
          paid_at_edited: boolean
          payer_number: string | null
          payer_number_key: string | null
          payer_reference: string | null
          payer_reference_key: string | null
          payment_authenticated: boolean
          proof_hash: string | null
          proof_path: string | null
          provider_id: string | null
          provider_source: string | null
          rate_credits: number
          rate_php: number
          receipt_amount_php: number | null
          receipt_check: string
          receipt_checked_at: string | null
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_account_masked: string | null
          receipt_receiving_number: string | null
          receipt_receiving_number_key: string | null
          receipt_reference: string | null
          receipt_reference_key: string | null
          receipt_sender_account_masked: string | null
          receipt_sender_name: string | null
          receipt_sender_number: string | null
          receipt_sender_number_key: string | null
          receipt_verified: boolean
          reference: string
          reference_edited: boolean
          reference_source: string | null
          request_key: string | null
          requester_name: string
          requester_role: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_name: string | null
          sender_number: string | null
          sender_number_key: string | null
          staged_at: string | null
          staged_result: string | null
          status: string
          updated_at: string
          user_id: string
          verified_payment_id: string | null
          wallet_scope: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_in_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shop_deletion_check: { Args: { _ecosystem_id: string }; Returns: Json }
      shop_deletion_check_unchecked: {
        Args: { _ecosystem_id: string }
        Returns: Json
      }
      shop_discovery_municipalities: {
        Args: never
        Returns: {
          city_municipality: string
          province: string
          shop_count: number
        }[]
      }
      shop_effective_location: {
        Args: { _ecosystem_id: string }
        Returns: {
          city_municipality: string
          province: string
        }[]
      }
      shop_funding_admin: { Args: { _ecosystem: string }; Returns: string }
      shop_member_wallets: {
        Args: { _ecosystem_id: string }
        Returns: {
          balance: number
          is_global: boolean
          user_id: string
        }[]
      }
      shop_members: {
        Args: { _ecosystem_id: string }
        Returns: {
          avatar_path: string
          deleted_at: string
          email: string
          full_name: string
          handle: string
          id: string
          joined_at: string
          membership_state: string
          phone: string
          reseller_commission_percent: number
          reseller_discount_percent: number
          reseller_id: string
          role: string
          sale_commission_percent: number
          status: string
        }[]
      }
      shop_store_settings: {
        Args: { _ecosystem_id: string }
        Returns: {
          accepting_orders: boolean
          cash_enabled: boolean
          cod_enabled: boolean
          collector_pct: number
          contact_email: string
          cover_path: string
          credit_enabled: boolean
          delivery_enabled: boolean
          delivery_fee: number
          delivery_pct: number
          logo_path: string
          paused_note: string
          pickup_enabled: boolean
          public_storefront: boolean
          retail_enabled: boolean
          storefront_theme: string
          voucher_enabled: boolean
        }[]
      }
      shop_subscription_history: {
        Args: { _ecosystem_id: string }
        Returns: {
          actor_name: string
          amount_php: number
          coins: number
          detail: string
          event_type: string
          id: string
          new_plan_name: string
          occurred_at: string
          period_end: string
          period_start: string
          previous_plan_name: string
          reference: string
          source: string
        }[]
      }
      shop_type: { Args: { _ecosystem_id: string }; Returns: string }
      shops_in_municipality: {
        Args: { _city: string; _province: string }
        Returns: {
          city_municipality: string
          id: string
          name: string
          province: string
          shop_code: string
        }[]
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
      social_clean_post_meta: { Args: { _meta: Json }; Returns: Json }
      social_create_comment: {
        Args: { _body: string; _parent_id?: string; _post_id: string }
        Returns: Json
      }
      social_create_post: {
        Args: {
          _audience?: string
          _body: string
          _currency?: string
          _image_path?: string
          _meta?: Json
          _promote?: boolean
          _shop_ids?: string[]
          _tier_id?: string
          _video_path?: string
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
      social_extract_hashtags: { Args: { _body: string }; Returns: string[] }
      social_feed: {
        Args: { _before?: string; _hashtag?: string; _limit?: number }
        Returns: {
          audience: string
          author_avatar: string
          author_handle: string
          author_id: string
          author_name: string
          author_role: string
          body: string
          can_delete: boolean
          can_hide: boolean
          comment_count: number
          created_at: string
          hashtags: string[]
          id: string
          image_path: string
          like_count: number
          liked_by_me: boolean
          meta: Json
          origin_ecosystem_name: string
          promoted: boolean
          promotion_expires_at: string
          promotion_tier_name: string
          video_path: string
        }[]
      }
      social_free_posts_used: { Args: { _user: string }; Returns: number }
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
      social_gift_audit: {
        Args: { _limit?: number }
        Returns: {
          amount: number
          created_at: string
          post_id: string
          recipient_name: string
          sender_balance_after: number
          sender_name: string
        }[]
      }
      social_gift_credits: {
        Args: { _amount: number; _note?: string; _post_id: string }
        Returns: Json
      }
      social_handle_search: {
        Args: { _limit?: number; _q: string }
        Returns: {
          avatar_path: string
          full_name: string
          handle: string
          user_id: string
        }[]
      }
      social_hidden_posts: {
        Args: { _eco?: string }
        Returns: {
          author_avatar: string
          author_handle: string
          author_name: string
          body: string
          ecosystem_id: string
          hidden_at: string
          hidden_by_name: string
          image_path: string
          post_created_at: string
          post_id: string
          reason: string
        }[]
      }
      social_hide_post_for_shop: {
        Args: {
          _eco?: string
          _hidden: boolean
          _post_id: string
          _reason?: string
        }
        Returns: Json
      }
      social_link_cards: {
        Args: { _links: Json }
        Returns: {
          available: number
          cover_path: string
          image_path: string
          kind: string
          logo_path: string
          price: number
          product_id: string
          product_kind: string
          product_name: string
          shop_id: string
          shop_name: string
          shop_slug: string
          shop_type: string
        }[]
      }
      social_link_visible: { Args: { _link: Json }; Returns: boolean }
      social_media_visible: {
        Args: { _name: string; _user: string }
        Returns: boolean
      }
      social_member_shops: { Args: { _user: string }; Returns: string[] }
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
      social_my_credit_history: {
        Args: { _limit?: number }
        Returns: {
          amount: number
          balance_after: number
          created_at: string
          direction: string
          reason: string
          source: string
        }[]
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
          depth: number
          id: string
          parent_id: string
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
      social_post_visible_to: {
        Args: { _post_id: string; _user: string }
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
      social_target_shops: {
        Args: never
        Returns: {
          ecosystem_id: string
          ecosystem_name: string
          is_current: boolean
        }[]
      }
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
          ecosystem_id: string | null
          free_balance: number
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
      spending_auto_entries: {
        Args: { _ecosystem: string; _from: string; _to: string }
        Returns: {
          amount: number
          auto_key: string
          description: string
          id: string
          kind: string
          member_id: string
          member_name: string
          occurred_at: string
        }[]
      }
      spending_delete_income: { Args: { _id: string }; Returns: boolean }
      spending_record_expense: {
        Args: {
          _amount: number
          _category_id?: string
          _client_ref?: string
          _description: string
          _ecosystem: string
          _notes?: string
          _spent_at?: string
        }
        Returns: {
          amount: number
          category: string | null
          category_id: string | null
          client_ref: string | null
          created_at: string
          created_by: string
          created_by_name: string | null
          currency: string
          description: string
          ecosystem_id: string | null
          id: string
          notes: string | null
          provider: string | null
          provider_reference: string | null
          scope: string
          spent_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      spending_record_income: {
        Args: {
          _amount: number
          _category_id?: string
          _client_ref?: string
          _description: string
          _ecosystem: string
          _notes?: string
          _occurred_at?: string
        }
        Returns: {
          amount: number
          category_id: string | null
          client_ref: string | null
          created_at: string
          created_by: string
          created_by_name: string | null
          description: string
          ecosystem_id: string
          id: string
          notes: string | null
          occurred_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "spending_income_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      spending_sync_categories: {
        Args: { _ecosystem: string }
        Returns: undefined
      }
      spending_update_expense: {
        Args: {
          _amount: number
          _category_id?: string
          _description: string
          _id: string
          _notes?: string
          _spent_at?: string
        }
        Returns: {
          amount: number
          category: string | null
          category_id: string | null
          client_ref: string | null
          created_at: string
          created_by: string
          created_by_name: string | null
          currency: string
          description: string
          ecosystem_id: string | null
          id: string
          notes: string | null
          provider: string | null
          provider_reference: string | null
          scope: string
          spent_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      spending_update_income: {
        Args: {
          _amount: number
          _category_id?: string
          _description: string
          _id: string
          _notes?: string
          _occurred_at?: string
        }
        Returns: {
          amount: number
          category_id: string | null
          client_ref: string | null
          created_at: string
          created_by: string
          created_by_name: string | null
          description: string
          ecosystem_id: string
          id: string
          notes: string | null
          occurred_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "spending_income_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_impersonation: {
        Args: { _reason?: string; _target: string }
        Returns: string
      }
      submit_go_live_payment: {
        Args: {
          _amount_paid?: number
          _ecosystem_id: string
          _months?: number
          _payer_number: string
          _payment_method_id?: string
          _plan_id: string
          _proof_path?: string
          _reference: string
        }
        Returns: {
          amount_due: number
          amount_paid: number | null
          auto_reason: string | null
          auto_state: string
          billing_period: string
          created_at: string
          currency: string
          decision_reason: string | null
          ecosystem_id: string
          entitlement_hold: boolean
          id: string
          listener_event_id: string | null
          monthly_rate: number | null
          months_purchased: number | null
          payer_number: string | null
          payer_number_key: string | null
          payer_reference_key: string | null
          payment_method_id: string | null
          payment_method_name: string | null
          payment_override: boolean
          payment_override_at: string | null
          payment_override_by: string | null
          payment_override_reason: string | null
          payment_reference: string
          period_end: string | null
          period_start: string | null
          plan_id: string | null
          plan_name: string
          plan_price: number
          previous_period_end: string | null
          proof_path: string | null
          purpose: string
          receipt_amount_php: number | null
          receipt_check: string
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_key: string | null
          receipt_reference_key: string | null
          receipt_sender_key: string | null
          remainder_amount: number
          requested_by: string | null
          requested_by_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          super_review_reason: string | null
          super_review_state: string
          super_reviewed_at: string | null
          super_reviewed_by: string | null
          super_reviewed_by_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "subscription_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_guide_question: {
        Args: { _contact?: string; _question: string }
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
          auto_reason: string | null
          auto_state: string
          billing_period: string
          created_at: string
          currency: string
          decision_reason: string | null
          ecosystem_id: string
          entitlement_hold: boolean
          id: string
          listener_event_id: string | null
          monthly_rate: number | null
          months_purchased: number | null
          payer_number: string | null
          payer_number_key: string | null
          payer_reference_key: string | null
          payment_method_id: string | null
          payment_method_name: string | null
          payment_override: boolean
          payment_override_at: string | null
          payment_override_by: string | null
          payment_override_reason: string | null
          payment_reference: string
          period_end: string | null
          period_start: string | null
          plan_id: string | null
          plan_name: string
          plan_price: number
          previous_period_end: string | null
          proof_path: string | null
          purpose: string
          receipt_amount_php: number | null
          receipt_check: string
          receipt_details: Json | null
          receipt_paid_at: string | null
          receipt_receiving_key: string | null
          receipt_reference_key: string | null
          receipt_sender_key: string | null
          remainder_amount: number
          requested_by: string | null
          requested_by_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          super_review_reason: string | null
          super_review_state: string
          super_reviewed_at: string | null
          super_reviewed_by: string | null
          super_reviewed_by_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "subscription_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      subscription_is_free: {
        Args: { _ecosystem_id: string }
        Returns: boolean
      }
      subscription_ok: { Args: { _ecosystem_id: string }; Returns: boolean }
      subscription_quote: {
        Args: { _ecosystem_id: string; _plan_id: string }
        Returns: {
          additional_allocation: number
          amount_due: number
          current_allocation: number
          current_monthly_price: number
          current_plan_id: string
          current_plan_name: string
          daily_value: number
          days_remaining: number
          is_first_activation: boolean
          new_allocation: number
          new_monthly_price: number
          new_plan_name: string
          unused_value: number
        }[]
      }
      super_admin_bootstrap_available: { Args: never; Returns: boolean }
      super_list_members: {
        Args: {
          _ecosystem_id?: string
          _limit?: number
          _offset?: number
          _query?: string
          _role?: string
        }
        Returns: {
          avatar_path: string
          credit_balance: number
          ecosystem_id: string
          ecosystem_name: string
          email: string
          full_name: string
          handle: string
          id: string
          joined_at: string
          phone: string
          points_balance: number
          role: string
          shop_count: number
          shops: string
          status: string
        }[]
      }
      super_member_accounts: {
        Args: { _user: string }
        Returns: {
          credit_balance: number
          ecosystem_id: string
          ecosystem_name: string
          membership_state: string
          points_balance: number
          role: string
        }[]
      }
      superadmin_assign_member_to_shop: {
        Args: { _ecosystem_id: string; _user: string }
        Returns: undefined
      }
      superadmin_delete_platform_user: {
        Args: { _override?: boolean; _reason?: string; _user: string }
        Returns: undefined
      }
      superadmin_issue_credits: {
        Args: {
          _amount: number
          _category?: string
          _ecosystem_id?: string
          _reason: string
          _reference?: string
          _request_key?: string
          _user_id: string
        }
        Returns: string
      }
      superadmin_set_shop_plan: {
        Args: {
          _discount_percent?: number
          _ecosystem_id: string
          _months?: number
          _paid_months?: number
          _plan_id: string
          _reason?: string
        }
        Returns: {
          allocation_total: number
          created_at: string
          demo_seed_credits: number
          ecosystem_id: string
          period_end: string | null
          period_start: string | null
          plan_id: string | null
          review_ends_at: string | null
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shop_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      switch_ecosystem: { Args: { _ecosystem_id: string }; Returns: string }
      sync_seller_authorization: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: undefined
      }
      system_import_voucher_codes: {
        Args: {
          _codes: string[]
          _ecosystem_id: string
          _product_id: string
          _source?: string
        }
        Returns: {
          batch_id: string
          duplicate_count: number
          imported_count: number
          invalid_count: number
        }[]
      }
      top_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      touch_member_presence: { Args: never; Returns: undefined }
      transfer_credits: {
        Args: { _amount: number; _note?: string; _recipient_id: string }
        Returns: string
      }
      transfer_credits_between_shops: {
        Args: {
          _amount: number
          _from_ecosystem_id: string
          _note?: string
          _to_ecosystem_id: string
        }
        Returns: {
          fee_credits: number
          net_credits: number
          tx_id: string
        }[]
      }
      transfer_credits_in_shop: {
        Args: {
          _amount: number
          _ecosystem_id: string
          _note?: string
          _recipient_id: string
        }
        Returns: string
      }
      transfer_reversal_info: { Args: { _tx_id: string }; Returns: Json }
      transfer_universe_coins: {
        Args: {
          _amount: number
          _client_key?: string
          _note?: string
          _recipient_id: string
        }
        Returns: string
      }
      try_auto_approve_cash_in: { Args: { _id: string }; Returns: string }
      unblock_listener_source: {
        Args: { _device?: string; _ecosystem?: string; _package: string }
        Returns: string
      }
      unique_handle: {
        Args: { _base: string; _exclude?: string }
        Returns: string
      }
      universe_directory: {
        Args: {
          _barangay?: string
          _city_municipality?: string
          _limit?: number
          _province?: string
          _query?: string
        }
        Returns: {
          avatar_path: string
          barangay: string
          city_municipality: string
          full_name: string
          handle: string
          id: string
          province: string
        }[]
      }
      universe_link_search: {
        Args: { _kind?: string; _limit?: number; _q?: string }
        Returns: {
          cover_path: string
          image_path: string
          kind: string
          logo_path: string
          price: number
          product_id: string
          product_kind: string
          product_name: string
          shop_id: string
          shop_name: string
          shop_slug: string
          shop_type: string
        }[]
      }
      universe_market_pulse: {
        Args: { _limit?: number }
        Returns: {
          commerce_kind: string
          cover_path: string
          image_path: string
          item_id: string
          item_name: string
          logo_path: string
          price: number
          rank: number
          rating_avg: number
          rating_count: number
          sales_count: number
          section: string
          shop_id: string
          shop_name: string
          shop_slug: string
        }[]
      }
      universe_marketplace_shops: {
        Args: never
        Returns: {
          admin_assigned_at: string | null
          admin_assigned_by: string | null
          admin_sale_commission_percent: number
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          cash_in_gcash_number: string | null
          contact_email: string | null
          contact_name: string | null
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
          is_review: boolean
          is_test: boolean
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          public_storefront_enabled: boolean
          retail_accepting_orders: boolean
          retail_cash_enabled: boolean
          retail_cod_enabled: boolean
          retail_cover_path: string | null
          retail_credit_enabled: boolean
          retail_delivery_enabled: boolean
          retail_delivery_fee: number
          retail_delivery_split_collector_pct: number
          retail_delivery_split_delivery_pct: number
          retail_logo_path: string | null
          retail_paused_note: string | null
          retail_pickup_enabled: boolean
          retail_storefront_theme: string
          review_ends_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_barangay: string | null
          shop_city_municipality: string | null
          shop_code: string | null
          shop_kind: string
          shop_province: string | null
          shop_street: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          store_retail_enabled: boolean
          store_voucher_enabled: boolean
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
          use_platform_payment_methods: boolean
        }[]
        SetofOptions: {
          from: "*"
          to: "ecosystems"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      universe_online_members: {
        Args: { _limit?: number }
        Returns: {
          avatar_path: string
          full_name: string
          handle: string
          id: string
          last_seen_at: string
          online: boolean
        }[]
      }
      universe_peso: { Args: { _n: number }; Returns: string }
      universe_product_categories: {
        Args: never
        Returns: {
          category: string
          product_count: number
        }[]
      }
      universe_product_feed: {
        Args: {
          _category?: string
          _limit?: number
          _offset?: number
          _section?: string
          _seed?: number
        }
        Returns: {
          available: number
          brand: string
          category: string
          created_at: string
          description: string
          id: string
          image_path: string
          is_new: boolean
          is_trending: boolean
          kind: string
          name: string
          price: number
          rating_avg: number
          rating_count: number
          score: number
          shop_id: string
          shop_logo_path: string
          shop_name: string
          shop_slug: string
          size_label: string
          sold_30d: number
          views_30d: number
        }[]
      }
      universe_profile: {
        Args: { _handle: string }
        Returns: {
          avatar_path: string
          bio: string
          cover_path: string
          full_name: string
          handle: string
          is_platform: boolean
          joined_at: string
          user_id: string
        }[]
      }
      universe_profile_posts: {
        Args: { _handle: string; _limit?: number }
        Returns: {
          audience: string
          body: string
          comment_count: number
          created_at: string
          id: string
          image_path: string
          like_count: number
        }[]
      }
      universe_purchase_debit: {
        Args: {
          _account: string
          _actor: string
          _buyer: string
          _ecosystem_id: string
          _entry_kind: string
          _gross: number
          _label: string
          _reference: string
          _sale_id: string
          _self_cashback: number
          _self_label: string
          _tx: string
        }
        Returns: string
      }
      universe_relationship: { Args: { _user: string }; Returns: Json }
      universe_relationship_batch: {
        Args: { _users: string[] }
        Returns: {
          following: boolean
          friend_request_id: string
          friend_status: string
          user_id: string
        }[]
      }
      universe_self_purchase_net: {
        Args: {
          _buyer: string
          _ecosystem_id: string
          _entitled_cashback: number
          _entitled_recipient: string
          _gross: number
          _payment_method: string
        }
        Returns: {
          buyer_charge: number
          self_cashback: number
          self_purchase: boolean
        }[]
      }
      universe_sellers_for_shop: {
        Args: { _slug: string }
        Returns: {
          avatar_path: string
          last_seen_at: string
          online: boolean
          seller_handle: string
          seller_id: string
          seller_name: string
          store_name: string
        }[]
      }
      universe_shop_search: {
        Args: { _limit?: number; _q?: string }
        Returns: {
          available: number
          price: number
          product_description: string
          product_id: string
          product_matches: boolean
          product_name: string
          shop_description: string
          shop_id: string
          shop_name: string
          shop_slug: string
        }[]
      }
      update_app_release: {
        Args: {
          _android_download_url: string
          _android_enabled: boolean
          _android_min_os: string
          _android_release_date: string
          _android_release_notes: string
          _android_sha256: string
          _android_size_bytes: number
          _android_version: string
        }
        Returns: {
          android_download_count: number
          android_download_url: string
          android_enabled: boolean
          android_min_os: string
          android_release_date: string | null
          android_release_notes: string
          android_sha256: string
          android_size_bytes: number
          android_version: string
          created_at: string
          id: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "app_release"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
              cash_in_fee_percent: number
              cash_out_credits_per_unit: number
              cash_out_php_per_unit: number
              cashback_reseller_percent: number
              cashback_subreseller_percent: number
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
              member_invitation_expiry_days: number
              payment_instructions: string
              plan_name: string
              plan_price: number
              retail_platform_fee_percent: number
              shop_transfer_fee_credits: number
              support_message: string
              support_page_name: string
              support_page_url: string
              updated_at: string
              updated_by: string | null
              voucher_platform_fee_percent: number
              withdrawal_fee_percent: number
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
              cash_in_fee_percent: number
              cash_out_credits_per_unit: number
              cash_out_php_per_unit: number
              cashback_reseller_percent: number
              cashback_subreseller_percent: number
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
              member_invitation_expiry_days: number
              payment_instructions: string
              plan_name: string
              plan_price: number
              retail_platform_fee_percent: number
              shop_transfer_fee_credits: number
              support_message: string
              support_page_name: string
              support_page_url: string
              updated_at: string
              updated_by: string | null
              voucher_platform_fee_percent: number
              withdrawal_fee_percent: number
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
          _contact_name?: string
          _contact_phone?: string
          _description?: string
          _ecosystem_id: string
          _name: string
          _signup_enabled?: boolean
        }
        Returns: {
          admin_assigned_at: string | null
          admin_assigned_by: string | null
          admin_sale_commission_percent: number
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          cash_in_gcash_number: string | null
          contact_email: string | null
          contact_name: string | null
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
          is_review: boolean
          is_test: boolean
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          public_storefront_enabled: boolean
          retail_accepting_orders: boolean
          retail_cash_enabled: boolean
          retail_cod_enabled: boolean
          retail_cover_path: string | null
          retail_credit_enabled: boolean
          retail_delivery_enabled: boolean
          retail_delivery_fee: number
          retail_delivery_split_collector_pct: number
          retail_delivery_split_delivery_pct: number
          retail_logo_path: string | null
          retail_paused_note: string | null
          retail_pickup_enabled: boolean
          retail_storefront_theme: string
          review_ends_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_barangay: string | null
          shop_city_municipality: string | null
          shop_code: string | null
          shop_kind: string
          shop_province: string | null
          shop_street: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          store_retail_enabled: boolean
          store_voucher_enabled: boolean
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
          use_platform_payment_methods: boolean
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
          admin_assigned_at: string | null
          admin_assigned_by: string | null
          admin_sale_commission_percent: number
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          cash_in_gcash_number: string | null
          contact_email: string | null
          contact_name: string | null
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
          is_review: boolean
          is_test: boolean
          last_activity_at: string | null
          name: string
          operations_frozen: boolean
          payment_reference: string | null
          plan_name: string
          plan_price: number
          points_rule_updated_at: string
          points_rule_version: number
          public_storefront_enabled: boolean
          retail_accepting_orders: boolean
          retail_cash_enabled: boolean
          retail_cod_enabled: boolean
          retail_cover_path: string | null
          retail_credit_enabled: boolean
          retail_delivery_enabled: boolean
          retail_delivery_fee: number
          retail_delivery_split_collector_pct: number
          retail_delivery_split_delivery_pct: number
          retail_logo_path: string | null
          retail_paused_note: string | null
          retail_pickup_enabled: boolean
          retail_storefront_theme: string
          review_ends_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_barangay: string | null
          shop_city_municipality: string | null
          shop_code: string | null
          shop_kind: string
          shop_province: string | null
          shop_street: string | null
          signup_enabled: boolean
          signup_token: string
          slug: string
          store_retail_enabled: boolean
          store_voucher_enabled: boolean
          submitted_at: string | null
          subscription_state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
          use_platform_payment_methods: boolean
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
          _barangay?: string
          _bio?: string
          _city_municipality?: string
          _clear_avatar?: boolean
          _full_name?: string
          _handle?: string
          _house_number?: string
          _preferences?: Json
          _province?: string
          _street?: string
        }
        Returns: Json
      }
      update_own_profile_cover: {
        Args: { _clear_cover?: boolean; _cover_path?: string }
        Returns: undefined
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
          cash_in_fee_percent: number
          cash_out_credits_per_unit: number
          cash_out_php_per_unit: number
          cashback_reseller_percent: number
          cashback_subreseller_percent: number
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
          member_invitation_expiry_days: number
          payment_instructions: string
          plan_name: string
          plan_price: number
          retail_platform_fee_percent: number
          shop_transfer_fee_credits: number
          support_message: string
          support_page_name: string
          support_page_url: string
          updated_at: string
          updated_by: string | null
          voucher_platform_fee_percent: number
          withdrawal_fee_percent: number
        }
        SetofOptions: {
          from: "*"
          to: "platform_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_retail_delivery_settings: {
        Args: {
          _cod_enabled: boolean
          _collector_pct: number
          _delivery_fee: number
          _delivery_pct: number
          _ecosystem_id: string
        }
        Returns: undefined
      }
      update_retail_storefront: {
        Args: {
          _accepting_orders?: boolean
          _clear_cover?: boolean
          _clear_logo?: boolean
          _cover_path?: string
          _ecosystem_id: string
          _logo_path?: string
          _paused_note?: string
          _theme?: string
        }
        Returns: undefined
      }
      update_social_settings:
        | {
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
              free_posts_per_day: number
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
        | {
            Args: {
              _ad_daily_limit: number
              _ad_provider?: string
              _ad_reward_amount: number
              _ads_enabled: boolean
              _allow_admin_overrides?: boolean
              _comment_cost: number
              _credit_exchange_rate: number
              _daily_allowance: number
              _free_posts_per_day?: number
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
              free_posts_per_day: number
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
      update_store_settings: {
        Args: {
          _cash_enabled: boolean
          _credit_enabled: boolean
          _delivery_enabled: boolean
          _ecosystem_id: string
          _pickup_enabled: boolean
          _public_storefront: boolean
          _retail_enabled: boolean
          _voucher_enabled: boolean
        }
        Returns: {
          cash_enabled: boolean
          credit_enabled: boolean
          delivery_enabled: boolean
          pickup_enabled: boolean
          public_storefront: boolean
          retail_enabled: boolean
          seeded: number
          voucher_enabled: boolean
        }[]
      }
      upline_commission_rate_for: {
        Args: { _ecosystem_id: string }
        Returns: number
      }
      upsert_payment_method: {
        Args: {
          _account_name?: string
          _account_number?: string
          _active?: boolean
          _ecosystem_id?: string
          _id?: string
          _instructions?: string
          _label?: string
          _metadata?: Json
          _method_type: string
          _name: string
          _notes?: string
          _provider_id?: string
          _qr_content?: string
          _qr_path?: string
          _sort_order?: number
        }
        Returns: {
          account_name: string | null
          account_number: string | null
          active: boolean
          created_at: string
          ecosystem_id: string | null
          id: string
          instructions: string
          label: string | null
          metadata: Json
          method_type: string
          name: string
          notes: string | null
          provider_id: string | null
          qr_content: string | null
          qr_path: string | null
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_methods"
          isOneToOne: true
          isSetofReturn: false
        }
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
      voucher_checkout_quote: {
        Args: { _product_id: string; _quantity?: number; _seller_id?: string }
        Returns: {
          buyer_charge: number
          cashback_percent: number
          self_cashback: number
          self_purchase: boolean
          total: number
        }[]
      }
      voucher_discount_percent_for:
        | { Args: { _user_id: string }; Returns: number }
        | { Args: { _ecosystem_id: string; _user_id: string }; Returns: number }
      voucher_platform_fee_amount: {
        Args: { _customer_price: number; _fee_percent: number }
        Returns: number
      }
      voucher_platform_fee_percent: { Args: never; Returns: number }
      voucher_price_from_seller_cut: {
        Args: { _fee_percent: number; _seller_cut: number }
        Returns: number
      }
      voucher_seller_cut: {
        Args: { _customer_price: number; _fee_percent: number }
        Returns: number
      }
      voucher_tracer_conflicts: {
        Args: { _ecosystem_id: string }
        Returns: {
          device_mac: string
          id: string
          is_primary: boolean
          recorded_at: string
          tracer: string
          voucher_code: string
        }[]
      }
      voucher_tracer_history: {
        Args: { _ecosystem_id: string; _voucher_code: string }
        Returns: {
          device_mac: string
          id: string
          in_conflict: boolean
          is_primary: boolean
          recorded_at: string
          tracer: string
          voucher_code: string
        }[]
      }
      wake_push_dispatcher: { Args: { _force?: boolean }; Returns: undefined }
      wallet_id_for: {
        Args: { _ecosystem_id: string; _user_id: string }
        Returns: string
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
      wallet_shop_recipients: {
        Args: { _ecosystem_id: string; _limit?: number; _search?: string }
        Returns: {
          avatar_path: string
          full_name: string
          handle: string
          id: string
          relation: string
          role: string
        }[]
      }
      wallet_upward_recipients: {
        Args: { _ecosystem_id: string }
        Returns: {
          avatar_path: string
          full_name: string
          handle: string
          id: string
          relation: string
        }[]
      }
      wallet_view: {
        Args: { _ecosystem_id?: string; _user_id: string }
        Returns: {
          account_id: string
          balance: number
          is_global: boolean
        }[]
      }
      ww_money: { Args: { _amount: number }; Returns: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
