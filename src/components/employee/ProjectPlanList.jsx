import React from "react";
import { useAuth } from "@/lib/AuthContext";
import PMPlansElevationsTab from "@/components/pm/PMPlansElevationsTab";

export default function ProjectPlanList({ currentUser, companyId, projectId }) {
  const { profile } = useAuth();
  if (!projectId || !companyId || profile?.company_id !== companyId || profile?.id !== currentUser?.id) return null;
  return <PMPlansElevationsTab project={{ id: projectId }} readOnly />;
}
