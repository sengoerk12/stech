import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { api } from "../services/api";
export const useDashboard = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    staleTime: 5000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      query.state.data?.pendingPayments?.some(
        (payment) => payment.status === "transferring",
      )
        ? 3000
        : 5000,
  });
  const { refetch } = query;
  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch]);
  return { ...query, isRefreshing, refresh };
};
