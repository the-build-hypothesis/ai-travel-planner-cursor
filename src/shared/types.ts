import { z } from "zod";

export const ActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  durationMinutes: z.number().optional(),
  location: z
    .object({
      name: z.string().optional(),
      address: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      placeId: z.string().optional(),
    })
    .optional(),
  estimatedCost: z.number().optional(),
  costIsEstimate: z.boolean().default(true),
  notes: z.string().optional(),
  transportation: z.string().optional(),
});

export const DayPlanSchema = z.object({
  day: z.number().int().positive(),
  date: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  activities: z.array(ActivitySchema).default([]),
  estimatedDailyCost: z.number().optional(),
});

export const ItinerarySchema = z.object({
  version: z.literal(1).default(1),
  destination: z.string().optional(),
  summary: z.string().optional(),
  currency: z.string().default("USD"),
  estimatedTotalCost: z.number().optional(),
  costDisclaimer: z
    .string()
    .default("Costs are estimates unless marked as verified."),
  days: z.array(DayPlanSchema).default([]),
  tips: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
});

export type Activity = z.infer<typeof ActivitySchema>;
export type DayPlan = z.infer<typeof DayPlanSchema>;
export type Itinerary = z.infer<typeof ItinerarySchema>;

export const TripPreferencesSchema = z.object({
  destination: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  durationDays: z.number().int().positive().optional(),
  travelersAdults: z.number().int().nonnegative().optional(),
  travelersChildren: z.number().int().nonnegative().optional(),
  childrenAges: z.array(z.number()).optional(),
  budgetAmount: z.number().optional(),
  budgetCurrency: z.string().optional(),
  interests: z.array(z.string()).optional(),
  travelPace: z.string().optional(),
  specialRequirements: z.string().optional(),
  title: z.string().optional(),
});

export type TripPreferences = z.infer<typeof TripPreferencesSchema>;

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface TripSummary {
  id: string;
  title: string;
  destination: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  createdAt: string;
  updatedAt: string;
  ownerType: "user" | "guest";
  itineraryDayCount: number;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  createdAt: string;
}
