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
      brands: {
        Row: {
          chat_enabled: boolean
          domain: string
          dymo_label_size: string
          id: string
          key: string
          logo_url: string | null
          name: string
          primary_colour: string
          support_email: string | null
          support_phone: string | null
        }
        Insert: {
          chat_enabled?: boolean
          domain: string
          dymo_label_size?: string
          id?: string
          key: string
          logo_url?: string | null
          name: string
          primary_colour?: string
          support_email?: string | null
          support_phone?: string | null
        }
        Update: {
          chat_enabled?: boolean
          domain?: string
          dymo_label_size?: string
          id?: string
          key?: string
          logo_url?: string | null
          name?: string
          primary_colour?: string
          support_email?: string | null
          support_phone?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      feedback: {
        Row: {
          brand_id: string
          comment: string | null
          created_at: string
          flagged_step: number | null
          id: string
          instruction_set_id: string
          rating: number | null
          resolved: boolean
          session_id: string
          type: Database["public"]["Enums"]["feedback_type"]
          variant_id: string | null
        }
        Insert: {
          brand_id: string
          comment?: string | null
          created_at?: string
          flagged_step?: number | null
          id?: string
          instruction_set_id: string
          rating?: number | null
          resolved?: boolean
          session_id: string
          type: Database["public"]["Enums"]["feedback_type"]
          variant_id?: string | null
        }
        Update: {
          brand_id?: string
          comment?: string | null
          created_at?: string
          flagged_step?: number | null
          id?: string
          instruction_set_id?: string
          rating?: number | null
          resolved?: boolean
          session_id?: string
          type?: Database["public"]["Enums"]["feedback_type"]
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_instruction_set_id_fkey"
            columns: ["instruction_set_id"]
            isOneToOne: false
            referencedRelation: "instruction_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "guide_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      guide_publications: {
        Row: {
          brand_id: string
          dymo_label_url: string | null
          id: string
          instruction_set_id: string
          published_at: string | null
          status: Database["public"]["Enums"]["publication_status"]
        }
        Insert: {
          brand_id: string
          dymo_label_url?: string | null
          id?: string
          instruction_set_id: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["publication_status"]
        }
        Update: {
          brand_id?: string
          dymo_label_url?: string | null
          id?: string
          instruction_set_id?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["publication_status"]
        }
        Relationships: [
          {
            foreignKeyName: "guide_publications_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guide_publications_instruction_set_id_fkey"
            columns: ["instruction_set_id"]
            isOneToOne: false
            referencedRelation: "instruction_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      guide_variants: {
        Row: {
          id: string
          instruction_set_id: string
          slug: string
          variant_label: string
        }
        Insert: {
          id?: string
          instruction_set_id: string
          slug: string
          variant_label: string
        }
        Update: {
          id?: string
          instruction_set_id?: string
          slug?: string
          variant_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "guide_variants_instruction_set_id_fkey"
            columns: ["instruction_set_id"]
            isOneToOne: false
            referencedRelation: "instruction_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      guide_vehicles: {
        Row: {
          id: string
          instruction_set_id: string
          make: string
          model: string
          year_from: number
          year_to: number
        }
        Insert: {
          id?: string
          instruction_set_id: string
          make: string
          model: string
          year_from: number
          year_to: number
        }
        Update: {
          id?: string
          instruction_set_id?: string
          make?: string
          model?: string
          year_from?: number
          year_to?: number
        }
        Relationships: [
          {
            foreignKeyName: "guide_vehicles_instruction_set_id_fkey"
            columns: ["instruction_set_id"]
            isOneToOne: false
            referencedRelation: "instruction_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      guide_views: {
        Row: {
          brand_id: string
          completion_count: number
          date: string
          id: string
          instruction_set_id: string
          view_count: number
        }
        Insert: {
          brand_id: string
          completion_count?: number
          date: string
          id?: string
          instruction_set_id: string
          view_count?: number
        }
        Update: {
          brand_id?: string
          completion_count?: number
          date?: string
          id?: string
          instruction_set_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "guide_views_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guide_views_instruction_set_id_fkey"
            columns: ["instruction_set_id"]
            isOneToOne: false
            referencedRelation: "instruction_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      instruction_sets: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string | null
          estimated_time: string | null
          id: string
          notice_text: string | null
          product_code: string
          product_image_url: string | null
          short_description: string | null
          slug: string
          title: string
          tools_required: string[] | null
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          estimated_time?: string | null
          id?: string
          notice_text?: string | null
          product_code: string
          product_image_url?: string | null
          short_description?: string | null
          slug: string
          title: string
          tools_required?: string[] | null
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          estimated_time?: string | null
          id?: string
          notice_text?: string | null
          product_code?: string
          product_image_url?: string | null
          short_description?: string | null
          slug?: string
          title?: string
          tools_required?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instruction_sets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      instruction_steps: {
        Row: {
          description: string
          id: string
          image_original_url: string | null
          image_url: string | null
          image2_original_url: string | null
          image2_url: string | null
          instruction_set_id: string
          order_index: number
          step_number: number
          subtitle: string
          variant_id: string | null
          video_url: string | null
        }
        Insert: {
          description: string
          id?: string
          image_original_url?: string | null
          image_url?: string | null
          image2_original_url?: string | null
          image2_url?: string | null
          instruction_set_id: string
          order_index: number
          step_number: number
          subtitle: string
          variant_id?: string | null
          video_url?: string | null
        }
        Update: {
          description?: string
          id?: string
          image_original_url?: string | null
          image_url?: string | null
          image2_original_url?: string | null
          image2_url?: string | null
          instruction_set_id?: string
          order_index?: number
          step_number?: number
          subtitle?: string
          variant_id?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instruction_steps_instruction_set_id_fkey"
            columns: ["instruction_set_id"]
            isOneToOne: false
            referencedRelation: "instruction_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instruction_steps_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "guide_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      step_views: {
        Row: {
          brand_id: string
          completed: boolean
          id: string
          instruction_set_id: string
          session_id: string
          step_number: number | null
          variant_id: string | null
          viewed_at: string
        }
        Insert: {
          brand_id: string
          completed?: boolean
          id?: string
          instruction_set_id: string
          session_id: string
          step_number?: number | null
          variant_id?: string | null
          viewed_at?: string
        }
        Update: {
          brand_id?: string
          completed?: boolean
          id?: string
          instruction_set_id?: string
          session_id?: string
          step_number?: number | null
          variant_id?: string | null
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_views_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_views_instruction_set_id_fkey"
            columns: ["instruction_set_id"]
            isOneToOne: false
            referencedRelation: "instruction_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_views_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "guide_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_questions: {
        Row: {
          answer: string | null
          brand_id: string
          created_at: string
          escalated: boolean
          id: string
          instruction_set_id: string
          question: string
          resolved: boolean
          session_id: string
          step_number: number | null
        }
        Insert: {
          answer?: string | null
          brand_id: string
          created_at?: string
          escalated?: boolean
          id?: string
          instruction_set_id: string
          question: string
          resolved?: boolean
          session_id: string
          step_number?: number | null
        }
        Update: {
          answer?: string | null
          brand_id?: string
          created_at?: string
          escalated?: boolean
          id?: string
          instruction_set_id?: string
          question?: string
          resolved?: boolean
          session_id?: string
          step_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "support_questions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_questions_instruction_set_id_fkey"
            columns: ["instruction_set_id"]
            isOneToOne: false
            referencedRelation: "instruction_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
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
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "editor"
      feedback_type: "rating" | "comment" | "flag"
      publication_status: "draft" | "published"
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
      app_role: ["admin", "editor"],
      feedback_type: ["rating", "comment", "flag"],
      publication_status: ["draft", "published"],
    },
  },
} as const
