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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      action_items: {
        Row: {
          assigned_to_email: string
          assigned_to_name: string
          case_id: string
          completed_at: string | null
          created_at: string
          created_by_name: string
          description: string
          dispatched_at: string | null
          due_date: string | null
          id: string
          is_replacement_pick: boolean
          is_warehouse_task: boolean
          picked_at: string | null
          picking_started_at: string | null
          priority: Database["public"]["Enums"]["case_priority"]
          shipstation_order_id: string | null
          shipstation_order_number: string | null
          status: Database["public"]["Enums"]["action_item_status"]
          warehouse_result: string | null
        }
        Insert: {
          assigned_to_email: string
          assigned_to_name: string
          case_id: string
          completed_at?: string | null
          created_at?: string
          created_by_name: string
          description: string
          dispatched_at?: string | null
          due_date?: string | null
          id?: string
          is_replacement_pick?: boolean
          is_warehouse_task?: boolean
          picked_at?: string | null
          picking_started_at?: string | null
          priority?: Database["public"]["Enums"]["case_priority"]
          shipstation_order_id?: string | null
          shipstation_order_number?: string | null
          status?: Database["public"]["Enums"]["action_item_status"]
          warehouse_result?: string | null
        }
        Update: {
          assigned_to_email?: string
          assigned_to_name?: string
          case_id?: string
          completed_at?: string | null
          created_at?: string
          created_by_name?: string
          description?: string
          dispatched_at?: string | null
          due_date?: string | null
          id?: string
          is_replacement_pick?: boolean
          is_warehouse_task?: boolean
          picked_at?: string | null
          picking_started_at?: string | null
          priority?: Database["public"]["Enums"]["case_priority"]
          shipstation_order_id?: string | null
          shipstation_order_number?: string | null
          status?: Database["public"]["Enums"]["action_item_status"]
          warehouse_result?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_items_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_attachments: {
        Row: {
          case_id: string
          file_name: string
          file_url: string
          id: string
          uploaded_at: string
        }
        Insert: {
          case_id: string
          file_name: string
          file_url: string
          id?: string
          uploaded_at?: string
        }
        Update: {
          case_id?: string
          file_name?: string
          file_url?: string
          id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_attachments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_updates: {
        Row: {
          author_name: string
          author_type: string
          case_id: string
          created_at: string
          id: string
          message: string
        }
        Insert: {
          author_name: string
          author_type: string
          case_id: string
          created_at?: string
          id?: string
          message: string
        }
        Update: {
          author_name?: string
          author_type?: string
          case_id?: string
          created_at?: string
          id?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_updates_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          ai_summary: string | null
          ai_summary_generated_at: string | null
          case_number: string
          cin7_order_number: string | null
          cin7_sale_id: string | null
          created_at: string
          customer_name: string | null
          customer_reference: string | null
          description: string | null
          error_origin: Database["public"]["Enums"]["error_origin"] | null
          id: string
          order_number: string | null
          priority: Database["public"]["Enums"]["case_priority"]
          product_name: string | null
          purchase_date: string | null
          replacement_carrier: string | null
          replacement_ship_date: string | null
          replacement_tracked_at: string | null
          replacement_tracking_number: string | null
          status: Database["public"]["Enums"]["case_status"]
          title: string
          type: Database["public"]["Enums"]["case_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_summary?: string | null
          ai_summary_generated_at?: string | null
          case_number: string
          cin7_order_number?: string | null
          cin7_sale_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_reference?: string | null
          description?: string | null
          error_origin?: Database["public"]["Enums"]["error_origin"] | null
          id?: string
          order_number?: string | null
          priority?: Database["public"]["Enums"]["case_priority"]
          product_name?: string | null
          purchase_date?: string | null
          replacement_carrier?: string | null
          replacement_ship_date?: string | null
          replacement_tracked_at?: string | null
          replacement_tracking_number?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          title: string
          type: Database["public"]["Enums"]["case_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_summary?: string | null
          ai_summary_generated_at?: string | null
          case_number?: string
          cin7_order_number?: string | null
          cin7_sale_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_reference?: string | null
          description?: string | null
          error_origin?: Database["public"]["Enums"]["error_origin"] | null
          id?: string
          order_number?: string | null
          priority?: Database["public"]["Enums"]["case_priority"]
          product_name?: string | null
          purchase_date?: string | null
          replacement_carrier?: string | null
          replacement_ship_date?: string | null
          replacement_tracked_at?: string | null
          replacement_tracking_number?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          title?: string
          type?: Database["public"]["Enums"]["case_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      manual_pick_requests: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          case_id: string
          city: string | null
          country: string | null
          created_at: string
          created_by_name: string
          customer_name: string | null
          id: string
          items: Json
          notes: string | null
          phone: string | null
          postcode: string | null
          state: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          case_id: string
          city?: string | null
          country?: string | null
          created_at?: string
          created_by_name: string
          customer_name?: string | null
          id?: string
          items?: Json
          notes?: string | null
          phone?: string | null
          postcode?: string | null
          state?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          case_id?: string
          city?: string | null
          country?: string | null
          created_at?: string
          created_by_name?: string
          customer_name?: string | null
          id?: string
          items?: Json
          notes?: string | null
          phone?: string | null
          postcode?: string | null
          state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_pick_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          avatar_colour: string
          created_at: string
          email: string
          id: string
          last_seen_at: string | null
          name: string
          role: Database["public"]["Enums"]["team_role"]
          status: Database["public"]["Enums"]["team_status"]
        }
        Insert: {
          avatar_colour?: string
          created_at?: string
          email: string
          id: string
          last_seen_at?: string | null
          name: string
          role?: Database["public"]["Enums"]["team_role"]
          status?: Database["public"]["Enums"]["team_status"]
        }
        Update: {
          avatar_colour?: string
          created_at?: string
          email?: string
          id?: string
          last_seen_at?: string | null
          name?: string
          role?: Database["public"]["Enums"]["team_role"]
          status?: Database["public"]["Enums"]["team_status"]
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["team_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_member: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      action_item_status: "todo" | "in_progress" | "done"
      case_priority: "normal" | "urgent"
      case_status:
        | "open"
        | "reviewing"
        | "awaiting_customer"
        | "resolution_sent"
        | "closed"
        | "actioned"
        | "in_hand"
      case_type:
        | "warranty_claim"
        | "order_error"
        | "complaint"
        | "general"
        | "freight_issue"
      error_origin: "order_entry" | "warehouse" | "unknown"
      team_role: "admin" | "staff" | "warehouse"
      team_status: "invited" | "active" | "deactivated"
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
      action_item_status: ["todo", "in_progress", "done"],
      case_priority: ["normal", "urgent"],
      case_status: [
        "open",
        "reviewing",
        "awaiting_customer",
        "resolution_sent",
        "closed",
        "actioned",
        "in_hand",
      ],
      case_type: [
        "warranty_claim",
        "order_error",
        "complaint",
        "general",
        "freight_issue",
      ],
      error_origin: ["order_entry", "warehouse", "unknown"],
      team_role: ["admin", "staff", "warehouse"],
      team_status: ["invited", "active", "deactivated"],
    },
  },
} as const
