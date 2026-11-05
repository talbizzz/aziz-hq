export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_owner: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          at: string
          created_at: string
          data: Json
          entity_id: string | null
          entity_type: string
          id: number
          kind: string
          run_id: string | null
          task_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          at?: string
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type: string
          id?: never
          kind: string
          run_id?: string | null
          task_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          at?: string
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type?: string
          id?: never
          kind?: string
          run_id?: string | null
          task_id?: string | null
        }
        Relationships: []
      }
      gates: {
        Row: {
          comment: string | null
          context: Json
          created_at: string
          decided_at: string | null
          decided_via: string | null
          decision: Database["public"]["Enums"]["gate_decision"] | null
          kind: string
          options: Json
          priority: number
          task_id: string
          title: string
        }
        Insert: {
          comment?: string | null
          context?: Json
          created_at?: string
          decided_at?: string | null
          decided_via?: string | null
          decision?: Database["public"]["Enums"]["gate_decision"] | null
          kind: string
          options?: Json
          priority?: number
          task_id: string
          title: string
        }
        Update: {
          comment?: string | null
          context?: Json
          created_at?: string
          decided_at?: string | null
          decided_via?: string | null
          decision?: Database["public"]["Enums"]["gate_decision"] | null
          kind?: string
          options?: Json
          priority?: number
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "gates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id: string
          name: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
        }
        Relationships: []
      }
      runs: {
        Row: {
          config: Json
          created_at: string
          finished_at: string | null
          id: string
          module_id: string
          status: Database["public"]["Enums"]["run_status"]
          title: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          finished_at?: string | null
          id?: string
          module_id: string
          status?: Database["public"]["Enums"]["run_status"]
          title: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          finished_at?: string | null
          id?: string
          module_id?: string
          status?: Database["public"]["Enums"]["run_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      tasks: {
        Row: {
          attempts: number
          claimed_by: string | null
          created_at: string
          depends_on: string[]
          id: string
          lane: string | null
          lease_until: string | null
          max_attempts: number
          payload: Json
          priority: number
          result: Json | null
          role: string | null
          run_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_by?: string | null
          created_at?: string
          depends_on?: string[]
          id?: string
          lane?: string | null
          lease_until?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          result?: Json | null
          role?: string | null
          run_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_by?: string | null
          created_at?: string
          depends_on?: string[]
          id?: string
          lane?: string | null
          lease_until?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          result?: Json | null
          role?: string | null
          run_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          type?: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      usage: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          cost_usd: number
          created_at: string
          id: string
          input_tokens: number
          model: string | null
          output_tokens: number
          role: string | null
          run_id: string | null
          runner: string
          task_id: string | null
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string | null
          output_tokens?: number
          role?: string | null
          run_id?: string | null
          runner: string
          task_id?: string | null
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string | null
          output_tokens?: number
          role?: string | null
          run_id?: string | null
          runner?: string
          task_id?: string | null
        }
        Relationships: []
      }
      worker_heartbeats: {
        Row: {
          created_at: string
          info: Json
          last_seen_at: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          info?: Json
          last_seen_at?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          info?: Json
          last_seen_at?: string
          worker_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_actor_id: { Args: never; Returns: string }
      current_actor_type: {
        Args: never
        Returns: Database["public"]["Enums"]["actor_type"]
      }
      health: { Args: never; Returns: string }
      is_owner: { Args: never; Returns: boolean }
    }
    Enums: {
      actor_type: "system" | "worker" | "agent" | "human"
      gate_decision: "approve" | "modify" | "dismiss" | "answer"
      run_status:
        | "pending"
        | "running"
        | "paused"
        | "done"
        | "failed"
        | "cancelled"
      task_status:
        | "pending"
        | "running"
        | "waiting_human"
        | "done"
        | "failed"
        | "cancelled"
      task_type: "agent" | "gate" | "system"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      actor_type: ["system", "worker", "agent", "human"],
      gate_decision: ["approve", "modify", "dismiss", "answer"],
      run_status: [
        "pending",
        "running",
        "paused",
        "done",
        "failed",
        "cancelled",
      ],
      task_status: [
        "pending",
        "running",
        "waiting_human",
        "done",
        "failed",
        "cancelled",
      ],
      task_type: ["agent", "gate", "system"],
    },
  },
} as const

