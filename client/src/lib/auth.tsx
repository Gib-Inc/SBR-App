import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useLocation } from "wouter";

type User = {
  id: string;
  email: string;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();

  const { data: user = null, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const loginMutation = useMutation({
    mutationFn: async ({ email: e, password: p }: { email: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", { email: e, password: p });
      return await res.json();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout", {});
    },
    onSuccess: () => {
      queryClient.clear();
      setLocation("/login");
    },
  });

  const login = async (email: string, password: string) => {
    await loginMutation.mutateAsync({ email, password });
    // Use fetchQuery to get the actual user data and verify login succeeded
    // This ensures the session cookie was properly set before we navigate
    const userData = await queryClient.fetchQuery({
      queryKey: ["/api/auth/me"],
      queryFn: getQueryFn({ on401: "returnNull" }),
      staleTime: 0, // Force fresh fetch
    });
    
    if (!userData) {
      throw new Error("Login failed - session not established");
    }
    
    // Set the cache directly with the fetched user data (don't invalidate which triggers another request)
    queryClient.setQueryData(["/api/auth/me"], userData);
    setLocation("/");
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
