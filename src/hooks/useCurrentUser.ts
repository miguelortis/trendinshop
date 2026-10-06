"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { PublicUser } from "@/types/auth";

type CurrentUserResponse = {
  ok: true;
  user: PublicUser;
};

export function useCurrentUser() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const response = await api.get<CurrentUserResponse>("/auth/me");
      return response.data.user;
    },
    retry: false,
    staleTime: 60_000,
  });
}
