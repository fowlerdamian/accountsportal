import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@guide/integrations/supabase/client";
import { Tables } from "@guide/integrations/supabase/types";

export function useBrands() {
  return useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("*").order("name");
      if (error) throw error;
      return data as Tables<"brands">[];
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("name");
      if (error) throw error;
      return data as Tables<"categories">[];
    },
  });
}

export function useInstructionSets() {
  return useQuery({
    queryKey: ["instruction_sets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instruction_sets")
        .select("*, categories(name)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useInstructionSet(id: string | undefined) {
  return useQuery({
    queryKey: ["instruction_set", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instruction_sets")
        .select("*, categories(name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useInstructionSteps(instructionSetId: string | undefined) {
  return useQuery({
    queryKey: ["instruction_steps", instructionSetId],
    enabled: !!instructionSetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instruction_steps")
        .select("*")
        .eq("instruction_set_id", instructionSetId!)
        .order("order_index");
      if (error) throw error;
      return data as Tables<"instruction_steps">[];
    },
  });
}

export function usePublications(instructionSetId?: string) {
  return useQuery({
    queryKey: ["publications", instructionSetId],
    queryFn: async () => {
      let q = supabase.from("guide_publications").select("*, brands(key, name, domain, primary_colour)");
      if (instructionSetId) q = q.eq("instruction_set_id", instructionSetId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useSupportQuestions() {
  return useQuery({
    queryKey: ["support_questions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_questions")
        .select("*, instruction_sets(title), brands(key, name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useFeedback() {
  return useQuery({
    queryKey: ["feedback"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feedback")
        .select("*, instruction_sets(title), brands(key, name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data: profiles, error: pErr } = await supabase.from("profiles").select("*").order("created_at");
      if (pErr) throw pErr;
      const { data: roles, error: rErr } = await supabase.from("user_roles").select("*");
      if (rErr) throw rErr;
      return profiles.map(p => ({
        ...p,
        role: roles.find(r => r.user_id === p.id)?.role ?? null,
      }));
    },
  });
}

// Customer-facing: fetch guide by slug (uses anon key)
export function useGuideBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: ["guide_by_slug", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instruction_sets")
        .select("*")
        .eq("slug", slug!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useGuideStepsBySetId(instructionSetId: string | undefined) {
  return useQuery({
    queryKey: ["guide_steps_public", instructionSetId],
    enabled: !!instructionSetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instruction_steps")
        .select("*")
        .eq("instruction_set_id", instructionSetId!)
        .is("variant_id", null)
        .order("order_index");
      if (error) throw error;
      return data as Tables<"instruction_steps">[];
    },
  });
}

export interface GuideVehicle {
  id: string;
  instruction_set_id: string;
  make: string;
  model: string;
  year_from: number;
  year_to: number;
}

export function useGuideVehicles(instructionSetId: string | undefined) {
  return useQuery({
    queryKey: ["guide_vehicles", instructionSetId],
    enabled: !!instructionSetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guide_vehicles" as any)
        .select("*")
        .eq("instruction_set_id", instructionSetId!)
        .order("make");
      if (error) throw error;
      return data as unknown as GuideVehicle[];
    },
  });
}

export function useAllGuideVehicles() {
  return useQuery({
    queryKey: ["guide_vehicles_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guide_vehicles" as any)
        .select("*");
      if (error) throw error;
      return data as unknown as GuideVehicle[];
    },
  });
}
